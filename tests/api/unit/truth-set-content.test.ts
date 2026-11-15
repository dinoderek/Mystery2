/**
 * What the real truth set holds: its bases, with their briefs and their
 * judging, and its self-played games. The material was made live; this proves,
 * with no model, that it is what it claims to be.
 */

import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";

import { runMechanical } from "../../../evaluation/blueprint/judge.ts";
import { loadAnalyzer, repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { judgesFor } from "../../../evaluation/core/registry.ts";
import { loadTruthSet, TRUTH_ROOT } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { BASES_RESULTS } from "../../../evaluation/lib/truth/store.ts";
import type { RawTrace } from "../../../evaluation/trace/lib/normalize.ts";
import { prepareGameJudging } from "../../../evaluation/trace/judge-game.ts";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.ts";
import { listPersonas } from "../../../evaluation/playtest/lib/investigator.ts";

let set: TruthSet;
beforeAll(async () => {
  set = await loadTruthSet(path.join(repoRoot(), TRUTH_ROOT));
});

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

describe("the real truth set's bases", () => {
  it("are four, each with its brief", () => {
    expect(set.bases).toHaveLength(4);
  });

  it("each pass the schema and every mechanical check with their brief, as validate does", async () => {
    for (const base of set.bases) {
      const verdicts = await runMechanical(await readJson(base.briefFile), await readJson(base.blueprintFile));
      expect(verdicts.length, base.id).toBeGreaterThan(0);
      expect(verdicts.filter((verdict) => verdict.status !== "pass").map((verdict) => verdict.id), base.id).toEqual([]);
    }
  });

  it("each pass every analyzer of the default battery, which needs no model", async () => {
    const analyzed = judgesFor("blueprint").filter((judge) => judge.analyzer);
    expect(analyzed.map((judge) => judge.id)).toContain("age_appropriate");
    for (const base of set.bases) {
      const brief = await readJson(base.briefFile);
      const blueprint = await readJson(base.blueprintFile);
      for (const judge of analyzed) {
        const analyzer = await loadAnalyzer(judge.id);
        const outcome = (await analyzer!.analyze({ brief, blueprint, context: judge.context ?? null })) as { status: string };
        expect(outcome.status, `${base.id} ${judge.id}.analyzer`).toBe("pass");
      }
    }
  });

  // A judge added to the default battery fails this until every base is judged
  // by it again, live: a base is clean only on the battery as it stands.
  it("each passed every judge of the default battery, as the stored results record", () => {
    const results = set.results.find((candidate) => candidate.id === BASES_RESULTS);
    expect(results).toBeDefined();
    for (const base of set.bases) {
      const verdicts = results!.verdicts.filter((verdict) => verdict.subject.side === "blueprint" && verdict.subject.base === base.id);
      expect(verdicts.map((verdict) => verdict.judge).sort(), base.id).toEqual(judgesFor("blueprint").map((judge) => judge.id).sort());
      expect(verdicts.every((verdict) => verdict.status === "pass" && verdict.findings.length === 0), base.id).toBe(true);
    }
  });
});

describe("the real truth set's games", () => {
  it("are five, spread over every base", async () => {
    expect(set.games).toHaveLength(5);
    const baseBlueprints = new Map<string, string>();
    for (const base of set.bases) baseBlueprints.set(String((await readJson(base.blueprintFile)).id), base.id);
    const played = set.games.map((game) => baseBlueprints.get(game.trace.session.blueprint_id) ?? `no base for ${game.id}`);
    expect(new Set(played)).toEqual(new Set(set.bases.map((base) => base.id)));
  });

  it("each reconstruct turn by turn with no context error, as judge game reads them", () => {
    for (const game of set.games) {
      expect(() => prepareGameJudging(game.trace), game.id).not.toThrow();
      const { turns, issues } = reconstructTrace(game.trace as unknown as RawTrace);
      expect(turns.length, game.id).toBe(game.trace.events.length);
      expect(issues, game.id).toEqual([]);
    }
  });

  it("were each narrated by Haiku, as every narrated event records", () => {
    for (const game of set.games) {
      const models = new Set(game.trace.events.map((event) => event.model).filter((model) => model !== null));
      expect(models.size, game.id).toBeGreaterThan(0);
      for (const model of models) expect(model, game.id).toMatch(/haiku/i);
    }
  });

  it("were played by both personas", () => {
    const personas = new Set(set.games.map((game) => game.trace.source.persona));
    expect(personas).toEqual(new Set(["detective", "kid-7"]));
    for (const persona of personas) expect(listPersonas()).toContain(persona);
  });
});
