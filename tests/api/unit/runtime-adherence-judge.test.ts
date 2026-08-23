import { afterEach, describe, expect, it } from "vitest";

import { buildJudgeUserMessage } from "../../../evaluation/runtime/lib/judges/adherence.mjs";
import { getJudge, judgeIds, runJudges } from "../../../evaluation/runtime/lib/judges/index.mjs";
import { ADHERENCE_JUDGE_IDS } from "../../../evaluation/judges/index.mjs";

// The gm_* judges run the SHARED briefs over one stored interaction. These
// tests pin the runtime binding — projection, verdict mapping, error paths —
// against the deterministic judge-stub wrapper, so they need no model and no
// network. RUNTIME_JUDGE_STUB_VERDICT steers the stub's reply.
const STUB = { cli: "judge-stub" };

// Untyped .mjs export; name it once so it.each() can infer the callback.
const JUDGE_IDS: string[] = ADHERENCE_JUDGE_IDS;

const MOCK_BLUEPRINT = "supabase/seed/blueprints/mock-blueprint.json";

function makeInteraction(overrides: Record<string, unknown> = {}) {
  return {
    case_id: "ask-alice-pressure",
    blueprint_path: MOCK_BLUEPRINT,
    target_age: 10,
    given: {
      mode: "talk",
      location_id: "loc-kitchen",
      talk_character_id: "char-alice",
      time_remaining: 7,
      history: [
        {
          event_type: "ask",
          actor: "system",
          narration: '"I never went near the jar," Alice says.',
          payload: {
            character_id: "char-alice",
            player_input: "Did you take the cookies?",
            revealed_clue_ids: ["clue-crumb"],
          },
        },
      ],
    },
    action: { type: "ask", player_input: "Then why are your hands shaking?" },
    response: {
      narration_text: '"They are not!" Alice says, sitting on her hands.',
      raw: { narration: "…", revealed_clue_ids: [], revealed_off_script: [] },
    },
    ...overrides,
  };
}

function verdict(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({ findings: [], verdict: "pass", reasoning: "Nothing to report.", ...overrides });
}

function finding(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 2,
    severity: "major",
    kind: "persona",
    quote: "They are not!",
    why: "Alice is authored as calm and evasive under pressure.",
    refers_to: "char-alice",
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
});

describe("adherence judges (stub CLI)", () => {
  it("registers every shared judge in the runtime harness", () => {
    expect(judgeIds()).toEqual(["flesch", "age_appropriate", ...JUDGE_IDS]);
  });

  it.each(JUDGE_IDS)("%s maps a clean verdict onto the judge contract", async (id: string) => {
    const result = await getJudge(id).judge(makeInteraction(), { config: STUB });
    expect(result.id).toBe(id);
    expect(result.status).toBe("pass");
    expect(result.score).toBe(0); // headline score is the major-finding count
    expect(result.details.major_count).toBe(0);
    expect(result.details.judge_model).toContain("judge-stub");
  });

  it("fails on a major finding and keeps the finding detail", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({
      findings: [finding()],
      verdict: "fail",
      reasoning: "Out of character.",
    });
    const result = await getJudge("gm_roleplay").judge(makeInteraction(), { config: STUB });
    expect(result.status).toBe("fail");
    expect(result.score).toBe(1);
    expect(result.details.findings[0]).toMatchObject({ kind: "persona", refers_to: "char-alice" });
    expect(result.details.reasoning).toBe("Out of character.");
  });

  it("passes when only minor findings were reported", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({
      findings: [finding({ severity: "minor" })],
      verdict: "pass",
    });
    const result = await getJudge("gm_roleplay").judge(makeInteraction(), { config: STUB });
    expect(result.status).toBe("pass");
    expect(result.details).toMatchObject({ major_count: 0, minor_count: 1 });
  });

  it("lets a major finding overrule a 'pass' verdict, and records the disagreement", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({ findings: [finding()], verdict: "pass" });
    const result = await getJudge("gm_roleplay").judge(makeInteraction(), { config: STUB });
    expect(result.status).toBe("fail");
    expect(result.details.model_verdict).toBe("pass");
    expect(result.details.verdict_disagreement).toBe(true);
  });

  it("errors when the judge output misses the schema", async () => {
    // A kind from a sibling judge must not validate here: each judge's enum is
    // its own contract.
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({
      findings: [finding({ kind: "culprit" })],
      verdict: "fail",
    });
    const result = await getJudge("gm_roleplay").judge(makeInteraction(), { config: STUB });
    expect(result.status).toBe("error");
    expect(String(result.details.reason)).toContain("kind");
  });

  it("errors when the judge output is not JSON", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = "not json at all";
    const result = await getJudge("gm_spoiler").judge(makeInteraction(), { config: STUB });
    expect(result.status).toBe("error");
    expect(result.score).toBeNull();
  });

  it("errors without a blueprint, since the judgment is against the blueprint", async () => {
    const result = await getJudge("gm_fabrication").judge(
      makeInteraction({ blueprint_path: null }),
      { config: STUB },
    );
    expect(result.status).toBe("error");
    expect(String(result.details.reason)).toContain("blueprint");
  });

  it("errors on an empty narration instead of judging nothing", async () => {
    const result = await getJudge("gm_spoiler").judge(
      makeInteraction({ response: { narration_text: "  ", raw: {} } }),
      { config: STUB },
    );
    expect(result.status).toBe("error");
    expect(String(result.details.reason)).toContain("no narration");
  });

  it("runs alongside the readability judges through the registry", async () => {
    const results = await runJudges(
      ["flesch", "gm_roleplay", "gm_spoiler"],
      makeInteraction(),
      { gm_roleplay: STUB, gm_spoiler: STUB },
    );
    expect(results.map((r: { id: string }) => r.id)).toEqual([
      "flesch",
      "gm_roleplay",
      "gm_spoiler",
    ]);
    expect(results.every((r: { status: string }) => r.status === "pass")).toBe(true);
  });
});

