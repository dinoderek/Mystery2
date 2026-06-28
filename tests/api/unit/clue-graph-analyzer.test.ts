import { describe, expect, it } from "vitest";

import { analyzeClueGraph } from "../../../evaluation/checks/lib/clue-graph.mjs";
import { analyze } from "../../../evaluation/checks/analyzers/clue-graph.mjs";
import type { BlueprintV2 } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

type LocationClueRequires =
  BlueprintV2["world"]["locations"][number]["clues"][number]["requires"];

// Deep-clone the readonly fixture so tests can attach `requires` gates.
function clone(): BlueprintV2 {
  return JSON.parse(JSON.stringify(validBlueprintV2)) as BlueprintV2;
}

// Set a `requires` gate on a location clue by id.
function setRequires(bp: BlueprintV2, clueId: string, requires: LocationClueRequires) {
  for (const loc of bp.world.locations) {
    for (const clue of loc.clues) {
      if (clue.id === clueId) clue.requires = requires;
    }
  }
}

describe("analyzeClueGraph", () => {
  it("reports a sound, ungated blueprint as ok", () => {
    const result = analyzeClueGraph(clone());
    expect(result.ok).toBe(true);
    expect(result.acyclic).toBe(true);
    expect(result.gated_clue_count).toBe(0);
    expect(result.undiscoverable).toEqual([]);
    expect(analyze({ blueprint: clone() }).status).toBe("pass");
  });

  it("accepts a clue gated behind an ungated root", () => {
    const bp = clone();
    setRequires(bp, "loc-bag", {
      clue_ids: ["loc-crumbs"],
      rationale: "The bag only matters once you follow the crumbs.",
    });
    const result = analyzeClueGraph(bp);
    expect(result.ok).toBe(true);
    expect(result.gated_clue_count).toBe(1);
  });

  it("detects a dependency cycle and the resulting locked solution clues", () => {
    const bp = clone();
    setRequires(bp, "loc-crumbs", { clue_ids: ["loc-bag"], rationale: "A." });
    setRequires(bp, "loc-bag", { clue_ids: ["loc-crumbs"], rationale: "B." });
    const result = analyzeClueGraph(bp);
    expect(result.acyclic).toBe(false);
    expect(result.cycles.length).toBeGreaterThan(0);
    // both clues are on the solution path and are now unreachable
    expect(result.solution_locked).toBe(true);
    expect(result.ok).toBe(false);
    expect(analyze({ blueprint: bp }).status).toBe("fail");
  });

  it("flags self-references", () => {
    const bp = clone();
    setRequires(bp, "loc-crumbs", { clue_ids: ["loc-crumbs"], rationale: "self." });
    const result = analyzeClueGraph(bp);
    expect(result.self_references).toContain("loc-crumbs");
    expect(result.ok).toBe(false);
  });

  it("flags unknown prerequisite references", () => {
    const bp = clone();
    setRequires(bp, "loc-bag", { clue_ids: ["loc-nope"], rationale: "ghost." });
    const result = analyzeClueGraph(bp);
    expect(result.unknown_requires).toContainEqual({ clue_id: "loc-bag", missing: "loc-nope" });
    expect(result.ok).toBe(false);
  });
});
