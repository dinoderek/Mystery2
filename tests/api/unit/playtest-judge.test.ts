// Grading a playtest: the setup check that keeps --judge from quietly running
// without judges, the reading-level score of each narration, and the grades
// section of the transcript.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
	judgeSetupProblem,
	renderGrades,
	scoreReadability
} from '../../../evaluation/playtest/lib/judge.mjs';

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

function repoWithConfig(content: string | null) {
	scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-judge-setup-'));
	const dir = path.join(scratch, 'evaluation', 'trace', 'config');
	fs.mkdirSync(dir, { recursive: true });
	if (content !== null) fs.writeFileSync(path.join(dir, 'cli.json'), content);
	return scratch;
}

function event(sequence: number, event_type: string, text: string) {
	return { sequence, event_type, narration: text, narration_parts: text ? [{ text, speaker: { kind: 'narrator' } }] : [] };
}

describe('playtest --judge setup', () => {
	it('needs a cli.json with a judge step', () => {
		expect(judgeSetupProblem(repoWithConfig(null))).toMatch(/copy it from cli.example.json/);
		expect(judgeSetupProblem(repoWithConfig('{}'))).toMatch(/has no "judge" step/);
		expect(judgeSetupProblem(repoWithConfig('{'))).toMatch(/not valid JSON/);
		expect(judgeSetupProblem(repoWithConfig('{"judge": {"cmd": "x"}}'))).toBeNull();
	});
});

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
		expect(score.max_grade).toBeGreaterThan(score.threshold);
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

		expect(renderGrades({ error: 'eval:trace exited 1' })).toContain('- Grading failed: eval:trace exited 1');
	});
});
