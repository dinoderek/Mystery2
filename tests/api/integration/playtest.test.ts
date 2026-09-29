// The playtest harness's loop, against the suite's mock server.
//
// A scripted investigator stands in for the model one, so this runs offline
// and deterministically. It proves the pieces a real playtest relies on: the
// UI's parser decides what each line does, rejected lines cost no turn, free
// text in accuse mode becomes reasoning, the loop stops when the case ends,
// and the run folder records it all.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { signIn } from '../../../evaluation/playtest/lib/api.mjs';
import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.mjs';
import { writeGameFolder } from '../../../evaluation/playtest/lib/output.mjs';
import { playGame } from '../../../evaluation/playtest/lib/play.mjs';
import { BASE_URL, MOCK_BLUEPRINT_ID } from './helpers';

const MOCK_BLUEPRINT = JSON.parse(
	fs.readFileSync(path.join(process.cwd(), 'blueprints', 'mock-blueprint.json'), 'utf8')
);

const INPUTS = [
	'search',
	'notebook',
	'serch the pantry',
	'search the pantry shelf',
	'talk to Zed',
	'talk to alice',
	'Where were you last night?',
	'bye',
	'go to living room',
	'accuse',
	'Alice did it, the crumbs lead to her.',
	// The mock judge asks for more on the first round, then rules.
	'Alice took the cookies: the crumbs and the empty jar both point to her.',
	'this line is never reached'
];

// The step records `playGame` returns (evaluation/playtest/lib/play.mjs).
interface PlayedStep {
	input: string;
	action: Record<string, unknown>;
	response: { ok: boolean } | null;
	view: string;
	time_before: number;
	time_after: number;
}

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

describe('playtest loop', () => {
	it('plays a scripted game to the end through the UI parser', async () => {
		const api = await signIn(BASE_URL, 'playtest-smoke');

		const game = await playGame({
			api,
			blueprint: { id: MOCK_BLUEPRINT_ID, title: 'Mock Blueprint' },
			investigator: scriptedInvestigator(INPUTS)
		});

		expect(game.stopReason).toBe('ended');
		expect(game.result).toBe('win');
		expect(game.script).toEqual(INPUTS.slice(0, 12));

		const steps: PlayedStep[] = game.steps;
		const byInput = Object.fromEntries(steps.map((step) => [step.input, step]));

		// Lines the parser rejects print its hint and cost no turn.
		expect(byInput['serch the pantry'].action).toMatchObject({ kind: 'feedback', parse: 'unrecognized' });
		expect(byInput['serch the pantry'].time_before).toBe(byInput['serch the pantry'].time_after);
		expect(byInput['talk to Zed'].action).toEqual({
			kind: 'feedback',
			parse: 'invalid-target',
			text: expect.stringContaining('"zed" is not a valid character. Try: Alice Smith'),
		});

		// Routing mirrors the web store.
		expect(byInput['search the pantry shelf'].action).toMatchObject({
			endpoint: 'game-search',
			body: { search_query: 'the pantry shelf' }
		});
		expect(byInput['talk to alice'].action).toMatchObject({
			endpoint: 'game-talk',
			body: { character_id: 'char-alice' }
		});
		expect(byInput['Where were you last night?'].action).toMatchObject({ endpoint: 'game-ask' });
		expect(byInput['go to living room'].action).toMatchObject({
			endpoint: 'game-move',
			body: { destination: 'loc-living-room' }
		});
		expect(byInput['Alice did it, the crumbs lead to her.'].action).toMatchObject({
			endpoint: 'game-accuse',
			body: { player_reasoning: 'Alice did it, the crumbs lead to her.' }
		});

		// It opened as the browser does: the premise, then the arrival.
		expect(game.steps[0].view).toMatch(/Narrator: \[Mock\] Narration for:/);
		// `notebook` opens a screen in the browser: no echo, no turn.
		expect(byInput['notebook'].action).toMatchObject({ kind: 'feedback', parse: 'notebook' });
		expect(game.transcript.some((entry: { text: string }) => entry.text === 'notebook')).toBe(false);

		// Every call succeeded, and the investigator saw the mock narration.
		expect(steps.every((step) => !step.response || step.response.ok)).toBe(true);
		expect(steps.at(-1)?.view).toContain('[Mock]');
		expect(game.finalState.mode).toBe('ended');
	});

	it('writes a readable run folder', async () => {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-playtest-'));
		const api = await signIn(BASE_URL, 'playtest-smoke-folder');
		const game = await playGame({
			api,
			blueprint: { id: MOCK_BLUEPRINT_ID, title: 'Mock Blueprint' },
			investigator: scriptedInvestigator(INPUTS)
		});

		const dir = path.join(scratch, 'game-1');
		const summary = writeGameFolder({
			dir,
			game,
			blueprint: MOCK_BLUEPRINT,
			persona: 'scripted',
			narratorModel: 'mock',
			investigatorModel: 'script',
			callLogFile: null,
			wallMs: 1000
		});

		expect(summary).toMatchObject({
			outcome: 'win',
			stop_reason: 'ended',
			steps: 12,
			parser_rejections: 3,
			failed_calls: 0,
			time_budget: MOCK_BLUEPRINT.metadata.time_budget,
			narrator_cost_usd: null,
			investigator_cost_usd: null
		});
		expect(summary.clues_found).toBeGreaterThan(0);
		expect(summary.clues_total).toBeGreaterThanOrEqual(summary.clues_found);

		expect(JSON.parse(fs.readFileSync(path.join(dir, 'script.json'), 'utf8')).inputs).toEqual(
			INPUTS.slice(0, 12)
		);
		expect(fs.readFileSync(path.join(dir, 'steps.jsonl'), 'utf8').trim().split('\n')).toHaveLength(12);
		const transcript = fs.readFileSync(path.join(dir, 'transcript.md'), 'utf8');
		expect(transcript).toContain('**> talk to alice**');
		expect(transcript).toContain('- Outcome: win (stopped: ended)');
	});
});
