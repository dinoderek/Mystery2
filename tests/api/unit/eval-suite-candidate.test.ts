// A suite runs any registry judge by id, including one no harness's battery
// runs. The registry here gains such a judge, `candidate_spoiler`: the
// spoiler judge's files under another id, left out of `judgesFor`, which is
// what every battery reads. No model is called.

import fs from "node:fs";

import { afterAll, describe, expect, it, vi } from "vitest";

import { FINDINGS_TABLE } from "../../../evaluation/lib/truth/findings.ts";
import type { FindingsRow } from "../../../evaluation/lib/truth/findings.ts";
import { ANSWERS, makeScratch, resultsOf, stubCalls, suite, writeSuite } from "./eval-suite-helpers.ts";

const CANDIDATE = "candidate_spoiler";

vi.mock("../../../evaluation/core/registry.ts", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../../evaluation/core/registry.ts")>();
  const candidate = { ...real.getJudgeEntry("gm_spoiler"), id: "candidate_spoiler", subjects: ["game"] as const };
  const registry = [...real.REGISTRY, candidate];
  const findEntry = (id: string) => registry.find((entry) => entry.id === id);
  return {
    ...real,
    REGISTRY: registry,
    findEntry,
    getEntry: (id: string) => findEntry(id) ?? real.getEntry(id),
    getJudgeEntry: (id: string) => (id === candidate.id ? candidate : real.getJudgeEntry(id)),
    // The batteries: the registry as it was, without the candidate.
    judgesFor: real.judgesFor,
  };
});

// The findings table is how a stored verdict gets its kinds; the candidate's row is the spoiler judge's.
(FINDINGS_TABLE as Record<string, FindingsRow>)[CANDIDATE] = { side: "game", kinds: ["spoiler"], read: "each_finding" };

const at = makeScratch({ ...ANSWERS, [CANDIDATE]: ANSWERS.gm_spoiler });
afterAll(() => fs.rmSync(at.dir, { recursive: true, force: true }));

describe("a judge outside the default battery", () => {
  it("is in no battery", async () => {
    const { judgesFor } = await import("../../../evaluation/core/registry.ts");
    expect(judgesFor("game").map((entry) => entry.id)).not.toContain(CANDIDATE);
  });

  it("runs when the suite names it, and its verdicts are stored and scored", async () => {
    const ran = await suite(at, writeSuite(at, "candidate", { subjects: { game_variants: ["medal-spoiler"] }, judges: [CANDIDATE], thresholds: [{ judge: CANDIDATE, min_found_of_real: 1 }] }));
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(stubCalls(at)).toEqual([CANDIDATE]);
    expect(resultsOf(at, "candidate").verdicts).toMatchObject([{ judge: CANDIDATE, status: "fail", findings: [{ sequence: 4, kinds: ["spoiler"] }] }]);
    expect(ran.out).toContain(`${CANDIDATE} spoiler: found of real 1.00 (1/1), needs 1: met`);
  });
});
