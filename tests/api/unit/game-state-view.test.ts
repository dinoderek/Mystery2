import { describe, expect, it } from "vitest";

import {
  BlueprintV2Schema,
  type BlueprintV2,
} from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { buildGameState } from "../../../packages/game-engine/src/game-state-view.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

/**
 * The game state is what the notebook shows before anything is discovered: the
 * blueprint's public reference data and where the game stands.
 */

const BLUEPRINT = BlueprintV2Schema.parse(validBlueprintV2);

const STANDING = {
  discovered_clues: [],
  time_remaining: 7,
  location: "kitchen",
  mode: "explore" as const,
  current_talk_character: null,
};

function withStartingKnowledge(
  startingKnowledge: BlueprintV2["narrative"]["starting_knowledge"] | undefined,
): BlueprintV2 {
  return {
    ...BLUEPRINT,
    narrative: {
      ...BLUEPRINT.narrative,
      starting_knowledge: startingKnowledge,
    },
  } as BlueprintV2;
}

describe("buildGameState", () => {
  it("joins each place and person with the summary the player starts knowing", () => {
    const state = buildGameState(BLUEPRINT, STANDING);

    expect(state.premise).toBe(BLUEPRINT.narrative.premise);
    expect(state.mystery_summary).toContain("cookies disappeared");
    expect(state.locations.find((l) => l.id === "kitchen")).toEqual({
      id: "kitchen",
      name: "Kitchen",
      summary: "Where the cookies were set out for snack time.",
    });
    expect(state.characters.find((c) => c.id === "alice")).toMatchObject({
      first_name: "Alice",
      summary: expect.stringContaining("Helped bake"),
    });
  });

  it("does not say who the culprit is", () => {
    const state = buildGameState(BLUEPRINT, STANDING);

    expect(JSON.stringify(state)).not.toContain("is_culprit");
    for (const character of state.characters) {
      expect(Object.keys(character)).not.toContain("is_culprit");
    }
  });

  it("carries where the game stands, unchanged", () => {
    expect(buildGameState(BLUEPRINT, STANDING)).toMatchObject(STANDING);
  });

  it("shows no summary, rather than failing, for a place or person nothing was said about", () => {
    const state = buildGameState(
      withStartingKnowledge({
        mystery_summary: "Something happened.",
        locations: [],
        characters: [],
      }),
      STANDING,
    );

    expect(state.mystery_summary).toBe("Something happened.");
    expect(state.locations.length).toBeGreaterThan(0);
    expect(state.locations.every((l) => l.summary === null)).toBe(true);
    expect(state.characters.length).toBeGreaterThan(0);
    expect(state.characters.every((c) => c.summary === null)).toBe(true);
  });

  it("reads a blueprint with no starting knowledge as having none", () => {
    const state = buildGameState(withStartingKnowledge(undefined), STANDING);

    expect(state.mystery_summary).toBeNull();
    expect(state.locations.every((l) => l.summary === null)).toBe(true);
    expect(state.characters.length).toBeGreaterThan(0);
    expect(state.characters.every((c) => c.summary === null)).toBe(true);
  });
});
