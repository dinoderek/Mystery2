import { describe, expect, it } from "vitest";

import { schema } from "../../../evaluation/dimensions/knowledge-coherence.schema.ts";
import { semanticChecksKnowledgeCoherence } from "../../../evaluation/judge-harness/scripts/validate-judge-output.mjs";

const blueprint = {
  world: {
    locations: [
      {
        id: "lab",
        clues: [{ id: "clue_gloves" }],
        sub_locations: [{ id: "shelf", clues: [{ id: "clue_note" }] }],
      },
    ],
    characters: [{ id: "eva", clues: [{ id: "clue_eva_says" }] }],
  },
};

function verdict(issues: Array<Record<string, unknown>>) {
  return { issues, verdict: issues.length ? "fail" : "pass", reasoning: "r" };
}

describe("knowledge_coherence verdict", () => {
  it("accepts the physical-consistency kinds with their clue ids", () => {
    const v = verdict([
      {
        kind: "pre_discovery_leak",
        subject: "eva appearance vs clue_gloves",
        clue_ids: ["clue_gloves"],
        description: "Her appearance has the gloves on her belt; the clue finds them on the workbench.",
      },
      {
        kind: "physical_fact",
        subject: "lab description vs eva actual_actions",
        clue_ids: [],
        description: "The description puts everyone at the lab.",
      },
    ]);
    expect(schema.safeParse(v).success).toBe(true);
    expect(semanticChecksKnowledgeCoherence(v, blueprint)).toEqual([]);
  });

  it("requires clue_ids on every issue", () => {
    const v = verdict([{ kind: "observability", subject: "eva", description: "d" }]);
    expect(schema.safeParse(v).success).toBe(false);
  });

  it("rejects clue ids that are not in the blueprint, from any clue source", () => {
    const v = verdict([
      {
        kind: "false_knowledge",
        subject: "eva",
        clue_ids: ["clue_eva_says", "clue_note", "clue_missing"],
        description: "d",
      },
    ]);
    expect(semanticChecksKnowledgeCoherence(v, blueprint)).toEqual([
      'issues[0].clue_ids references unknown clue id "clue_missing"',
    ]);
  });

  it("rejects a leak that names no clue", () => {
    const v = verdict([
      { kind: "pre_discovery_leak", subject: "eva appearance", clue_ids: [], description: "d" },
    ]);
    expect(semanticChecksKnowledgeCoherence(v, blueprint)).toEqual([
      "issues[0] is a pre_discovery_leak but clue_ids is empty (name the clue it gives away)",
    ]);
  });
});
