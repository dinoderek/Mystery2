// Grading a played game (`play --judge`), against the suite's mock server.
//
// A scripted game is played, the database copied as a run does, and the game
// graded through the game command, with the stub judge CLI the trace
// tests use standing in for the model. No model is called.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { TEST_DATABASE, resolveDatabaseFile } from '../../../lib/database-target.mjs';
import { signIn } from '../../../evaluation/playtest/lib/api.ts';
import { copyDatabase } from '../../../evaluation/playtest/lib/database.ts';
import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.ts';
import { extractTrace, gradeGame, renderGrades } from '../../../evaluation/playtest/lib/judge.ts';
import { writeGameFolder } from '../../../evaluation/playtest/lib/output.ts';
import { playGame } from '../../../evaluation/playtest/lib/game.ts';
import { BASE_URL, MOCK_BLUEPRINT_ID, TEST_CONFIG_ROOT } from './helpers';

const REPO_ROOT = process.cwd();
const MOCK_BLUEPRINT = JSON.parse(
	fs.readFileSync(path.join(REPO_ROOT, 'blueprints', 'mock-blueprint.json'), 'utf8')
);
const MOCK_JUDGE = path.join(REPO_ROOT, 'tests', 'api', 'unit', 'trace-mock-judge.mjs');

const INPUTS = [
	'search',
	'talk to alice',
	'Where were you last night?',
	'bye',
	'accuse',
	'Alice did it, the crumbs lead to her.',
	'Alice took the cookies: the crumbs and the empty jar both point to her.'
];

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

describe('playtest grading', () => {
	it('grades a played game with the trace judges and a reading level', async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-playtest-judge-'));
		const game = await playGame({
			api: await signIn(BASE_URL, 'playtest-judge'),
			blueprint: { id: MOCK_BLUEPRINT_ID, title: 'Mock Blueprint' },
			investigator: scriptedInvestigator(INPUTS)
		});
		expect(game.result).toBe('win');

		const gameDir = path.join(scratch, 'game-1');
		writeGameFolder({
			dir: gameDir,
			game,
			blueprint: MOCK_BLUEPRINT,
			persona: 'scripted',
			narratorModel: 'mock',
			investigatorModel: 'script',
			callLogFile: null,
			wallMs: 1000
		});

		// As a run does: grade from a copy of the database, not the live one.
		const database = path.join(scratch, 'game.db');
		await copyDatabase(resolveDatabaseFile(TEST_DATABASE, TEST_CONFIG_ROOT, {}), database);

		const config = path.join(scratch, 'config.json');
		fs.writeFileSync(
			config,
			JSON.stringify({
				'game-judge': {
					cmd: 'node',
					args: [MOCK_JUDGE, '{{system_prompt_file}}', '{{user_message_file}}'],
					extract_path: 'result',
					timeout_ms: 30000,
					retries: 0
				}
			})
		);

		await extractTrace({ repoRoot: REPO_ROOT, database, gameId: game.gameId, gameDir });
		const { grades, result } = await gradeGame({
			root: REPO_ROOT,
			gameDir,
			targetAge: MOCK_BLUEPRINT.metadata.target_age,
			judgeArgs: ['--config', config]
		});

		expect(grades).toMatchObject({
			mechanical: { clue_accounting: 'pass', spoiler_leak: 'pass' },
			judges: {
				gm_roleplay: { status: 'pass', major: 0, minor: 0 },
				gm_clue_discipline: { status: 'pass' },
				gm_fabrication: { status: 'pass' },
				gm_spoiler: { status: 'pass' }
			},
			run_error: null,
			judge_cost_usd: null,
			readability: { target_age: MOCK_BLUEPRINT.metadata.target_age }
		});
		// The opening (premise, arrival) and every turn's narration are scored.
		const readability = JSON.parse(fs.readFileSync(path.join(gameDir, 'readability.json'), 'utf8'));
		expect(readability.total).toBe(INPUTS.length + 2);
		expect(readability.narrations[0]).toMatchObject({ event_type: 'start' });
		expect(grades.readability.pass).toBeLessThanOrEqual(grades.readability.total);

		const trace = JSON.parse(fs.readFileSync(path.join(gameDir, 'trace.json'), 'utf8'));
		expect(trace.session.id).toBe(game.gameId);
		expect(result.subject).toMatchObject({ kind: 'game', id: game.gameId });
		expect(result.verdicts.map((verdict) => verdict.id)).toEqual(
			expect.arrayContaining(['clue_accounting', 'gm_roleplay', 'gm_spoiler'])
		);

		expect(renderGrades(grades)).toContain('- gm_spoiler: pass (0 major, 0 minor)');

		// A judge that fails is reported as such, and the rest still grade.
		process.env.MOCK_JUDGE_MODE = 'crash';
		try {
			const { grades: crashed } = await gradeGame({
				root: REPO_ROOT,
				gameDir,
				targetAge: MOCK_BLUEPRINT.metadata.target_age,
				judgeArgs: ['--config', config]
			});
			expect(crashed.judges.gm_spoiler).toEqual({ status: 'error', major: null, minor: null });
			expect(crashed.mechanical).toEqual(grades.mechanical);
			expect(renderGrades(crashed)).toContain('- gm_spoiler: error\n');
		} finally {
			delete process.env.MOCK_JUDGE_MODE;
		}
	});
});
