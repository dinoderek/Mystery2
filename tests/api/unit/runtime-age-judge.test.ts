import { afterEach, describe, expect, it } from "vitest";

import { judgeTurn } from "../../../evaluation/runtime/lib/judges.ts";
import { TURN_AGE_FINDING_KINDS } from "../../../evaluation/core/judge-prompt.ts";
import { validateTurnAgeAnswer } from "../../../evaluation/core/judge-output.ts";
import { judgeStubBinding, makeTurn } from "./runtime-turn-helpers.ts";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The turn-level age judge is one call through the model runner. These tests
// use the deterministic judge-stub wrapper (no network, no model) and steer its
// answer through RUNTIME_JUDGE_STUB_VERDICT to exercise each path.

const ID = "age_appropriate_turn";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-age-judge-"));

function judge(turn = makeTurn(), options = {}) {
  return judgeTurn([ID], turn, {
    root: process.cwd(),
    binding: judgeStubBinding(),
    logDir,
    options: { [ID]: options },
  }).then(([verdict]) => verdict);
}

function stubVerdict(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    estimated_reading_age: 8,
    findings: [],
    verdict: "pass",
    reasoning: "Simple words, short sentences.",
    ...overrides,
  });
}

afterEach(() => {
  delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
});

describe("age_appropriate_turn judge (stub binding)", () => {
  it("maps a pass verdict onto the verdict contract", async () => {
    const result = await judge();
    expect(result).toMatchObject({ id: ID, tier: "judge", status: "pass", findings: [] });
    expect(result.details).toMatchObject({ score: 8, target_age: 10, estimated_reading_age: 8 });
    expect(result.call).toMatchObject({ binding: "judge-stub", model: null });
    expect(result.answer).toMatchObject({ verdict: "pass" });
  });

  it("maps a fail verdict with findings", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = stubVerdict({
      estimated_reading_age: 12,
      verdict: "fail",
      findings: [
        { quote: "indeterminate quantity", kind: "vocabulary", why: "a child does not know 'indeterminate'", suggestion: "some" },
      ],
    });
    const result = await judge();
    expect(result.status).toBe("fail");
    expect(result.details).toMatchObject({ score: 12 });
    expect(result.findings).toHaveLength(1);
    expect(result.findings?.[0]).toMatchObject({ kind: "vocabulary" });
  });

  it("errors, keeping the call, when the model output is not JSON", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = "this is not json";
    const result = await judge();
    expect(result.status).toBe("error");
    expect(result.call?.attempts[0].outcome).toBe("not_json");
  });

  it("errors when the verdict misses the shape", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = JSON.stringify({ verdict: "maybe" });
    const result = await judge();
    expect(result.status).toBe("error");
    expect(result.reason).toContain("verdict");
    expect(result.call?.attempts[0].outcome).toBe("invalid");
  });

  it("errors without a target age", async () => {
    const result = await judge(makeTurn({ target_age: null }));
    expect(result.status).toBe("error");
    expect(result.reason).toContain("target_age");
  });

  it("errors on an empty narration", async () => {
    const result = await judge(makeTurn({ response: { narration_text: "", narration_parts: [] } }));
    expect(result.status).toBe("error");
    expect(result.reason).toContain("no narration");
  });

  it("honours the judge option targetAge over the turn's", async () => {
    const result = await judge(makeTurn({ target_age: null }), { targetAge: 9 });
    expect(result.status).toBe("pass");
    expect(result.details).toMatchObject({ target_age: 9 });
  });

  it("runs alongside flesch, in the order named", async () => {
    const results = await judgeTurn(["flesch", ID], makeTurn(), {
      root: process.cwd(),
      binding: judgeStubBinding(),
      logDir,
    });
    expect(results.map((r) => [r.id, r.tier, r.status])).toEqual([
      ["flesch", "mechanical", "pass"],
      [ID, "judge", "pass"],
    ]);
  });

  it("reports a check that throws as an error verdict instead of throwing", async () => {
    const results = await judgeTurn([ID], makeTurn(), { root: process.cwd(), binding: null, logDir });
    expect(results[0].status).toBe("error");
    expect(results[0].reason).toContain("no judge binding");
  });
});

describe("validateTurnAgeAnswer", () => {
  const ok = { estimated_reading_age: 8, findings: [{ quote: "q", kind: "clarity", why: "w", suggestion: "s" }], verdict: "pass", reasoning: "r" };

  it("accepts the documented contract", () => {
    expect(() => validateTurnAgeAnswer(ok)).not.toThrow();
  });

  it("rejects unknown finding kinds, naming the ones there are", () => {
    expect(() => validateTurnAgeAnswer({ ...ok, findings: [{ quote: "q", kind: "tone", why: "w" }] })).toThrow(/kind/);
    expect(TURN_AGE_FINDING_KINDS).toContain("clarity");
  });

  it("rejects a non-integer reading age", () => {
    for (const bad of ["eight", 8.5, Number.NaN]) {
      expect(() => validateTurnAgeAnswer({ ...ok, estimated_reading_age: bad })).toThrow(/estimated_reading_age/);
    }
  });
});
