// One self-play game against a fake game API: how each kind of answer to a typed
// line lands in the transcript and the step record, when the game stops and why,
// and that a replay that has drifted is stopped rather than played on. The real
// API is tests/api/integration/playtest.test.ts.

import { describe, expect, it } from 'vitest';

import type { GameState } from '../../../packages/shared/src/mystery-api-contracts.ts';
import type { ApiResponse, GameApi } from '../../../evaluation/playtest/lib/api.ts';
import { playGame } from '../../../evaluation/playtest/lib/game.ts';
import type { Decision, Investigator } from '../../../evaluation/playtest/lib/investigator.ts';
import { checkpointOf } from '../../../evaluation/playtest/lib/replay.ts';
import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.ts';

const BLUEPRINT = { id: 'mock-blueprint', title: 'Mock Blueprint' };

function state(overrides: Record<string, unknown> = {}): GameState {
	return {
		premise: 'The cookies are gone.',
		mystery_summary: 'Someone took the cookies.',
		locations: [{ id: 'loc-kitchen', name: 'Kitchen', summary: null }],
		characters: [],
		discovered_clues: [],
		time_remaining: 5,
		location: 'loc-kitchen',
		mode: 'explore',
		current_talk_character: null,
		...overrides
	} as unknown as GameState;
}

const ok = <T,>(body: unknown, status = 200) => ({ ok: true, status, body }) as ApiResponse<T>;
const failed = <T,>(status: number, error?: string) => ({ ok: false, status, body: { error } }) as ApiResponse<T>;
const narration = (text: string, label?: string) => ({ text, speaker: label ? { label } : undefined });

type Handler = (body: Record<string, unknown>) => ApiResponse<unknown>;

/** A game API whose game-turn answers come from `turns` in order, and whose game-get answers `states` (the last one repeating). */
function fakeApi({
	turns = [],
	states = [state()],
	start = () => ok({ game_id: 'game-1', state: state(), narration_events: [{ narration_parts: [narration('Welcome.')] }] }),
	enter = () => ok({ narration_parts: [narration('You arrive.', 'Narrator')] })
}: {
	turns?: Handler[];
	states?: Array<GameState | null>;
	start?: Handler;
	enter?: Handler;
}) {
	const posted: Array<{ endpoint: string; body: Record<string, unknown> }> = [];
	let turn = 0;
	let read = 0;
	const api: GameApi = {
		async get(endpoint) {
			expect(endpoint).toBe('game-get');
			const next = states[Math.min(read, states.length - 1)];
			read += 1;
			return next ? ok({ state: next }) : failed(500, 'database is gone');
		},
		async post(endpoint, body) {
			const payload = (body ?? {}) as Record<string, unknown>;
			posted.push({ endpoint, body: payload });
			if (endpoint === 'game-start') return start(payload) as never;
			if (endpoint === 'game-enter') return enter(payload) as never;
			const handler = turns[turn];
			turn += 1;
			return (handler ? handler(payload) : failed(500, 'no more answers')) as never;
		}
	};
	return { api, posted };
}

function typing(...inputs: string[]): Investigator {
	let index = 0;
	return {
		kind: 'model',
		calls: [],
		async next(): Promise<Decision | null> {
			if (index >= inputs.length) return null;
			const input = inputs[index];
			index += 1;
			return { input, plan: `plan ${index}`, model: 'stub-model', cost_usd: 0.5, attempts: 2 };
		}
	};
}

const played = (text: string, extra: Record<string, unknown> = {}) =>
	() => ok({ kind: 'turn', events: [{ event_type: 'search', narration_parts: [narration(text)] }], ...extra });

describe('how a game opens', () => {
	it('narrates the premise and the arrival before the investigator sees anything', async () => {
		const { api, posted } = fakeApi({});

		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing() });

		expect(posted.map((call) => call.endpoint)).toEqual(['game-start', 'game-enter']);
		expect(posted[0].body).toEqual({ blueprint_id: 'mock-blueprint' });
		expect(game.transcript).toEqual([
			{ kind: 'narration', speaker: 'Narrator', text: 'Welcome.' },
			{ kind: 'narration', speaker: 'Narrator', text: 'You arrive.' }
		]);
		expect(game).toMatchObject({ gameId: 'game-1', stopReason: 'no-more-input', result: null, error: null, steps: [] });
	});

	it('says "Action completed." when entering narrates nothing, and records a failed enter as an error line', async () => {
		const empty = fakeApi({ enter: () => ok({}) });
		expect((await playGame({ api: empty.api, blueprint: BLUEPRINT, investigator: typing() })).transcript.at(-1)).toEqual({
			kind: 'narration',
			speaker: 'Narrator',
			text: 'Action completed.'
		});

		const broken = fakeApi({ enter: () => failed(500, 'narrator down') });
		expect((await playGame({ api: broken.api, blueprint: BLUEPRINT, investigator: typing() })).transcript.at(-1)).toEqual({
			kind: 'error',
			text: 'Request failed: narrator down'
		});
	});

	it('throws when the game cannot be started', async () => {
		const { api } = fakeApi({ start: () => failed(404, 'no such blueprint') });
		await expect(playGame({ api, blueprint: BLUEPRINT, investigator: typing() })).rejects.toThrow('game-start failed: no such blueprint');
	});

	it('gives up at once when the state cannot be read after opening', async () => {
		const { api } = fakeApi({ states: [null] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('look') });
		expect(game).toMatchObject({ stopReason: 'errors', error: 'game-get: database is gone', steps: [] });
	});
});

