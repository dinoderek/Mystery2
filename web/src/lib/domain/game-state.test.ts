import { describe, expect, it } from 'vitest';
import { toGameState } from './game-state';
import {
  createGameState,
  createNotebookLead,
  createRevealedClue,
} from '../../../../tests/testkit/src/fixtures';

describe('toGameState', () => {
  it('keeps the leads and the marks a clue-graph game sends', () => {
    const state = toGameState(
      createGameState({
        discovered_clues: [createRevealedClue({ kind: 'statement', taken_back: true })],
        leads: [createNotebookLead({ new: true })],
      }),
      [],
    );

    expect(state.leads).toEqual([{ key: 'talk:thorne', text: 'Mr. Thorne may know more.', new: true }]);
    expect(state.discovered_clues[0]).toMatchObject({ kind: 'statement', taken_back: true });
  });

  it('has no leads for a case that sends none', () => {
    expect(toGameState(createGameState(), []).leads).toEqual([]);
  });
});
