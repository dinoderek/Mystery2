import { describe, expect, it } from "vitest";

import { reconstructTrace, revealedClueIdsForEvent } from "../../../evaluation/trace/lib/reconstruct.mjs";
import { makeRawTrace } from "./trace-fixtures";

type Turn = {
  sequence: number;
  role_name: string | null;
  character_id: string | null;
  context_error: string | null;
  pre_state: { mode: string; current_location_id: string | null };
  reconstructed_context: {
    search_context?: { location_id?: string; next_clue?: { id?: string } | null } | null;
    talk_context?: { active_character?: { id?: string } } | null;
    accusation_judge_context?: unknown | null;
  } | null;
};

function turnBySeq(turns: Turn[], seq: number): Turn {
  const found = turns.find((t) => t.sequence === seq);
  if (!found) throw new Error(`no turn ${seq}`);
  return found;
}

describe("revealedClueIdsForEvent", () => {
  it("reads singular, plural, and column forms", () => {
    expect(revealedClueIdsForEvent({ payload: { revealed_clue_id: "a" }, clues_revealed: [] })).toEqual(["a"]);
    expect(revealedClueIdsForEvent({ payload: { revealed_clue_ids: ["a", "b"] }, clues_revealed: [] })).toEqual(["a", "b"]);
    expect(revealedClueIdsForEvent({ payload: null, clues_revealed: ["c"] })).toEqual(["c"]);
  });
});

describe("reconstructTrace", () => {
  const { turns, final_state, issues } = reconstructTrace(makeRawTrace());

  it("emits one turn per event in sequence order with mapped roles", () => {
    expect(turns.map((t: { sequence: number }) => t.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(turnBySeq(turns, 1).role_name).toBeNull(); // start has no AI role
    expect(turnBySeq(turns, 2).role_name).toBe("search");
    expect(turnBySeq(turns, 3).role_name).toBe("talk_start");
    expect(turnBySeq(turns, 4).role_name).toBe("talk_conversation");
    expect(turnBySeq(turns, 6).role_name).toBe("move");
    expect(turnBySeq(turns, 9).role_name).toBe("accusation_judge");
  });

  it("folds session state (location, talk character, mode) across the trace", () => {
    // Pre-state of the garden search reflects the earlier move.
    expect(turnBySeq(turns, 7).pre_state.current_location_id).toBe("loc_garden");
    // While talking, the ask turn is scoped to the active character.
    expect(turnBySeq(turns, 4).character_id).toBe("char_mara");
    expect(final_state.mode).toBe("ended");
  });

  it("reconstructs the search context with the real builder", () => {
    const search = turnBySeq(turns, 2);
    expect(search.context_error).toBeNull();
    expect(search.reconstructed_context?.search_context?.location_id).toBe("loc_hall");
    // First bare search in the hall: next_clue is the first location clue.
    expect(search.reconstructed_context?.search_context?.next_clue?.id).toBe("clue_hall_1");
  });

  it("reconstructs talk context scoped to the active character", () => {
    const talk = turnBySeq(turns, 3);
    expect(talk.context_error).toBeNull();
    expect(talk.reconstructed_context?.talk_context?.active_character?.id).toBe("char_mara");
  });

  it("keeps full-blueprint ground truth only in the accusation judge context", () => {
    expect(turnBySeq(turns, 9).reconstructed_context?.accusation_judge_context).not.toBeNull();
    // Non-judge roles must never carry the judge-only context (spoiler safety,
    // enforced by the real builder's assertRoleContextSafety).
    expect(turnBySeq(turns, 2).reconstructed_context?.accusation_judge_context).toBeNull();
    expect(issues).toHaveLength(0);
  });
});
