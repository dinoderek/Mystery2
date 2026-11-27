// What the playtest investigator is shown is what a player sees — built from
// session state, never the blueprint. (What a typed line means is the engine's
// grammar, tested beside it.)

import { describe, expect, it } from 'vitest';

import type { GameState } from '../../../packages/shared/src/mystery-api-contracts.ts';
import { buildView } from '../../../evaluation/playtest/lib/view.ts';

// The shape `game-get` returns (see packages/game-engine/src/endpoints/game-get.ts).
function state(overrides: Record<string, unknown> = {}): GameState {
	return {
		story: 'The cookies are gone. Someone took them this morning.',
		locations: [
			{ id: 'loc-kitchen', name: 'Kitchen', summary: 'Warm and floury.' },
			{ id: 'loc-living-room', name: 'Living Room', summary: null }
		],
		characters: [
			{ id: 'char-alice', first_name: 'Alice', location_id: 'loc-kitchen', sex: 'female', summary: 'The baker.' },
			{ id: 'char-bob', first_name: 'Bob', location_id: 'loc-living-room', sex: 'male', summary: null }
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
		accusations_left: 3,
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

		expect(view).toContain('== NOTEBOOK: STORY ==\nThe cookies are gone. Someone took them this morning.\n');
		expect(view).toContain('Location: Kitchen');
		expect(view).toContain('People here: Alice');
		expect(view).toContain('Turns left: 7');
		expect(view).toContain('Accusations left: 3 of 3');
		expect(view).toContain('- Kitchen (you are here) — Alice: Warm and floury.');
		expect(view).toContain('- Bob (at Living Room)');
		expect(view).toContain('FOUND AT PLACES — Kitchen:\n- A crumb on the floor.');
		expect(view).toContain('Narrator: You arrive in the kitchen.\n> serch\n[game] Commands: ...');
		// The investigator's own plan is not part of what the player sees.
		expect(view).not.toContain('look around');
	});

	it('shows accusations left, the free way back, and exploring again after a failure', () => {
		const view = (overrides: Record<string, unknown>) =>
			buildView({ title: 'Mock Blueprint', state: state(overrides), transcript: [] });

		expect(view({ mode: 'accuse' })).toContain('Mode: Making your accusation (`back` returns to exploring, free)');
		// A failed accusation spends one and the state says exploring again.
		const failed = view({ mode: 'explore', accusations_left: 2 });
		expect(failed).toContain('Mode: Exploring');
		expect(failed).toContain('Accusations left: 2 of 3');
		// Out of turns there is no way back.
		const forced = view({ mode: 'accuse', time_remaining: 0, accusations_left: 1 });
		expect(forced).toContain('Mode: Making your accusation (no way back: the turns are spent)');
		expect(forced).toContain('Accusations left: 1 of 3');
	});

	it('names who is being talked to', () => {
		const view = buildView({
			title: 'Mock Blueprint',
			state: state({ mode: 'talk', current_talk_character: 'char-alice' }),
			transcript: []
		});
		expect(view).toContain('Mode: Talking with Alice');
	});

	it('shows a clue-graph case its leads and marks, as the notebook does', () => {
		const clue = (id: string, text: string, extra: Record<string, unknown>) => ({
			id,
			text,
			source: 'talk',
			origin: { kind: 'character', character_id: 'char-alice', character_name: 'Alice' },
			...extra
		});
		const view = buildView({
			title: 'Mock Blueprint',
			state: state({
				leads: [
					{ key: 'talk:char-bob', text: 'Bob may know more.', new: true },
					{ key: 'meet:char-alice', text: 'You have not talked to Alice yet.', new: false }
				],
				discovered_clues: [
					clue('alibi', 'I was baking all morning.', { kind: 'statement', taken_back: true }),
					clue('flour', 'Alice brushes flour off her sleeve.', { kind: 'tell', taken_back: false }),
					clue('saw', 'I saw Bob by the jar.', { kind: 'statement', taken_back: false })
				]
			}),
			transcript: []
		});

		expect(view).toContain(
			'== NOTEBOOK: WHAT TO DO NEXT ==\n- Bob may know more. [NEW]\n- You have not talked to Alice yet.\n\n== NOTEBOOK: CLUES =='
		);
		expect(view).toContain('- I was baking all morning. (taken back)');
		expect(view).toContain('- Alice brushes flour off her sleeve. (noticed)');
		expect(view).toContain('- I saw Bob by the jar.\n');
	});

	it('has no leads section for a case that sends none', () => {
		expect(buildView({ title: 'Mock Blueprint', state: state(), transcript: [] })).not.toContain('WHAT TO DO NEXT');
	});
});
