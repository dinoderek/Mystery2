// Which of the narrator's reported clue ids an ask turn records. Only a
// first-time reveal of the active character's own clue is a discovery; a clue
// the player already holds may be restated, but it is not recorded again.

import { describe, expect, it } from 'vitest';

import { selectFirstTimeReveals } from '../../../packages/game-engine/src/endpoints/game-ask.ts';

const SOPHIE = new Set(['clue_splinter', 'clue_sawdust', 'clue_secret']);

describe('selectFirstTimeReveals', () => {
	it('records nothing when the narrator re-lists a clue the player holds', () => {
		const reveals = selectFirstTimeReveals(
			{ revealed_clue_ids: ['clue_splinter'], revealed_off_script: [] },
			SOPHIE,
			new Set(['clue_splinter'])
		);

		expect(reveals).toEqual({
			revealed_clue_ids: [],
			revealed_off_script: [],
			repeated_clue_ids: ['clue_splinter']
		});
	});

	it('keeps first-time reveals beside a repeat', () => {
		const reveals = selectFirstTimeReveals(
			{ revealed_clue_ids: ['clue_splinter', 'clue_sawdust'], revealed_off_script: [] },
			SOPHIE,
			new Set(['clue_splinter', 'clue_elsewhere'])
		);

		expect(reveals.revealed_clue_ids).toEqual(['clue_sawdust']);
		expect(reveals.repeated_clue_ids).toEqual(['clue_splinter']);
	});

	it('leaves a first-time reveal untouched', () => {
		const reveals = selectFirstTimeReveals(
			{ revealed_clue_ids: ['clue_splinter'], revealed_off_script: [] },
			SOPHIE,
			new Set()
		);

		expect(reveals).toEqual({
			revealed_clue_ids: ['clue_splinter'],
			revealed_off_script: [],
			repeated_clue_ids: []
		});
	});

	it('drops a repeated off-script grant and keeps a new one', () => {
		const reveals = selectFirstTimeReveals(
			{
				revealed_clue_ids: ['clue_secret', 'clue_sawdust'],
				revealed_off_script: ['clue_secret', 'clue_sawdust']
			},
			SOPHIE,
			new Set(['clue_secret'])
		);

		expect(reveals.revealed_clue_ids).toEqual(['clue_sawdust']);
		expect(reveals.revealed_off_script).toEqual(['clue_sawdust']);
		expect(reveals.repeated_clue_ids).toEqual(['clue_secret']);
	});

	it("ignores ids that are not the character's own clues", () => {
		const reveals = selectFirstTimeReveals(
			{ revealed_clue_ids: ['clue_elsewhere', 'clue_sawdust'], revealed_off_script: ['clue_elsewhere'] },
			SOPHIE,
			new Set(['clue_elsewhere'])
		);

		expect(reveals).toEqual({
			revealed_clue_ids: ['clue_sawdust'],
			revealed_off_script: [],
			repeated_clue_ids: []
		});
	});
});
