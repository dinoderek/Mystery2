// The playtest investigator's inputs are routed like the browser's, and what it
// is shown is what a player sees — built from session state, never the
// blueprint.

import { describe, expect, it } from 'vitest';

import { resolveInput } from '../../../evaluation/playtest/lib/commands.mjs';
import { buildView } from '../../../evaluation/playtest/lib/view.mjs';

// The shape `game-get` returns (see packages/game-engine/src/endpoints/game-get.ts).
function state(overrides: Record<string, unknown> = {}) {
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
	};
}

describe('playtest input routing', () => {
	it('sends explore commands to their endpoints with ids, not names', () => {
		expect(resolveInput('talk to alice', state(), 'g1')).toMatchObject({
			kind: 'call',
			endpoint: 'game-talk',
			body: { game_id: 'g1', character_id: 'char-alice' }
		});
		expect(resolveInput('go to the living room', state(), 'g1')).toMatchObject({
			endpoint: 'game-move',
			body: { destination: 'loc-living-room' }
		});
		expect(resolveInput('search', state(), 'g1')).toMatchObject({
			endpoint: 'game-search',
			body: { search_query: null }
		});
		expect(resolveInput('accuse Alice because of the crumbs', state(), 'g1')).toMatchObject({
			endpoint: 'game-accuse',
			body: { player_reasoning: 'Alice because of the crumbs' }
		});
	});

	it('routes free text by mode: a question in talk mode, reasoning in accuse mode', () => {
		const talking = state({ mode: 'talk', current_talk_character: 'char-alice' });
		expect(resolveInput('Where were you?', talking, 'g1')).toMatchObject({
			endpoint: 'game-ask',
			body: { player_input: 'Where were you?' }
		});
		expect(resolveInput('bye', talking, 'g1')).toMatchObject({ endpoint: 'game-end-talk' });

		expect(resolveInput('It was Alice.', state({ mode: 'accuse' }), 'g1')).toMatchObject({
			endpoint: 'game-accuse',
			body: { player_reasoning: 'It was Alice.' }
		});
	});

	it('answers what the parser rejects with the UI wording, and stops on quit', () => {
		expect(resolveInput('talk to Bob', state(), 'g1')).toMatchObject({
			kind: 'feedback',
			text: '"bob" is not a valid character. Try: Alice Smith.'
		});
		expect(resolveInput('go to', state(), 'g1')).toMatchObject({
			kind: 'feedback',
			text: expect.stringMatching(/^Where to\? Try: Kitchen, Living Room/)
		});
		expect(resolveInput('dance', state(), 'g1')).toMatchObject({
			kind: 'feedback',
			text: expect.stringContaining('Commands: move to/go to <location>')
		});
		expect(resolveInput('notebook', state(), 'g1')).toMatchObject({ kind: 'feedback' });
		expect(resolveInput('quit', state(), 'g1')).toEqual({ kind: 'quit' });
	});
});

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
