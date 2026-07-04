import { describe, expect, it } from "vitest";

import {
  findOrphanClues,
  runMechanicalChecks,
} from "../../../evaluation/checks/mechanical.mjs";
import type { BlueprintV2 } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

// Deep-clone the readonly fixture so each test can mutate freely.
function cloneBlueprint(): BlueprintV2 {
  return JSON.parse(JSON.stringify(validBlueprintV2)) as BlueprintV2;
}

// A single mechanical-check result. The check module is a plain .mjs with no
// type declarations, so this mirrors the { id, kind, status, details } shape it
// emits so the assertions can read `details` without `any` leaking through.
type MechanicalCheck = {
  id: string;
  kind: string;
  status: string;
  details: unknown;
};

// Locate a check result by id, or undefined when the check did not emit.
function checkById(checks: MechanicalCheck[], id: string) {
  return checks.find((c) => c.id === id);
}

// A minimal, schema-valid brief. The default fixture blueprint has 1 culprit,
// 2 locations, 2 characters, and 1 red-herring trail, so these counts all match
// the fixture unless a test overrides one of them.
function matchingBrief() {
  return {
    brief: "Someone took the cookies before snack time.",
    targetAge: 8,
    culprits: 1,
    suspects: 0,
    witnesses: 1,
    locations: 2,
    redHerringTrails: 1,
  };
}

describe("findOrphanClues", () => {
  it("reports no orphans for a blueprint whose clues are all referenced by paths", () => {
    const orphans = findOrphanClues(cloneBlueprint());
    expect(orphans.location).toEqual([]);
    expect(orphans.character).toEqual([]);
  });

  it("flags a location clue that no reasoning path references", () => {
    const bp = cloneBlueprint();
    // Add a clue to the kitchen that no path mentions.
    bp.world.locations[0].clues.push({
      id: "loc-unused-mug",
      text: "An unwashed mug sits in the sink, unrelated to the case.",
    });

    const orphans = findOrphanClues(bp);
    expect(orphans.location).toContain("loc-unused-mug");
    expect(orphans.character).toEqual([]);
  });

  it("flags a character clue that no reasoning path references", () => {
    const bp = cloneBlueprint();
    bp.world.characters[0].clues.push({
      id: "char-unused-note",
      text: "Alice mentions a doodle she drew, irrelevant to the mystery.",
    });

    const orphans = findOrphanClues(bp);
    expect(orphans.character).toContain("char-unused-note");
    expect(orphans.location).toEqual([]);
  });

  it("traverses sub-locations: a referenced sub-location clue is not orphaned", () => {
    const bp = cloneBlueprint();
    // Nest a clue under a sub-location of the kitchen and wire it into the
    // existing solution path so it is reachable.
    bp.world.locations[0].sub_locations = [
      {
        id: "kitchen-pantry",
        name: "the pantry shelf",
        hint: "Steer the player to look behind the flour tins.",
        clues: [
          {
            id: "loc-pantry-wrapper",
            text: "A torn cookie wrapper is tucked behind the flour tins.",
          },
        ],
      },
    ];
    bp.solution_paths[0].location_clue_ids.push("loc-pantry-wrapper");

    const orphans = findOrphanClues(bp);
    // Sub-location clues live in orphans.location; a referenced one is absent.
    expect(orphans.location).not.toContain("loc-pantry-wrapper");
    expect(orphans.location).toEqual([]);
    expect(orphans.character).toEqual([]);
  });

  it("traverses sub-locations: an unreferenced sub-location clue is flagged", () => {
    const bp = cloneBlueprint();
    // Same nesting, but this time no path references the nested clue.
    bp.world.locations[0].sub_locations = [
      {
        id: "kitchen-pantry",
        name: "the pantry shelf",
        hint: "Steer the player to look behind the flour tins.",
        clues: [
          {
            id: "loc-pantry-wrapper",
            text: "A torn cookie wrapper is tucked behind the flour tins.",
          },
        ],
      },
    ];

    const orphans = findOrphanClues(bp);
    // The nested clue is unreachable from any path, so it is an orphan and it
    // is reported under the location bucket.
    expect(orphans.location).toContain("loc-pantry-wrapper");
    expect(orphans.character).toEqual([]);
  });
});

