// What a repair round tells the generator: which verdicts it works from, and
// what it quotes of each.

import { describe, expect, it } from "vitest";

import type { Verdict } from "../../../evaluation/core/result.ts";
import {
  failingVerdicts,
  formatCost,
  REPORTS_NOTICE,
  repairMessage,
  repairReports,
  roundLines,
  totalCost,
} from "../../../evaluation/generate/repair.ts";

describe("repair reports", () => {
  const verdicts: Verdict[] = [
    { id: "schema", tier: "mechanical", status: "pass" },
    { id: "orphans", tier: "mechanical", status: "fail", details: { orphans: ["c9"] } },
    { id: "cg_soundness", tier: "judge", status: "error", reason: "timed out" },
    { id: "cg_truth_agreement", tier: "judge", status: "fail", answer: { findings: [], conclusions: [{ conclusion_id: "c", follows: "yes" }], verdict: "fail", reasoning: "late" } },
  ];

  it("works from failures only: an error is not the blueprint's fault", () => {
    expect(failingVerdicts(verdicts).map((verdict) => verdict.id)).toEqual(["orphans", "cg_truth_agreement"]);
  });

  it("quotes a check's details and a judge's whole answer", () => {
    expect(repairReports(verdicts)).toEqual([
      { id: "orphans", tier: "mechanical", details: { orphans: ["c9"] } },
      { id: "cg_truth_agreement", tier: "judge", answer: { findings: [], conclusions: [{ conclusion_id: "c", follows: "yes" }], verdict: "fail", reasoning: "late" } },
    ]);
  });

  it("adds the blueprint and the reports to the generation's message, under the notice", () => {
    const message = JSON.parse(repairMessage(JSON.stringify({ story_brief: { brief: "b" }, instructions: "i" }), 2, { id: "bp" }, verdicts));
    expect(message).toEqual({
      story_brief: { brief: "b" },
      instructions: "i",
      repair: { round: 2, blueprint: { id: "bp" }, notice: REPORTS_NOTICE, reports: repairReports(verdicts) },
    });
  });
});

describe("costs", () => {
  it("sums what was reported and counts what was not", () => {
    expect(totalCost([1, null, 0.5])).toEqual({ total: 1.5, unreported: 1 });
    expect(formatCost(null)).toBe("not reported");
    expect(formatCost(0.125)).toBe("$0.13");
  });

  it("prints nothing for a result without rounds", () => {
    expect(roundLines({ rounds: undefined } as never)).toEqual([]);
  });
});
