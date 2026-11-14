import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import { loadAnalyzer, loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { judgesFor, REGISTRY } from "../../../evaluation/core/registry.ts";
import {
  loadDimensions,
  loadDimensionDefinition,
  tryLoadAnalyzer,
  repoRoot,
} from "../../../evaluation/pipeline/load.mjs";
import {
  loadTraceDimensions,
  loadTraceDimensionDefinition,
} from "../../../evaluation/trace/lib/load.mjs";

// These tests guard what the harnesses read from the one registry against
// drift: an entry that points at a missing or malformed schema, or an analyzer
// file that fails to export analyze(), would otherwise surface only as a
// runtime failure part-way through an evaluation. The registry's own
// invariants (unique ids, valid subjects, a brief for every judge) are in
// eval-core-judges.test.ts.

describe("blueprint battery", () => {
  it("is the registry's blueprint judges, with their default context", async () => {
    const dimensions = await loadDimensions();
    expect(dimensions.map((d: { id: string }) => d.id)).toEqual(judgesFor("blueprint").map((j) => j.id));
    expect(dimensions.find((d: { id: string }) => d.id === "solve_depth")).toEqual({
      id: "solve_depth",
      context: { min_clues: 3 },
    });
    expect(dimensions.find((d: { id: string }) => d.id === "fairness")).toEqual({ id: "fairness" });
  });

  it("resolves every dimension to a loadable schema", async () => {
    for (const dim of await loadDimensions()) {
      const def = await loadDimensionDefinition(dim.id);
      expect(def.schema, `dimension "${dim.id}" has no loadable schema`).not.toBeNull();
      expect(typeof def.schema.safeParse, `dimension "${dim.id}" schema is not a Zod schema`).toBe("function");
    }
  });

  it("loads an analyze() function for every dimension whose entry names an analyzer file", async () => {
    for (const dim of await loadDimensions()) {
      const analyzer = await tryLoadAnalyzer(dim.id);
      const entry = judgesFor("blueprint").find((j) => j.id === dim.id);
      if (entry?.analyzer) {
        expect(analyzer, `dimension "${dim.id}" names an analyzer that did not load`).not.toBeNull();
        expect(typeof analyzer.analyze).toBe("function");
        await expect(fs.access(path.join(repoRoot(), entry.analyzer.module))).resolves.toBeUndefined();
      } else {
        expect(analyzer).toBeNull();
      }
    }
  });

  it("has an analyzer file for exactly the dimensions that name one", async () => {
    const files = await fs.readdir(path.join(repoRoot(), "evaluation", "checks", "analyzers"));
    const named = judgesFor("blueprint")
      .filter((j) => j.analyzer)
      .map((j) => path.basename(j.analyzer!.module))
      .sort();
    expect(named).toEqual(files.filter((f) => f.endsWith(".mjs")).sort());
    expect(await loadAnalyzer("clue_graph")).not.toBeNull();
  });
});

describe("game battery", () => {
  it("is the registry's game judges, plus the settings of the mechanical checks", async () => {
    const { dimensions, mechanical_context } = await loadTraceDimensions();
    expect(dimensions.map((d: { id: string }) => d.id)).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
    ]);
    expect(mechanical_context).toEqual({ spoiler_min_run: 12, enforce_requires: false });
  });

  it("resolves every dimension to a brief and a loadable schema in the shared judge directory", async () => {
    const { dimensions } = await loadTraceDimensions();
    for (const dim of dimensions) {
      const def = await loadTraceDimensionDefinition(dim.id);
      expect(def.schema, `trace dimension "${dim.id}" has no loadable schema`).not.toBeNull();
      expect(typeof def.schema.safeParse).toBe("function");
      expect(def.filePath.startsWith(path.join(repoRoot(), "evaluation", "judges"))).toBe(true);
      expect(def.text.length).toBeGreaterThan(0);
    }
  });
});

it("registers every judge and analyzer this file's loaders can reach", async () => {
  for (const entry of REGISTRY) {
    if (entry.type === "judge") expect((await loadJudge(entry.id)).id).toBe(entry.id);
  }
});
