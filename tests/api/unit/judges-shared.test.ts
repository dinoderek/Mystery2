import { describe, expect, it } from "vitest";

import {
  ADHERENCE_JUDGE_IDS,
  composeJudgeSystemPrompt,
  isSharedJudgeId,
  loadSharedJudgeDefinition,
  loadSharedJudgeSystemPrompt,
  resolveVerdict,
  validateJudgeOutput,
} from "../../../evaluation/judges/index.mjs";

// The game-master adherence battery is shared: the trace pipeline runs these as
// registry dimensions over a played session, the runtime harness runs them as
// judges over one interaction. These tests pin the contract both sides rely on.

// The shared layer is plain .mjs, so its exports arrive untyped. Name the
// shapes the tests actually rely on rather than threading `any` through them.
const JUDGE_IDS: string[] = ADHERENCE_JUDGE_IDS;

type FindingSchema = {
  element: { shape: { kind: { options: string[] } } };
};
type JudgeSchema = {
  shape: { findings: FindingSchema };
  safeParse: (value: unknown) => { success: boolean };
};

describe("shared judge definitions", () => {
  it("covers the four adherence dimensions", () => {
    expect(ADHERENCE_JUDGE_IDS).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
    ]);
  });

  it.each(JUDGE_IDS)("loads a brief and a schema for %s", async (id: string) => {
    const def = await loadSharedJudgeDefinition(id);
    expect(def).not.toBeNull();
    expect(def!.id).toBe(id);
    expect(def!.text).toContain(`id: ${id}`);
    expect(def!.schema).toBeTruthy();
  });

  it("returns null for an id it does not own, so a harness can fall back", async () => {
    expect(await loadSharedJudgeDefinition("not_a_judge")).toBeNull();
    expect(isSharedJudgeId("not_a_judge")).toBe(false);
    expect(isSharedJudgeId("gm_spoiler")).toBe(true);
  });

  it.each(JUDGE_IDS)(
    "%s schema requires the common finding fields",
    async (id: string) => {
      const schema = (await loadSharedJudgeDefinition(id))!.schema as JudgeSchema;
      const kind = schema.shape.findings.element.shape.kind.options[0];

      const good = {
        findings: [
          { sequence: 3, severity: "major", kind, quote: "q", why: "w", refers_to: "id-1" },
        ],
        verdict: "fail",
        reasoning: "r",
      };
      expect(schema.safeParse(good).success).toBe(true);

      // refers_to is the only optional field.
      const noRefers = { ...good, findings: [{ sequence: 3, severity: "minor", kind, quote: "q", why: "w" }] };
      expect(schema.safeParse(noRefers).success).toBe(true);

      for (const bad of [
        { ...good, findings: [{ ...good.findings[0], severity: "catastrophic" }] },
        { ...good, findings: [{ ...good.findings[0], kind: "not_a_kind" }] },
        { ...good, findings: [{ ...good.findings[0], sequence: "3" }] },
        { ...good, verdict: "maybe" },
      ]) {
        expect(schema.safeParse(bad).success).toBe(false);
      }
    },
  );

  it("states the judged-vs-context rule in the shared system prompt", async () => {
    const base = await loadSharedJudgeSystemPrompt();
    // A single-interaction subject carries fixture turns the model did not
    // write; blaming the model for them would make every runtime case noisy.
    expect(base).toMatch(/Report findings only against turns where `judged` is true/);
    expect(base).toMatch(/at least one `major` finding/);
  });
});

describe("composeJudgeSystemPrompt", () => {
  it("layers the brief and the authoritative schema onto the base", async () => {
    const def = (await loadSharedJudgeDefinition("gm_spoiler"))!;
    const composed = composeJudgeSystemPrompt({
      base: "BASE-PREAMBLE",
      dimensionText: def.text,
      schema: def.schema,
      context: { spoiler_min_run: 12 },
    });
    expect(composed).toContain("BASE-PREAMBLE");
    expect(composed).toContain("Spoiler discipline");
    expect(composed).toContain("Output JSON Schema (authoritative)");
    expect(composed).toContain("spoiler_min_run");
  });
});

describe("validateJudgeOutput", () => {
  it("reports the offending path when the shape misses", async () => {
    const { schema } = (await loadSharedJudgeDefinition("gm_fabrication"))!;
    const result = validateJudgeOutput({ verdict: "maybe", findings: [], reasoning: "r" }, schema);
    expect(result.ok).toBe(false);
    expect(result.message).toContain("verdict");
  });

  it("rejects a non-object", async () => {
    const { schema } = (await loadSharedJudgeDefinition("gm_fabrication"))!;
    expect(validateJudgeOutput(null, schema).ok).toBe(false);
  });
});

describe("resolveVerdict", () => {
  it("fails on a major finding and passes on minors alone", () => {
    const major = resolveVerdict({
      verdict: "fail",
      findings: [{ severity: "major" }, { severity: "minor" }],
    });
    expect(major).toMatchObject({ status: "fail", major_count: 1, minor_count: 1 });

    const minorOnly = resolveVerdict({ verdict: "pass", findings: [{ severity: "minor" }] });
    expect(minorOnly).toMatchObject({ status: "pass", major_count: 0, minor_count: 1 });
  });

  it("lets the findings overrule a contradicting verdict, and says so", () => {
    // A judge that lists a major defect then says "pass" is contradicting its
    // own evidence; the evidence wins and the disagreement stays visible.
    const resolved = resolveVerdict({ verdict: "pass", findings: [{ severity: "major" }] });
    expect(resolved.status).toBe("fail");
    expect(resolved.model_verdict).toBe("pass");
    expect(resolved.verdict_disagreement).toBe(true);
  });

  it("treats a missing findings array as clean", () => {
    expect(resolveVerdict({ verdict: "pass" })).toMatchObject({
      status: "pass",
      major_count: 0,
      verdict_disagreement: false,
    });
  });
});