describe("runMechanicalChecks count-vs-brief checks", () => {
  it("passes every count check when the brief matches the blueprint", () => {
    const checks = runMechanicalChecks({
      brief: matchingBrief(),
      blueprintCandidate: cloneBlueprint(),
    });

    for (const id of [
      "culprit_count_matches_brief",
      "location_count_matches_brief",
      "character_count_matches_brief",
      "red_herring_count_matches_brief",
    ]) {
      const check = checkById(checks, id);
      expect(check, `expected check "${id}" to be emitted`).toBeDefined();
      expect(check?.status).toBe("pass");
    }
  });

  it("fails culprit_count_matches_brief when the brief expects a different culprit count", () => {
    // The fixture has exactly one culprit; a brief asking for two mismatches.
    const brief = { ...matchingBrief(), culprits: 2 };
    const checks = runMechanicalChecks({
      brief,
      blueprintCandidate: cloneBlueprint(),
    });

    const check = checkById(checks, "culprit_count_matches_brief");
    expect(check?.status).toBe("fail");
    expect(check?.details).toMatchObject({ expected: 2, actual: 1 });
  });

  it("fails location_count_matches_brief when the brief expects a different location count", () => {
    const brief = { ...matchingBrief(), locations: 5 };
    const checks = runMechanicalChecks({
      brief,
      blueprintCandidate: cloneBlueprint(),
    });

    const check = checkById(checks, "location_count_matches_brief");
    expect(check?.status).toBe("fail");
    expect(check?.details).toMatchObject({ expected: 5, actual: 2 });
  });

  it("fails character_count_matches_brief when the brief expects a different character count", () => {
    // culprits(1) + suspects(3) + witnesses(1) = 5 expected vs 2 actual.
    const brief = { ...matchingBrief(), suspects: 3 };
    const checks = runMechanicalChecks({
      brief,
      blueprintCandidate: cloneBlueprint(),
    });

    const check = checkById(checks, "character_count_matches_brief");
    expect(check?.status).toBe("fail");
    expect(check?.details).toMatchObject({ expected: 5, actual: 2 });
  });

  it("fails red_herring_count_matches_brief when the brief expects a different trail count", () => {
    const brief = { ...matchingBrief(), redHerringTrails: 4 };
    const checks = runMechanicalChecks({
      brief,
      blueprintCandidate: cloneBlueprint(),
    });

    const check = checkById(checks, "red_herring_count_matches_brief");
    expect(check?.status).toBe("fail");
    expect(check?.details).toMatchObject({ expected: 4, actual: 1 });
  });

  it("omits the optional count checks when the brief does not specify those counts", () => {
    // A brief with none of the optional count fields: only the always-on
    // culprit check should emit; the other three are skipped.
    const brief = { brief: "A minimal brief.", targetAge: 8 };
    const checks = runMechanicalChecks({
      brief,
      blueprintCandidate: cloneBlueprint(),
    });

    expect(checkById(checks, "culprit_count_matches_brief")).toBeDefined();
    expect(checkById(checks, "location_count_matches_brief")).toBeUndefined();
    expect(checkById(checks, "character_count_matches_brief")).toBeUndefined();
    expect(checkById(checks, "red_herring_count_matches_brief")).toBeUndefined();
  });
});

describe("runMechanicalChecks no_orphan_clues", () => {
  it("passes when every clue is referenced by a reasoning path", () => {
    const checks = runMechanicalChecks({
      brief: matchingBrief(),
      blueprintCandidate: cloneBlueprint(),
    });

    const check = checkById(checks, "no_orphan_clues");
    expect(check?.status).toBe("pass");
    expect(check?.details).toBeNull();
  });

  it("fails and surfaces the orphaned clue ids when a clue is unreferenced", () => {
    const bp = cloneBlueprint();
    bp.world.locations[0].clues.push({
      id: "loc-unused-mug",
      text: "An unwashed mug sits in the sink, unrelated to the case.",
    });

    const checks = runMechanicalChecks({
      brief: matchingBrief(),
      blueprintCandidate: bp,
    });

    const check = checkById(checks, "no_orphan_clues");
    expect(check?.status).toBe("fail");
    const details = check?.details as { location: string[]; character: string[] };
    expect(details.location).toContain("loc-unused-mug");
  });
});
