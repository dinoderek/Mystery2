import { afterEach, describe, expect, it } from "vitest";

import {
  id as judgeId,
  judge,
  validateVerdict,
} from "../../../evaluation/runtime/lib/judges/age-appropriate.mjs";
import { runJudges } from "../../../evaluation/runtime/lib/judges/index.mjs";

// The judge spawns its model through the harness's CLI bindings. These tests
// pin the deterministic judge-stub wrapper (no network, no model) and steer
// its output through RUNTIME_JUDGE_STUB_VERDICT to exercise each path.
const STUB_CONFIG = { cli: "judge-stub" };

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "test-case",
    target_age: 7,
    action: { type: "ask", player_input: "Where were you?" },
    response: {
      narration_text: "I was in the garden. I picked some flowers.",
      narration_parts: [
        {
          text: "I was in the garden. I picked some flowers.",
          speaker: { kind: "character" },
        },
      ],
    },
    ...overrides,
  };
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

describe("age_appropriate judge (stub CLI)", () => {
  it("maps a pass verdict onto the judge result contract", async () => {
    const result = await judge(makeInteraction(), { config: STUB_CONFIG });
    expect(result.id).toBe(judgeId);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(8); // estimated_reading_age is the headline score
    expect(result.details.target_age).toBe(7);
    expect(result.details.findings).toEqual([]);
    expect(result.details.judge_model).toContain("judge-stub");
  });

  it("maps a fail verdict with findings", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = stubVerdict({
      estimated_reading_age: 12,
      verdict: "fail",
      findings: [
        {
          quote: "indeterminate quantity",
          kind: "vocabulary",
          why: "a 7-year-old does not know 'indeterminate'",
          suggestion: "some",
        },
      ],
    });
    const result = await judge(makeInteraction(), { config: STUB_CONFIG });
    expect(result.status).toBe("fail");
    expect(result.score).toBe(12);
    expect(result.details.findings).toHaveLength(1);
    expect(result.details.findings[0].kind).toBe("vocabulary");
  });

  it("returns error when the model output is not valid JSON", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = "this is not json";
    const result = await judge(makeInteraction(), { config: STUB_CONFIG });
    expect(result.status).toBe("error");
    expect(result.score).toBeNull();
  });

  it("returns error (after retries) when the verdict misses the shape", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = JSON.stringify({
      verdict: "maybe",
    });
    const result = await judge(makeInteraction(), { config: STUB_CONFIG });
    expect(result.status).toBe("error");
    expect(String(result.details.reason)).toContain("verdict");
  });

  it("errors without a target age", async () => {
    const result = await judge(makeInteraction({ target_age: null }), {
      config: STUB_CONFIG,
    });
    expect(result.status).toBe("error");
    expect(result.details.reason).toContain("target_age");
  });

  it("errors on an empty narration", async () => {
    const result = await judge(
      makeInteraction({ response: { narration_text: "", narration_parts: [] } }),
      { config: STUB_CONFIG },
    );
    expect(result.status).toBe("error");
    expect(result.details.reason).toContain("no narration");
  });

  it("honours config.targetAge over the interaction's target_age", async () => {
    const result = await judge(makeInteraction({ target_age: null }), {
      config: { ...STUB_CONFIG, targetAge: 9 },
    });
    expect(result.status).toBe("pass");
    expect(result.details.target_age).toBe(9);
  });

  it("runs alongside flesch through the async judge registry", async () => {
    const results = await runJudges(
      ["flesch", "age_appropriate"],
      makeInteraction(),
      { age_appropriate: STUB_CONFIG },
    );
    expect(results.map((r: { id: string }) => r.id)).toEqual([
      "flesch",
      "age_appropriate",
    ]);
    expect(results[0].status).toBe("pass");
    expect(results[1].status).toBe("pass");
  });

  it("reports unknown judges as error results instead of throwing", async () => {
    const results = await runJudges(["nope"], makeInteraction(), {});
    expect(results[0].status).toBe("error");
    expect(results[0].details.error).toContain("Unknown judge");
  });
});

describe("validateVerdict", () => {
  it("accepts the documented contract", () => {
    expect(() =>
      validateVerdict({
        estimated_reading_age: 8,
        findings: [
          { quote: "q", kind: "clarity", why: "w", suggestion: "s" },
        ],
        verdict: "pass",
        reasoning: "r",
      }),
    ).not.toThrow();
  });

  it("rejects unknown finding kinds", () => {
    expect(() =>
      validateVerdict({
        estimated_reading_age: 8,
        findings: [{ quote: "q", kind: "tone", why: "w" }],
        verdict: "pass",
        reasoning: "r",
      }),
    ).toThrow(/kind/);
  });

  it("rejects a non-numeric reading age", () => {
    expect(() =>
      validateVerdict({
        estimated_reading_age: "eight",
        findings: [],
        verdict: "pass",
        reasoning: "r",
      }),
    ).toThrow(/estimated_reading_age/);
  });
});
