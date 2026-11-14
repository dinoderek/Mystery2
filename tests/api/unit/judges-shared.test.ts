import { describe, expect, it } from "vitest";

import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { validateJudgeOutput } from "../../../evaluation/core/judge-output.ts";
import { composeJudgeSystemPrompt } from "../../../evaluation/core/judge-prompt.ts";
import { judgesFor } from "../../../evaluation/core/registry.ts";
import { resolveVerdict } from "../../../evaluation/judges/index.ts";

// The game-master adherence battery is shared: the trace pipeline runs these as
// registry dimensions over a played session, the runtime harness runs them as
// judges over one interaction. These tests pin the contract both sides rely on.

// The judges both harnesses share are the registry's game-master judges.
const JUDGE_IDS: string[] = judgesFor("game").map((judge) => judge.id);

type FindingSchema = {
  element: { shape: { kind: { options: string[] } } };
};
type JudgeSchema = {
  shape: { findings: FindingSchema };
  safeParse: (value: unknown) => { success: boolean };
};

describe("shared judge definitions", () => {
  it("covers the four adherence dimensions, for a game and for a turn alike", () => {
    expect(judgesFor("turn").filter((j) => j.subjects.includes("game")).map((j) => j.id)).toEqual(JUDGE_IDS);
    expect(JUDGE_IDS).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
    ]);
  });

  it.each(JUDGE_IDS)("loads a brief and a schema for %s", async (id: string) => {
    const def = await loadJudge(id);
    expect(def.id).toBe(id);
    expect(def.text).toContain(`id: ${id}`);
    expect(def.schema).toBeTruthy();
  });

  it("refuses an id the registry does not list", async () => {
    await expect(loadJudge("not_a_judge")).rejects.toThrow(/Unknown check or judge/);
  });

  it.each(JUDGE_IDS)(
    "%s schema requires the common finding fields",
    async (id: string) => {
      const schema = (await loadJudge(id)).schema as unknown as JudgeSchema;
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
    const base = (await loadJudge("gm_spoiler")).preamble!;
    // A single-interaction subject carries fixture turns the model did not
    // write; blaming the model for them would make every runtime case noisy.
    expect(base).toMatch(/Report findings only against turns where `judged` is true/);
    expect(base).toMatch(/at least one `major` finding/);
  });
});

describe("composeJudgeSystemPrompt", () => {
  it("layers the brief and the authoritative schema onto the preamble", async () => {
    const def = await loadJudge("gm_spoiler");
    const composed = composeJudgeSystemPrompt(def, { spoiler_min_run: 12 });
    expect(composed.startsWith(def.preamble!)).toBe(true);
    expect(composed).toContain("Spoiler discipline");
    expect(composed).toContain("Output JSON Schema (authoritative)");
    expect(composed).toContain("## Dimension context");
    expect(composed).toContain("spoiler_min_run");
  });

  it("calls a blueprint judge's context per spec", async () => {
    const composed = composeJudgeSystemPrompt(await loadJudge("solve_depth"), { min_clues: 3 });
    expect(composed).toContain("## Per-spec context");
  });
});

describe("validateJudgeOutput", () => {
  it("reports the offending path when the shape misses", async () => {
    const { schema } = await loadJudge("gm_fabrication");
    const result = validateJudgeOutput({ verdict: "maybe", findings: [], reasoning: "r" }, schema);
    expect(result).toMatchObject({ ok: false, message: expect.stringContaining("verdict") });
  });

  it("rejects a non-object", async () => {
    const { schema } = await loadJudge("gm_fabrication");
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
