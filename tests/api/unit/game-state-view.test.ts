import { describe, expect, it } from "vitest";

import { buildGameState } from "../../../packages/game-engine/src/game-state-view.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

/**
 * The game state is what the notebook shows before anything is discovered: the
 * case's public reference data and where the game stands.
 */

const CASE = readMockCase();

const STANDING = {
  discovered_clues: [],
  leads: [],
  time_remaining: 7,
  accusations_left: 3,
  location: "loc-kitchen",
  mode: "explore" as const,
  current_talk_character: null,
};

describe("buildGameState", () => {
  it("lists each place and person, who go by one name and have no one-line summary", () => {
    const state = buildGameState(CASE, STANDING);

    expect(state.premise).toBe(CASE.narrative.premise);
    expect(state.mystery_summary).toBe(CASE.narrative.starting_knowledge.mystery_summary);
    expect(state.locations.find((l) => l.id === "loc-kitchen")).toEqual({ id: "loc-kitchen", name: "Kitchen", summary: null });
    expect(state.characters.find((c) => c.id === "char-alice")).toEqual({
      id: "char-alice",
      first_name: "Alice",
      last_name: "",
      location_id: "loc-kitchen",
      sex: expect.any(String),
      summary: null,
    });
  });

  it("does not say who the culprit is", () => {
    const state = buildGameState(CASE, STANDING);

    expect(JSON.stringify(state)).not.toContain("is_culprit");
    for (const character of state.characters) {
      expect(Object.keys(character)).not.toContain("is_culprit");
    }
  });

  it("carries where the game stands, unchanged", () => {
    expect(buildGameState(CASE, STANDING)).toMatchObject(STANDING);
  });
});
