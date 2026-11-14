// What a played game leaves on disk, and reading back the database its own
// server wrote: the folder's files, the summary's counts, and that the database
// is opened read-only.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { copyDatabase, readPlayedEvents } from '../../../evaluation/playtest/lib/database.ts';
import type { PlayedGame } from '../../../evaluation/playtest/lib/game.ts';
import { countBlueprintClues, summarizeGame, writeGameFolder } from '../../../evaluation/playtest/lib/output.ts';
import type { PlaytestBlueprint } from '../../../evaluation/playtest/lib/output.ts';
import { createGameDatabase } from './trace-database-fixture.ts';

let dir = '';

beforeEach(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-playtest-output-'));
});

afterEach(() => {
	fs.rmSync(dir, { recursive: true, force: true });
});

const BLUEPRINT: PlaytestBlueprint = {
	id: 'mock-blueprint',
	metadata: { title: 'Mock Blueprint', time_budget: 10 },
	world: {
		locations: [{ clues: [{}, {}], sub_locations: [{ clues: [{}] }, {}] }, {}],
		characters: [{ clues: [{}] }, {}]
	}
};

const CHECKPOINT = { mode: 'explore', location: 'loc-kitchen', talk_character: null, people_here: [], clues: [] };

function game(overrides: Partial<PlayedGame> = {}): PlayedGame {
	return {
		gameId: 'game-1',
		result: 'win',
		stopReason: 'ended',
		error: null,
		divergence: null,
		transcript: [
			{ kind: 'narration', speaker: 'Narrator', text: 'You arrive.' },
			{ kind: 'input', text: 'search kitchen', plan: 'look for crumbs' },
			{ kind: 'feedback', text: 'Try again.' }
		],
		script: ['search kitchen', 'quit'],
		checkpoints: [CHECKPOINT],
		endCheckpoint: CHECKPOINT,
		steps: [
			{
				step: 1,
				mode_before: 'explore',
				time_before: 10,
				input: 'search kitchen',
				plan: '',
				checkpoint: CHECKPOINT,
				investigator: { model: 'm', cost_usd: 0.25, attempts: 1 },
				action: { kind: 'turn', event_type: 'search' },
				response: { ok: true, status: 200, body: {} },
				view: ''
			},
			{
				step: 2,
				mode_before: 'explore',
				time_before: 9,
				input: 'serch',
				plan: '',
				checkpoint: CHECKPOINT,
				investigator: { model: 'm', cost_usd: 0.5, attempts: 1 },
				action: { kind: 'refused', reason: 'unknown', text: 'Try again.' },
				response: { ok: true, status: 200, body: {} },
				view: ''
			},
			{
				step: 3,
				mode_before: 'explore',
				time_before: 9,
				input: 'look',
				plan: '',
				checkpoint: CHECKPOINT,
				investigator: { model: null, cost_usd: null, attempts: 1 },
				action: { kind: 'failed', status: 500 },
				response: { ok: false, status: 500, body: {} },
				view: ''
			}
		],
		finalState: { mode: 'ended', time_remaining: 6, discovered_clues: [{ id: 'clue-a' }, { id: 'clue-b' }] } as never,
		...overrides
	};
}

const FOLDER = {
	game: game(),
	blueprint: BLUEPRINT,
	persona: 'detective',
	narratorModel: 'mock',
	investigatorModel: 'stub',
	wallMs: 12_400
};

describe('counting a blueprint\'s clues', () => {
	it('counts those at locations, sub-locations and characters', () => {
		expect(countBlueprintClues(BLUEPRINT)).toBe(4);
	});
});

describe('summarizing a game', () => {
	it('counts what happened, from the game and the narrator calls the server logged', () => {
		const summary = summarizeGame({
			...FOLDER,
			number: 2,
			calls: [{ cost_usd: 0.1 }, { cost_usd: null }, { cost_usd: 0.2 }]
		});

		expect(summary).toMatchObject({
			game_number: 2,
			game_id: 'game-1',
			blueprint: { id: 'mock-blueprint', title: 'Mock Blueprint' },
			outcome: 'win',
			stop_reason: 'ended',
			final_mode: 'ended',
			steps: 3,
			turns_used: 4,
			time_budget: 10,
			parser_rejections: 1,
			failed_calls: 1,
			clues_found: 2,
			clues_total: 4,
			clue_ids_found: ['clue-a', 'clue-b'],
			narrator_calls: 3,
			investigator_cost_usd: 0.75,
			wall_seconds: 12,
			replay_of: null,
			divergence: null
		});
		expect(summary.narrator_cost_usd).toBeCloseTo(0.3);
	});

	it('has no cost where nothing reported one, and no number outside a run', () => {
		const summary = summarizeGame({
			...FOLDER,
			game: game({
				result: null,
				finalState: { mode: 'explore', time_remaining: 10 } as never,
				steps: [{ ...game().steps[2] }]
			}),
			calls: []
		});
		expect(summary).toMatchObject({ game_number: null, outcome: null, narrator_cost_usd: null, investigator_cost_usd: null, clues_found: 0, clue_ids_found: [] });
	});
});

