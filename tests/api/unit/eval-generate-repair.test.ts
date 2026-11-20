// What a repair round tells the generator: which verdicts it works from, and
// how a judge's answer is cut down to what it flagged.

import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import type { Verdict } from "../../../evaluation/core/result.ts";
import {
  failingVerdicts,
  flaggedItems,
  formatCost,
  REPORTS_NOTICE,
  repairMessage,
  repairReports,
  roundLines,
  SOUNDNESS_FIELDS,
  totalCost,
} from "../../../evaluation/generate/repair.ts";

describe("flaggedItems", () => {
  it("leaves out the items a judge found sound and keeps the rest, with the reasoning", () => {
    const answer = {
      locks: [
        { clue_id: "a", kind: "pointer", fits_its_kind: true, problem: "none", reasoning: "fine" },
        { clue_id: "b", kind: "leverage", fits_its_kind: false, problem: "no_fitting_reason", reasoning: "why would she?" },
      ],
      reactions: [
        { character_id: "c", clue_ids: ["x"], concedes_only_what_clue_shows: true, note: "ok" },
        { character_id: "d", clue_ids: ["y"], concedes_only_what_clue_shows: false, note: "says too much" },
      ],
      mini_mysteries: [{ path_id: "p", graph_is_sensible: true, is_one_giant_chain: true, creates_dead_end: false, has_ungated_entry: true }],
      verdict: "fail",
      reasoning: "Lock b has no reason.",
    };
    expect(flaggedItems(answer)).toEqual({
      locks: [answer.locks[1]],
      reactions: [answer.reactions[1]],
      mini_mysteries: answer.mini_mysteries,
      verdict: "fail",
      reasoning: "Lock b has no reason.",
    });
  });

  it("keeps items that carry no soundness field, and prunes nested lists", () => {
    const answer = {
      issues: [{ subject: "alice", description: "two places at once" }],
      characters: [
        { character_id: "a", passes: true, topics: [{ topic: "home", status: "thin" }] },
        { character_id: "b", passes: false, topics: [{ topic: "home", status: "grounded" }, { topic: "likes", status: "absent" }] },
      ],
    };
    expect(flaggedItems(answer)).toEqual({
      issues: answer.issues,
      characters: [{ character_id: "b", passes: false, topics: [{ topic: "likes", status: "absent" }] }],
    });
  });
});

describe("the soundness fields", () => {
  it("each name a field some judge's answer schema has", () => {
    const dimensions = path.join(process.cwd(), "evaluation", "dimensions");
    const schemas = fs.readdirSync(dimensions).filter((file) => file.endsWith(".schema.ts")).map((file) => fs.readFileSync(path.join(dimensions, file), "utf8")).join("\n");
    for (const field of SOUNDNESS_FIELDS) expect(schemas, field).toMatch(new RegExp(`\\b${field}: z\\.`));
  });
});

describe("repair reports", () => {
  const verdicts: Verdict[] = [
    { id: "schema", tier: "mechanical", status: "pass" },
    { id: "orphans", tier: "mechanical", status: "fail", details: { orphans: ["c9"] } },
    { id: "age_appropriate.analyzer", tier: "analyzer", status: "fail", details: { grade: 6 } },
    { id: "fairness", tier: "judge", status: "error", reason: "timed out" },
    { id: "timeline_coherence", tier: "judge", status: "fail", answer: { issues: [], verdict: "fail", reasoning: "late" } },
  ];

  it("works from failures only: an error is not the blueprint's fault", () => {
    expect(failingVerdicts(verdicts).map((verdict) => verdict.id)).toEqual(["orphans", "age_appropriate.analyzer", "timeline_coherence"]);
  });

  it("quotes a check's details and a judge's answer", () => {
    expect(repairReports(verdicts)).toEqual([
      { id: "orphans", tier: "mechanical", details: { orphans: ["c9"] } },
      { id: "age_appropriate.analyzer", tier: "analyzer", details: { grade: 6 } },
      { id: "timeline_coherence", tier: "judge", answer: { issues: [], verdict: "fail", reasoning: "late" } },
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
