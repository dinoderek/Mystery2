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

  it("rejects cover_image.location_ids referencing a non-existent location", () => {
    const broken = {
      ...validBlueprintV2,
      cover_image: {
        description: "A test cover.",
        location_ids: ["non-existent-loc"],
        character_ids: [],
      },
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /cover_image\.location_ids references unknown location id/,
    );
  });

  it("rejects cover_image.character_ids referencing a non-existent character", () => {
    const broken = {
      ...validBlueprintV2,
      cover_image: {
        description: "A test cover.",
        location_ids: [],
        character_ids: ["non-existent-char"],
      },
    };

    expect(() => BlueprintV2Schema.parse(broken)).toThrow(
      /cover_image\.character_ids references unknown character id/,
    );
  });

  it("accepts cover_image with empty location_ids and character_ids", () => {
    const minimal = {
      ...validBlueprintV2,
      cover_image: {
        description: "An abstract atmospheric cover.",
        location_ids: [],
        character_ids: [],
      },
    };

    expect(() => BlueprintV2Schema.parse(minimal)).not.toThrow();
  });
});
