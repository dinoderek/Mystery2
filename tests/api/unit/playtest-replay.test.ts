// A playtest replay types a recorded game's inputs again, and stops where the
// game no longer matches the recording: another mode, place, person being
// talked to, or people in the room, or a game that ends sooner or later than
// the recording. Found clues may differ without stopping it.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { scriptedInvestigator } from '../../../evaluation/playtest/lib/investigator.mjs';
import {
	checkpointOf,
	compareCheckpoints,
	loadScript
} from '../../../evaluation/playtest/lib/replay.mjs';

// The shape `game-get` returns (see packages/game-engine/src/endpoints/game-get.ts).
function state(overrides: Record<string, unknown> = {}) {
	return {
		premise: 'The cookies are gone.',
		locations: [
			{ id: 'loc-kitchen', name: 'Kitchen' },
			{ id: 'loc-living-room', name: 'Living Room' }
		],
		characters: [
			{ id: 'char-alice', first_name: 'Alice', last_name: 'Smith', location_id: 'loc-kitchen', sex: 'female' },
			{ id: 'char-bob', first_name: 'Bob', last_name: 'Jones', location_id: 'loc-living-room', sex: 'male' }
		],
		discovered_clues: [{ id: 'clue-crumb', text: 'A crumb.', source: 'search' }],
		time_remaining: 7,
		location: 'loc-kitchen',
		mode: 'explore',
		current_talk_character: null,
		...overrides
	};
}

let scratch: string | null = null;

afterEach(() => {
	if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
	scratch = null;
});

describe('playtest checkpoints', () => {
	it('records mode, place, talk partner, people here and found clues', () => {
		expect(checkpointOf(state())).toEqual({
			mode: 'explore',
			location: 'loc-kitchen',
			talk_character: null,
			people_here: ['Alice Smith'],
			clues: ['clue-crumb']
		});
		expect(checkpointOf(state({ mode: 'talk', current_talk_character: 'char-alice' }))).toMatchObject({
			mode: 'talk',
			talk_character: 'char-alice'
		});
	});

	it('blocks on a changed place, mode or partner, and only notes changed clues', () => {
		const recorded = checkpointOf(state());

		expect(compareCheckpoints(recorded, checkpointOf(state()))).toEqual({ blocking: null, clues: null });
		expect(compareCheckpoints(recorded, checkpointOf(state({ location: 'loc-living-room' })))).toEqual({
			blocking: {
				location: { expected: 'loc-kitchen', actual: 'loc-living-room' },
				people_here: { expected: ['Alice Smith'], actual: ['Bob Jones'] }
			},
			clues: null
		});
		expect(compareCheckpoints(recorded, checkpointOf(state({ discovered_clues: [] })))).toEqual({
			blocking: null,
			clues: { expected: ['clue-crumb'], actual: [] }
		});
	});
});

describe('playtest scripted investigator', () => {
	it('stops with the divergence instead of typing a line that no longer fits', async () => {
		const recorded = [checkpointOf(state()), checkpointOf(state())];
		const investigator = scriptedInvestigator(['search', 'talk to alice'], { checkpoints: recorded });

		expect(await investigator.next('', { checkpoint: checkpointOf(state()) })).toMatchObject({ input: 'search' });
		expect(
			await investigator.next('', {
				checkpoint: checkpointOf(state({ mode: 'accuse' }))
			})
		).toEqual({
			divergence: {
				step: 2,
				input: 'talk to alice',
				differences: { mode: { expected: 'explore', actual: 'accuse' } }
			}
		});
	});

	it('keeps the first clue difference and carries on', async () => {
		const recorded = [checkpointOf(state()), checkpointOf(state())];
		const investigator = scriptedInvestigator(['search', 'search'], { checkpoints: recorded });
		const noClues = checkpointOf(state({ discovered_clues: [] }));

		expect(await investigator.next('', { checkpoint: noClues })).toMatchObject({ input: 'search' });
		expect(await investigator.next('', { checkpoint: noClues })).toMatchObject({ input: 'search' });
		expect(await investigator.next('', { checkpoint: noClues })).toBeNull();
		expect(investigator.clueDrift).toEqual({
			step: 1,
			input: 'search',
			expected: ['clue-crumb'],
			actual: []
		});
	});

	it('plays every line without checks when the script has no checkpoints', async () => {
		const investigator = scriptedInvestigator(['go to living room']);
		expect(
			await investigator.next('', { checkpoint: checkpointOf(state({ mode: 'ended' })) })
		).toMatchObject({ input: 'go to living room' });
	});

	it('reports a game that ended while the script had more to type', async () => {
		const recorded = [checkpointOf(state()), checkpointOf(state({ mode: 'accuse' }))];
		const investigator = scriptedInvestigator(['accuse', 'Alice did it'], { checkpoints: recorded });
		const ended = checkpointOf(state({ mode: 'ended' }));

		expect(investigator.finish(ended)).toMatchObject({ step: 1, input: 'accuse' });
		await investigator.next('', { checkpoint: checkpointOf(state()) });
		expect(investigator.finish(ended)).toEqual({
			step: 2,
			input: 'Alice did it',
			differences: { mode: { expected: 'accuse', actual: 'ended' } }
		});
		// A script without checkpoints (a hand-written one) may run past the end.
		expect(scriptedInvestigator(['search']).finish(ended)).toBeNull();
	});

	it('compares where the game stands after the last input with the recorded end', async () => {
		const accusing = checkpointOf(state({ mode: 'accuse' }));
		const investigator = scriptedInvestigator(['accuse'], {
			checkpoints: [checkpointOf(state())],
			end: checkpointOf(state({ mode: 'ended' }))
		});

		await investigator.next('', { checkpoint: checkpointOf(state()) });
		expect(await investigator.next('', { checkpoint: accusing })).toEqual({
			divergence: { step: 2, input: null, differences: { mode: { expected: 'ended', actual: 'accuse' } } }
		});
		expect(investigator.finish(checkpointOf(state({ mode: 'ended' })))).toBeNull();
	});
});

describe('playtest script files', () => {
	function write(content: unknown) {
		scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'mystery-replay-'));
		const file = path.join(scratch, 'script.json');
		fs.writeFileSync(file, JSON.stringify(content));
		return file;
	}

	it('reads inputs and checkpoints, and accepts a script saved without checkpoints', () => {
		const checkpoint = checkpointOf(state());
		expect(
			loadScript(write({ blueprint_id: 'bp', persona: 'kid-7', inputs: ['search'], checkpoints: [checkpoint] }))
		).toEqual({ blueprintId: 'bp', persona: 'kid-7', inputs: ['search'], checkpoints: [checkpoint], end: null });
		expect(
			loadScript(write({ blueprint_id: 'bp', inputs: ['search'], checkpoints: [checkpoint], end: checkpoint })).end
		).toEqual(checkpoint);
		expect(loadScript(write({ blueprint_id: 'bp', inputs: ['search'] }))).toMatchObject({
			persona: 'unknown',
			checkpoints: null,
			end: null
		});
	});

	it('rejects a script whose checkpoints do not line up with its inputs', () => {
		expect(() =>
			loadScript(write({ blueprint_id: 'bp', inputs: ['a', 'b'], checkpoints: [checkpointOf(state())] }))
		).toThrow(/2 inputs but 1 checkpoints/);
		expect(() => loadScript(write({ inputs: ['a'] }))).toThrow(/no "blueprint_id"/);
		expect(() => loadScript(write({ blueprint_id: 'bp', inputs: [1] }))).toThrow(/list of strings/);
	});
});
