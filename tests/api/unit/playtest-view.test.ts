// What the playtest investigator is shown is what a player sees — built from
// session state, never the blueprint. (What a typed line means is the engine's
// grammar, tested beside it.)

import { describe, expect, it } from 'vitest';

import type { GameState } from '../../../packages/shared/src/mystery-api-contracts.ts';
import { buildView } from '../../../evaluation/playtest/lib/view.ts';

// The shape `game-get` returns (see packages/game-engine/src/endpoints/game-get.ts).
function state(overrides: Record<string, unknown> = {}): GameState {
	return {
		premise: 'The cookies are gone.',
		mystery_summary: 'Someone took the cookies this morning.',
		locations: [
			{ id: 'loc-kitchen', name: 'Kitchen', summary: 'Warm and floury.' },
			{ id: 'loc-living-room', name: 'Living Room', summary: null }
		],
		characters: [
			{ id: 'char-alice', first_name: 'Alice', last_name: 'Smith', location_id: 'loc-kitchen', sex: 'female', summary: 'The baker.' },
			{ id: 'char-bob', first_name: 'Bob', last_name: 'Jones', location_id: 'loc-living-room', sex: 'male', summary: null }
		],
		discovered_clues: [
			{
				id: 'clue-crumb',
				text: 'A crumb on the floor.',
				source: 'search',
				origin: { kind: 'location', location_id: 'loc-kitchen', location_name: 'Kitchen' }
			}
		],
		time_remaining: 7,
		location: 'loc-kitchen',
		mode: 'explore',
		current_talk_character: null,
		...overrides
	} as unknown as GameState;
}

describe('playtest player view', () => {
	it('shows the status line, the notebook and the story so far', () => {
		const view = buildView({
			title: 'Mock Blueprint',
			state: state(),
			transcript: [
				{ kind: 'narration', speaker: 'Narrator', text: 'You arrive in the kitchen.' },
				{ kind: 'input', text: 'serch', plan: 'look around' },
				{ kind: 'feedback', text: 'Commands: ...' }
			]
		});

		expect(view).toContain('Location: Kitchen');
		expect(view).toContain('People here: Alice Smith');
		expect(view).toContain('Turns left: 7');
		expect(view).toContain('- Kitchen (you are here) — Alice Smith: Warm and floury.');
		expect(view).toContain('- Bob Jones (at Living Room)');
		expect(view).toContain('FOUND AT PLACES — Kitchen:\n- A crumb on the floor.');
		expect(view).toContain('Narrator: You arrive in the kitchen.\n> serch\n[game] Commands: ...');
		// The investigator's own plan is not part of what the player sees.
		expect(view).not.toContain('look around');
	});

	it('names who is being talked to', () => {
		const view = buildView({
			title: 'Mock Blueprint',
			state: state({ mode: 'talk', current_talk_character: 'char-alice' }),
			transcript: []
		});
		expect(view).toContain('Mode: Talking with Alice Smith');
	});
});
