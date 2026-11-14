import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import { loadAnalyzer, loadJudge, repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { checksFor, judgesFor, REGISTRY } from "../../../evaluation/core/registry.ts";

// These tests guard what the harnesses read from the one registry against
// drift: an entry that points at a missing or malformed schema, or an analyzer
// file that fails to export analyze(), would otherwise surface only as a
// runtime failure part-way through an evaluation. The registry's own
// invariants (unique ids, valid subjects, a brief for every judge) are in
// eval-core-judges.test.ts.

const blueprintJudges = judgesFor("blueprint");

describe("blueprint battery", () => {
  it("is the registry's blueprint judges, with their default context", () => {
    expect(blueprintJudges.map((j) => j.id)).toEqual([
      "solve_depth",
      "fairness",
      "timeline_coherence",
      "knowledge_coherence",
      "character_grounding",
      "path_payoff",
      "clue_graph",
      "age_appropriate",
    ]);
    expect(blueprintJudges.find((j) => j.id === "solve_depth")?.context).toEqual({ min_clues: 3 });
    expect(blueprintJudges.find((j) => j.id === "fairness")?.context).toBeUndefined();
  });

  it("resolves every dimension to a loadable schema", async () => {
    for (const entry of blueprintJudges) {
      const def = await loadJudge(entry.id);
      expect(def.schema, `dimension "${entry.id}" has no loadable schema`).not.toBeNull();
      expect(typeof def.schema?.safeParse, `dimension "${entry.id}" schema is not a Zod schema`).toBe("function");
    }
  });

  it("loads an analyze() function for every dimension whose entry names an analyzer file", async () => {
    for (const entry of blueprintJudges) {
      const analyzer = await loadAnalyzer(entry.id);
      if (entry.analyzer) {
        expect(analyzer, `dimension "${entry.id}" names an analyzer that did not load`).not.toBeNull();
        expect(typeof analyzer?.analyze).toBe("function");
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
  it("is the registry's game judges, plus the settings of the mechanical checks", () => {
    const mechanical_context = Object.assign({}, ...checksFor("game").map((entry) => entry.context ?? {}));
    expect(judgesFor("game").map((entry) => entry.id)).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
    ]);
    expect(mechanical_context).toEqual({ spoiler_min_run: 12, enforce_requires: false });
  });

  it("resolves every dimension to a brief and a loadable schema in the shared judge directory", async () => {
    for (const dim of judgesFor("game")) {
      const def = await loadJudge(dim.id);
      expect(def.schema, `trace dimension "${dim.id}" has no loadable schema`).not.toBeNull();
      expect(typeof def.schema?.safeParse).toBe("function");
      expect(def.filePath?.startsWith(path.join(repoRoot(), "evaluation", "judges"))).toBe(true);
      expect(def.text.length).toBeGreaterThan(0);
    }
  });
});

it("registers every judge and analyzer this file's loaders can reach", async () => {
  for (const entry of REGISTRY) {
    if (entry.type === "judge") expect((await loadJudge(entry.id)).id).toBe(entry.id);
  }
});
