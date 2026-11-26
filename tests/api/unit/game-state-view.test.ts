import { describe, expect, it } from "vitest";

import { buildGameState, storyOf } from "../../../packages/game-engine/src/game-state-view.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

/**
 * The game state is what the notebook shows before anything is discovered: the
 * case's places and people, the opening as narrated, and where the game stands.
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
    const state = buildGameState(CASE, null, STANDING);

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
    const state = buildGameState(CASE, null, STANDING);

    expect(JSON.stringify(state)).not.toContain("is_culprit");
    for (const character of state.characters) {
      expect(Object.keys(character)).not.toContain("is_culprit");
    }
  });

  it("carries where the game stands, unchanged", () => {
    expect(buildGameState(CASE, null, STANDING)).toMatchObject(STANDING);
  });

  it("tells the Story as it was narrated, never as the case wrote it", () => {
    const state = buildGameState(CASE, "You stand in a warm kitchen.", STANDING);

    expect(state.story).toBe("You stand in a warm kitchen.");
    expect(JSON.stringify(state)).not.toContain(CASE.narrative.premise);
    expect(Object.keys(state)).not.toContain("premise");
    expect(Object.keys(state)).not.toContain("mystery_summary");
  });
});

describe("storyOf", () => {
  const part = (text: string) => ({ text, speaker: { kind: "narrator" as const, key: "narrator", label: "Narrator" } });

  it("is the start event's narrated opening, not the notebook tip after it", () => {
    expect(storyOf([
      { sequence: 1, event_type: "start", narration_parts: [part("You stand in a warm kitchen."), part("Tip: type notebook.")] },
      { sequence: 2, event_type: "move", narration_parts: [part("You arrive.")] },
    ])).toBe("You stand in a warm kitchen.");
  });

  it("is null for a game with no start event", () => {
    expect(storyOf([{ sequence: 2, event_type: "move", narration_parts: [part("You arrive.")] }])).toBeNull();
  });
});
