// Which clues earlier searches at a location revealed. The search events are
// the record: a search that found nothing reveals nothing, so the next search
// must not be handed the location's first clue as if it had been found.

import { describe, expect, it } from 'vitest';

import { collectRevealedClueIds } from '../../../packages/game-engine/src/endpoints/game-search.ts';

const CLUES = ['clue_gloves', 'clue_note', 'clue_drawings'];

function search(payload: Record<string, unknown>) {
	return { event_type: 'search', payload: { location_id: 'lab', ...payload } };
}

describe('collectRevealedClueIds', () => {
	it('counts nothing for a search that found nothing', () => {
		const history = [search({ revealed_clue_id: null, revealed_clue_ids: [] })];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual([]);
	});

	it('takes what each search recorded, in order', () => {
		const history = [
			search({ revealed_clue_id: null, revealed_clue_ids: [] }),
			search({ revealed_clue_id: 'clue_note', revealed_clue_ids: ['clue_note'] }),
			search({ revealed_clue_id: null, revealed_clue_ids: ['clue_note'] })
		];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual(['clue_note']);
	});

	it('ignores other locations and ids that are not this location’s clues', () => {
		const history = [
			{ event_type: 'search', payload: { location_id: 'hollow', revealed_clue_ids: ['clue_prints'] } },
			search({ revealed_clue_id: 'clue_elsewhere', revealed_clue_ids: ['clue_elsewhere'] }),
			{ event_type: 'move', payload: { location_id: 'lab' } }
		];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual([]);
	});

	it('counts an event that records only a null revealed_clue_id as finding nothing', () => {
		const history = [search({ revealed_clue_id: null })];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual([]);
	});

	it('trusts the record once any search at the location keeps one', () => {
		const history = [search({}), search({ revealed_clue_id: null, revealed_clue_ids: [] })];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual([]);
	});

	it('still infers from the count for events that record no reveals at all', () => {
		const history = [search({}), search({})];

		expect(collectRevealedClueIds(history, 'lab', CLUES)).toEqual(['clue_gloves', 'clue_note']);
	});
});
