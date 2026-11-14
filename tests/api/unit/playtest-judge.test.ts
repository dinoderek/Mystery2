// Grading a playtest: the reading-level score of each narration, the judges'
// cost, what is kept when the trace pipeline stops, and the transcript's grades.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { gradeGame, renderGrades, scoreReadability } from '../../../evaluation/playtest/lib/judge.ts';
import { makeRawTrace } from './trace-fixtures.ts';

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

const STUB_JUDGE = path.join(process.cwd(), 'tests', 'api', 'unit', 'trace-mock-judge.mjs');
const STUB_BINDING = {
	cmd: process.execPath,
	args: [STUB_JUDGE, '{{system_prompt_file}}', '{{user_message_file}}'],
	extract_path: 'result',
	timeout_ms: 30000,
	retries: 0
};

function event(sequence: number, event_type: string, text: string) {
	return { sequence, event_type, narration: text, narration_parts: text ? [{ text, speaker: { kind: 'narrator' } }] : [] };
}

describe('playtest reading level', () => {
	it('scores every narration against the target age, skipping silent events', () => {
		const score = scoreReadability(
			{
				events: [
					event(1, 'start', 'The cat sat. The dog ran.'),
					event(2, 'move', ''),
					event(
						3,
						'search',
						'Notwithstanding considerable investigative deliberation, the extraordinarily meticulous constabulary remained unconvinced regarding circumstantial documentation.'
					)
				]
			},
			7
		);

		expect(score).toMatchObject({ target_age: 7, threshold: 4, pass: 1, total: 2 });
		expect(score.narrations.map((entry: { sequence: number; status: string }) => [entry.sequence, entry.status])).toEqual([
			[1, 'pass'],
			[3, 'fail']
		]);
		expect(score.max_grade).toBeGreaterThan(score.threshold as number);
	});
});

describe('playtest judge cost', () => {
	it('adds what every judge call reported, and is unknown when none reported a cost', async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-judge-cost-'));
		fs.writeFileSync(path.join(scratch, 'trace.json'), JSON.stringify(makeRawTrace()));
		// The Claude CLI's envelope carries the call's cost beside its answer.
		const judge = path.join(scratch, 'costly-judge.mjs');
		fs.writeFileSync(
			judge,
			`const verdict = { findings: [], verdict: 'pass', reasoning: 'Grounded.' };
process.stdout.write(JSON.stringify({ result: JSON.stringify(verdict), total_cost_usd: 0.25 }));`
		);
		const config = path.join(scratch, 'config.json');
		fs.writeFileSync(
			config,
			JSON.stringify({ 'game-judge': { ...STUB_BINDING, args: [judge, '{{system_prompt_file}}', '{{user_message_file}}'] } })
		);

		const costly = await gradeGame({ root: process.cwd(), gameDir: scratch, targetAge: 9, judgeArgs: ['--config', config] });
		expect(costly.grades.judge_cost_usd).toBe(1);

		fs.writeFileSync(config, JSON.stringify({ 'game-judge': STUB_BINDING }));
		const free = await gradeGame({ root: process.cwd(), gameDir: scratch, targetAge: 9, judgeArgs: ['--config', config] });
		expect(free.grades.judge_cost_usd).toBeNull();
	});
});

describe('playtest grading when the trace pipeline stops', () => {
	it('keeps the command\'s result, the reason, and the reading levels', async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-judge-run-error-'));
		// Readable narration, but not a trace the pipeline accepts.
		fs.writeFileSync(
			path.join(scratch, 'trace.json'),
			JSON.stringify({ events: [event(1, 'start', 'The cat sat.')] })
		);

		const config = path.join(scratch, 'config.json');
		fs.writeFileSync(config, JSON.stringify({ 'game-judge': STUB_BINDING }));

		const { grades, result } = await gradeGame({
			root: process.cwd(),
			gameDir: scratch,
			targetAge: 7,
			judgeArgs: ['--config', config]
		});

		expect(grades.run_error).toMatchObject({ message: expect.any(String) });
		expect(grades.judges).toEqual({});
		expect(grades.readability).toMatchObject({ pass: 1, total: 1 });
		expect(result.run_error).toEqual(grades.run_error);
		expect(fs.readFileSync(path.join(scratch, 'judge.log'), 'utf8')).toContain('judge game');
		expect(renderGrades(grades)).toContain('- The trace pipeline stopped');
	});
});

describe('playtest grades in the transcript', () => {
	it('lists every verdict, or why grading failed', () => {
		const text = renderGrades({
			mechanical: { clue_accounting: 'pass' },
			judges: { gm_spoiler: { status: 'fail', major: 1, minor: 2 }, gm_roleplay: { status: 'error', major: null, minor: null } },
			run_error: null,
			judge_cost_usd: 1.5,
			readability: { target_age: 7, threshold: 4, pass: 3, total: 4, mean_grade: 3.1, max_grade: 6.2 }
		});
		expect(text).toContain('## Grades');
		expect(text).toContain('- clue_accounting: pass');
		expect(text).toContain('- gm_spoiler: fail (1 major, 2 minor)');
		expect(text).toContain('- gm_roleplay: error\n');
		expect(text).toContain('- flesch: 3 of 4 narrations at or under grade 4 for age 7 (mean 3.1, highest 6.2)');
		expect(text).toContain('- Judge cost: $1.500');

		expect(renderGrades({ error: 'judge game exited 1' })).toContain('- Grading failed: judge game exited 1');
	});
});