describe('what each answer to a typed line does', () => {
	it('records a played turn: narration, the step, and the state after it, with the win', async () => {
		const { api, posted } = fakeApi({
			turns: [played('You find a crumb.', { result: 'win' })],
			states: [state(), state({ time_remaining: 4, mode: 'ended' })]
		});
		const seen: number[] = [];

		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('search kitchen'), onStep: (step) => seen.push(step.step) });

		expect(posted.at(-1)).toEqual({ endpoint: 'game-turn', body: { game_id: 'game-1', input: 'search kitchen' } });
		expect(game.transcript.slice(-2)).toEqual([
			{ kind: 'input', text: 'search kitchen', plan: 'plan 1' },
			{ kind: 'narration', speaker: 'Narrator', text: 'You find a crumb.' }
		]);
		expect(game).toMatchObject({ result: 'win', stopReason: 'ended', script: ['search kitchen'] });
		expect(game.steps[0]).toMatchObject({
			step: 1,
			mode_before: 'explore',
			time_before: 5,
			mode_after: 'ended',
			time_after: 4,
			input: 'search kitchen',
			investigator: { model: 'stub-model', cost_usd: 0.5, attempts: 2 },
			action: { kind: 'turn', event_type: 'search' }
		});
		expect(game.checkpoints).toEqual([checkpointOf(state())]);
		expect(game.finalState.mode).toBe('ended');
		expect(seen).toEqual([1]);
	});

	it('says "Action completed." for a played turn that saved no narration', async () => {
		const { api } = fakeApi({ turns: [() => ok({ kind: 'turn', events: [] })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('wait') });
		expect(game.transcript.at(-1)).toEqual({ kind: 'narration', speaker: 'Narrator', text: 'Action completed.' });
		expect(game.steps[0].action).toEqual({ kind: 'turn', event_type: null });
	});

	it('echoes a refusal with its hint and does not re-read the game', async () => {
		const { api } = fakeApi({ turns: [() => ok({ kind: 'refused', reason: 'unknown', hint: 'Try: search <thing>' })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('serch') });
		expect(game.transcript.slice(-2)).toEqual([
			{ kind: 'input', text: 'serch', plan: 'plan 1' },
			{ kind: 'feedback', text: 'Try: search <thing>' }
		]);
		expect(game.steps[0].action).toEqual({ kind: 'refused', reason: 'unknown', text: 'Try: search <thing>' });
		expect(game.steps[0].time_after).toBe(5);
	});

	it('echoes help, but opens the notebook without echoing the line', async () => {
		const { api } = fakeApi({
			turns: [
				() => ok({ kind: 'view', view: 'help', section: null, note: 'Commands: look, search' }),
				() => ok({ kind: 'view', view: 'notebook', section: 'clues' }),
				() => ok({ kind: 'view', view: 'notebook', section: null })
			]
		});
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('help', 'notebook clues', 'notebook') });
		expect(game.transcript.slice(2)).toEqual([
			{ kind: 'input', text: 'help', plan: 'plan 1' },
			{ kind: 'feedback', text: 'Commands: look, search' },
			{ kind: 'feedback', text: '(The notebook opens at clues: it is the NOTEBOOK sections of your view.)' },
			{ kind: 'feedback', text: '(The notebook opens: it is the NOTEBOOK sections of your view.)' }
		]);
		expect(game.steps.map((step) => step.action.kind)).toEqual(['view', 'view', 'view']);
	});

	it('help with no note answers with an empty line', async () => {
		const { api } = fakeApi({ turns: [() => ok({ kind: 'view', view: 'help', section: null })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('help') });
		expect(game.transcript.at(-1)).toEqual({ kind: 'feedback', text: '' });
	});

	it('stops on quit without recording the state after it', async () => {
		const { api } = fakeApi({ turns: [() => ok({ kind: 'quit' })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('quit', 'look') });
		expect(game.stopReason).toBe('quit');
		expect(game.steps).toHaveLength(1);
		expect(game.steps[0].mode_after).toBeUndefined();
	});

	it('records a failed call as an error line and reads the game again, since it may have saved', async () => {
		const { api } = fakeApi({
			turns: [() => failed(500, 'narrator timed out'), played('You look.')],
			states: [state(), state({ time_remaining: 4 })]
		});
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('look', 'look') });
		expect(game.transcript).toContainEqual({ kind: 'error', text: 'Request failed: narrator timed out' });
		expect(game.steps[0]).toMatchObject({ action: { kind: 'failed', status: 500 }, response: { ok: false, status: 500 } });
		expect(game.steps[0].time_after).toBe(4);
		// The next played turn clears the count, so two failures apart are not a run.
		expect(game.error).toBeNull();
	});

	it('names the status when a failure says nothing else', async () => {
		const { api } = fakeApi({ turns: [() => failed(503)] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('look') });
		expect(game.transcript.at(-1)).toEqual({ kind: 'error', text: 'Request failed: status 503' });
	});

	it('abandons the game after three failed calls in a row', async () => {
		const { api } = fakeApi({ turns: [() => failed(500, 'a'), () => failed(500, 'b'), () => failed(500, 'c'), played('never reached')] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('a', 'b', 'c', 'd') });
		expect(game).toMatchObject({ stopReason: 'errors', error: '3 calls in a row failed' });
		expect(game.steps).toHaveLength(3);
	});

	it('stops with errors when the state cannot be read after a played turn', async () => {
		const { api } = fakeApi({ turns: [played('You look.')], states: [state(), null] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('look', 'look') });
		expect(game).toMatchObject({ stopReason: 'errors', error: 'game-get: database is gone' });
	});
});