describe('writing the game folder', () => {
	it('writes the transcript, script, steps, calls, events and summary', () => {
		const callLog = path.join(dir, 'calls.jsonl');
		fs.writeFileSync(
			callLog,
			[{ game_id: 'game-1', cost_usd: 0.05 }, { game_id: 'other', cost_usd: 9 }].map((entry) => JSON.stringify(entry)).join('\n') + '\n'
		);
		const out = path.join(dir, 'game');

		const summary = writeGameFolder({
			...FOLDER,
			dir: out,
			number: 1,
			callLogFile: callLog,
			events: [{ sequence: 1, type: 'search', payload: {}, parts: [] }]
		});

		expect(fs.readdirSync(out).sort()).toEqual(['ai-calls.jsonl', 'events.json', 'script.json', 'steps.jsonl', 'summary.json', 'transcript.md']);
		const transcript = fs.readFileSync(path.join(out, 'transcript.md'), 'utf8');
		expect(transcript).toContain('# Mock Blueprint: detective');
		expect(transcript).toContain('*(look for crumbs)*\n**> search kitchen**');
		expect(transcript).toContain('- Outcome: win (stopped: ended)');
		expect(transcript).toContain('- Turns used: 4 of 10; steps: 3 (1 not understood by the parser, 1 failed calls)');
		expect(transcript).toContain('- Clues found: 2 of 4');
		expect(transcript).toContain('- Cost: narrator $0.050, investigator $0.750');
		expect(transcript).toContain('- Wall time: 12s');
		expect(JSON.parse(fs.readFileSync(path.join(out, 'script.json'), 'utf8'))).toEqual({
			blueprint_id: 'mock-blueprint',
			persona: 'detective',
			inputs: ['search kitchen', 'quit'],
			checkpoints: [CHECKPOINT],
			end: CHECKPOINT
		});
		expect(fs.readFileSync(path.join(out, 'steps.jsonl'), 'utf8').trim().split('\n')).toHaveLength(3);
		expect(fs.readFileSync(path.join(out, 'ai-calls.jsonl'), 'utf8').trim().split('\n')).toEqual(['{"game_id":"game-1","cost_usd":0.05}']);
		expect(JSON.parse(fs.readFileSync(path.join(out, 'summary.json'), 'utf8'))).toEqual(summary);
	});

	it('says how a game that did not end cleanly got where it did', () => {
		const out = path.join(dir, 'game');
		writeGameFolder({
			...FOLDER,
			dir: out,
			callLogFile: path.join(dir, 'missing.jsonl'),
			game: game({
				result: null,
				stopReason: 'diverged',
				error: 'boom',
				divergence: { step: 2, input: null, differences: { mode: { expected: 'talk', actual: 'explore' } } }
			}),
			replay: { of: 'run/script.json', clueDrift: { step: 1, input: 'look', expected: ['a'], actual: [] } }
		});

		const transcript = fs.readFileSync(path.join(out, 'transcript.md'), 'utf8');
		expect(transcript).toContain('Replay of `run/script.json`.');
		expect(transcript).toContain('- Outcome: none (stopped: diverged)');
		expect(transcript).toContain('- Error: boom');
		expect(transcript).toContain('- Diverged: after the last input: mode was "talk", now "explore"');
		expect(transcript).toContain('- Clues first differed before step 1 (`look`)');
		expect(fs.existsSync(path.join(out, 'ai-calls.jsonl'))).toBe(false);
		expect(fs.existsSync(path.join(out, 'events.json'))).toBe(false);
	});

	it('names the step and line a divergence happened before', () => {
		const out = path.join(dir, 'game');
		writeGameFolder({
			...FOLDER,
			dir: out,
			callLogFile: null,
			game: game({ divergence: { step: 3, input: 'ask', differences: { location: { expected: 'a', actual: 'b' } } } })
		});
		expect(fs.readFileSync(path.join(out, 'transcript.md'), 'utf8')).toContain('- Diverged: before step 3 (`ask`): location was "a", now "b"');
	});
});

describe('reading the game database the run wrote', () => {
	it('reads the played events of one game, in order', () => {
		const { databasePath, sessionId } = createGameDatabase(dir);
		const events = readPlayedEvents(databasePath, sessionId);
		expect(events.map((event) => event.type)).toEqual(['start', 'search']);
		expect(events[1]).toMatchObject({ sequence: 2, payload: { search_query: 'the counter' } });
		expect(events[0].parts[0].text).toBe('You arrive in the kitchen.');
		expect(readPlayedEvents(databasePath, 'nobody')).toEqual([]);
	});

	it('copies the database consistently, leaving the source alone', async () => {
		const { databasePath, sessionId } = createGameDatabase(dir);
		const copy = path.join(dir, 'copy.db');
		await copyDatabase(databasePath, copy);
		expect(readPlayedEvents(copy, sessionId)).toHaveLength(2);
	});
});
