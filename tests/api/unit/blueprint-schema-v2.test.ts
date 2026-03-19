import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

describe("Blueprint V2 schema", () => {
  it("accepts a valid authored Blueprint V2", () => {
    expect(() => BlueprintV2Schema.parse(validBlueprintV2)).not.toThrow();
  });

  it("rejects location clues that are not referenced by any path", () => {
    const broken = {
      ...validBlueprintV2,
      world: {
        ...validBlueprintV2.world,
        locations: validBlueprintV2.world.locations.map((location, index) =>
          index === 0
            ? {
                ...location,
                clues: [
                  ...location.clues,
                  {
                    id: "loc-unlinked",
                    text: "An extra clue with no path.",
                    role: "supporting_evidence" as const,
                  },
                ],
              }
            : location,
        ),
      },
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /Every location clue must be referenced/,
    );
  });

  it("rejects reasoning paths that reference missing clue ids", () => {
    const broken = {
      ...validBlueprintV2,
      solution_paths: [
        {
          ...validBlueprintV2.solution_paths[0],
          location_clue_ids: ["loc-missing"],
        },
      ],
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /Unknown location clue id/,
    );
  });
});
