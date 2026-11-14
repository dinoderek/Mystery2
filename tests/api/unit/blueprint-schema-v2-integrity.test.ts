import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

/**
 * A blueprint is authored by hand or by a model, and the game trusts it
 * completely once it loads, so every cross-reference inside it is checked at
 * the door. Each case breaks one reference in an otherwise valid blueprint and
 * asserts the refusal names it.
 */

type Draft = {
  world: {
    starting_location_id: string;
    locations: Array<{
      id: string;
      clues: Array<{ id: string; text: string }>;
    }>;
    characters: Array<{
      id: string;
      location_id: string;
      is_culprit: boolean;
      clues: Array<{ id: string; text: string }>;
      actual_actions: Array<{ sequence: number; summary: string }>;
    }>;
  };
  narrative: {
    starting_knowledge: {
      locations: Array<{ location_id: string; summary: string }>;
      characters: Array<{ character_id: string; summary: string }>;
    };
  };
  solution_paths: Array<{
    id: string;
    location_clue_ids: string[];
    character_clue_ids: string[];
  }>;
};

/** The messages the schema gives for a blueprint changed by `change`. */
function problemsAfter(change: (draft: Draft) => void): string[] {
  const draft = structuredClone(validBlueprintV2) as unknown as Draft;
  change(draft);
  const result = BlueprintV2Schema.safeParse(draft);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.message);
}

describe("blueprint references", () => {
  it("accepts the unchanged blueprint", () => {
    expect(problemsAfter(() => {})).toEqual([]);
  });

  it("refuses a repeated location id", () => {
    const problems = problemsAfter((d) => {
      d.world.locations[1].id = "kitchen";
    });

    expect(problems.join("\n")).toMatch(/kitchen/);
  });

  it("refuses a repeated character id", () => {
    const problems = problemsAfter((d) => {
      d.world.characters[1].id = "alice";
    });

    expect(problems.join("\n")).toMatch(/alice/);
  });

  it("refuses a clue id used by both a place and a person", () => {
    const problems = problemsAfter((d) => {
      d.world.characters[0].clues[0].id = "loc-crumbs";
    });

    expect(problems.join("\n")).toMatch(/loc-crumbs/);
  });

  it("refuses a clue id repeated within one place", () => {
    const problems = problemsAfter((d) => {
      d.world.locations[0].clues[1].id = "loc-crumbs";
    });

    expect(problems.join("\n")).toMatch(/loc-crumbs/);
  });

  it("refuses a starting location that does not exist", () => {
    expect(
      problemsAfter((d) => {
        d.world.starting_location_id = "attic";
      }),
    ).toContain("starting_location_id must reference an existing location id.");
  });

  it("refuses a character placed in a location that does not exist", () => {
    expect(
      problemsAfter((d) => {
        d.world.characters[0].location_id = "attic";
      }),
    ).toContain(
      "character location_id must reference an existing location id.",
    );
  });

  it("refuses repeated and out-of-order action sequences", () => {
    const repeated = problemsAfter((d) => {
      d.world.characters[0].actual_actions[1].sequence = 1;
    });
    const descending = problemsAfter((d) => {
      d.world.characters[0].actual_actions[0].sequence = 3;
    });

    expect(repeated).toContain(
      "actual action sequences must be unique per character.",
    );
    expect(descending).toContain(
      "actual action sequences must be in ascending order.",
    );
  });

  it("refuses a blueprint with no culprit, or with two", () => {
    const none = problemsAfter((d) => {
      d.world.characters[0].is_culprit = false;
    });
    const two = problemsAfter((d) => {
      d.world.characters[1].is_culprit = true;
    });

    expect(none).toContain("Blueprint V2 must contain exactly one culprit.");
    expect(two).toContain("Blueprint V2 must contain exactly one culprit.");
  });
});

describe("blueprint starting knowledge", () => {
  it("refuses an entry for a location that does not exist", () => {
    const problems = problemsAfter((d) => {
      d.narrative.starting_knowledge.locations.push({
        location_id: "attic",
        summary: "Dusty.",
      });
    });

    expect(problems).toContain(
      'starting_knowledge references unknown location id "attic".',
    );
  });

  it("refuses a location described twice, and one not described at all", () => {
    const twice = problemsAfter((d) => {
      d.narrative.starting_knowledge.locations.push({
        location_id: "kitchen",
        summary: "Again.",
      });
    });
    const missing = problemsAfter((d) => {
      d.narrative.starting_knowledge.locations.pop();
    });

    expect(twice).toContain(
      'Duplicate location id "kitchen" in starting_knowledge.',
    );
    expect(missing).toContain(
      'starting_knowledge is missing an entry for location "hallway".',
    );
  });

  it("refuses an entry for a character that does not exist", () => {
    const problems = problemsAfter((d) => {
      d.narrative.starting_knowledge.characters.push({
        character_id: "carol",
        summary: "Unknown.",
      });
    });

    expect(problems).toContain(
      'starting_knowledge references unknown character id "carol".',
    );
  });

  it("refuses a character described twice, and one not described at all", () => {
    const twice = problemsAfter((d) => {
      d.narrative.starting_knowledge.characters.push({
        character_id: "alice",
        summary: "Again.",
      });
    });
    const missing = problemsAfter((d) => {
      d.narrative.starting_knowledge.characters.pop();
    });

    expect(twice).toContain(
      'Duplicate character id "alice" in starting_knowledge.',
    );
    expect(missing).toContain(
      'starting_knowledge is missing an entry for character "bob".',
    );
  });
});

describe("blueprint reasoning paths", () => {
  it("refuses a path id used twice", () => {
    const problems = problemsAfter((d) => {
      d.solution_paths.push({ ...d.solution_paths[0] });
    });

    expect(problems.join("\n")).toMatch(/solution-alice-cookie-bag/);
  });

  it("refuses a path that points at no clue at all", () => {
    const problems = problemsAfter((d) => {
      d.solution_paths[0].location_clue_ids = [];
      d.solution_paths[0].character_clue_ids = [];
    });

    expect(problems).toContain(
      "Each reasoning path must reference at least one location clue id or character clue id.",
    );
  });

  it("refuses a path naming a person's clue that does not exist", () => {
    const problems = problemsAfter((d) => {
      d.solution_paths[0].character_clue_ids = ["char-ghost"];
    });

    expect(problems).toContain(
      'Unknown character clue id "char-ghost" referenced by reasoning path.',
    );
  });
});