describe("buildJudgeUserMessage", () => {
  it("hands the judge the blueprint and a one-judged-turn subject", async () => {
    const blueprint = { metadata: { title: "Mock" } };
    const message = JSON.parse(
      buildJudgeUserMessage("gm_clue_discipline", makeInteraction(), blueprint),
    );
    expect(message.dimension_id).toBe("gm_clue_discipline");
    expect(message.blueprint).toEqual(blueprint);
    expect(message.subject.subject_kind).toBe("interaction");
    expect(message.subject.judged_sequences).toEqual([2]);
  });

  it("labels the judged turn with the role the model actually ran as", async () => {
    const blueprint = JSON.parse(
      await (await import("node:fs/promises")).readFile(MOCK_BLUEPRINT, "utf-8"),
    );

    // A search WITH a query resolves to a different role than a bare one, and
    // the label has to follow the same resolver the backends use.
    const bare = JSON.parse(
      buildJudgeUserMessage(
        "gm_clue_discipline",
        makeInteraction({
          given: { mode: "explore", location_id: "loc-kitchen", history: [] },
          action: { type: "search" },
        }),
        blueprint,
      ),
    );
    const targeted = JSON.parse(
      buildJudgeUserMessage(
        "gm_clue_discipline",
        makeInteraction({
          given: { mode: "explore", location_id: "loc-kitchen", history: [] },
          action: { type: "search", search_query: "look in the bin" },
        }),
        blueprint,
      ),
    );
    expect(bare.subject.turns.at(-1).role_name).toBe("search_bare");
    expect(targeted.subject.turns.at(-1).role_name).toBe("search_targeted");
  });

  it("marks an accusation turn so the spoiler judge stands down", async () => {
    const blueprint = JSON.parse(
      await (await import("node:fs/promises")).readFile(MOCK_BLUEPRINT, "utf-8"),
    );
    const message = JSON.parse(
      buildJudgeUserMessage(
        "gm_spoiler",
        makeInteraction({
          given: { mode: "accuse", location_id: "loc-kitchen", history: [] },
          action: { type: "accuse", player_reasoning: "It was Alice, the crumbs prove it." },
        }),
        blueprint,
      ),
    );
    const judged = message.subject.turns.at(-1);
    expect(judged.role_name).toBe("accusation_judge");
    expect(judged.is_accusation_phase).toBe(true);
  });
});