describe('when the game stops', () => {
	it('stops at the step cap', async () => {
		const { api } = fakeApi({ turns: [played('one'), played('two'), played('three')] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('a', 'b', 'c'), maxSteps: 2 });
		expect(game.stopReason).toBe('step-cap');
		expect(game.steps).toHaveLength(2);
	});

	it('ends its own game with the investigator-error reason and keeps what was played', async () => {
		const { api } = fakeApi({ turns: [played('one')] });
		const investigator = typing('a');
		const next = investigator.next.bind(investigator);
		let calls = 0;
		investigator.next = async (...args) => {
			calls += 1;
			if (calls > 1) throw new Error('claude exited 1');
			return next(...args);
		};
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator });
		expect(game).toMatchObject({ stopReason: 'investigator-error', error: 'investigator: claude exited 1' });
		expect(game.steps).toHaveLength(1);
	});

	it('records a non-Error failure by its text', async () => {
		const { api } = fakeApi({});
		const investigator: Investigator = {
			kind: 'model',
			calls: [],
			async next() {
				throw 'plain text';
			}
		};
		expect((await playGame({ api, blueprint: BLUEPRINT, investigator })).error).toBe('investigator: plain text');
	});

	it('stops at once when the game was already over, a clean end for a model investigator', async () => {
		const { api } = fakeApi({ states: [state({ mode: 'ended' })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: typing('look') });
		expect(game).toMatchObject({ stopReason: 'ended', divergence: null, steps: [] });
	});
});

describe('replaying a recording', () => {
	it('plays a recording that still matches to its end', async () => {
		const start = checkpointOf(state());
		const end = checkpointOf(state({ mode: 'ended', time_remaining: 4 }));
		const { api } = fakeApi({ turns: [played('You look.')], states: [state(), state({ mode: 'ended', time_remaining: 4 })] });
		const game = await playGame({ api, blueprint: BLUEPRINT, investigator: scriptedInvestigator(['look'], { checkpoints: [start], end }) });
		expect(game).toMatchObject({ stopReason: 'ended', divergence: null, script: ['look'] });
	});

	it('stops where the game is no longer where the recording was', async () => {
		const recorded = checkpointOf(state({ location: 'loc-kitchen', mode: 'talk', current_talk_character: 'char-alice' }));
		const { api } = fakeApi({});
		const game = await playGame({
			api,
			blueprint: BLUEPRINT,
			investigator: scriptedInvestigator(['ask'], { checkpoints: [recorded], end: recorded })
		});
		expect(game.stopReason).toBe('diverged');
		expect(game.divergence).toMatchObject({ step: 1, input: 'ask', differences: { mode: { expected: 'talk', actual: 'explore' } } });
		expect(game.steps).toEqual([]);
	});

	it('is diverged when the game ended before the recording ran out', async () => {
		const start = checkpointOf(state());
		const { api } = fakeApi({ states: [state({ mode: 'ended' })] });
		const game = await playGame({
			api,
			blueprint: BLUEPRINT,
			investigator: scriptedInvestigator(['look', 'look'], { checkpoints: [start, start], end: start })
		});
		expect(game.stopReason).toBe('diverged');
		expect(game.divergence).toMatchObject({ step: 1, input: 'look' });
	});
});
