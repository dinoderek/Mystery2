import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { judgesFor } from "../../../evaluation/core/registry.ts";
import { buildJudgeUserMessage, judgeTurn } from "../../../evaluation/runtime/lib/judges.ts";
import type { BlueprintLike } from "../../../evaluation/runtime/lib/case.ts";
import { judgeStubBinding, makeTurn } from "./runtime-turn-helpers.ts";

// The gm_* judges run the SHARED briefs over one stored turn. These tests pin
// the runtime binding (projection, verdict mapping, error paths) against the
// deterministic judge-stub wrapper, so they need no model and no network.
// RUNTIME_JUDGE_STUB_VERDICT steers the stub's reply.

const JUDGE_IDS: string[] = judgesFor("game").map((judge) => judge.id);
const MOCK_BLUEPRINT = "blueprints/mock-blueprint.json";
const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-adherence-judge-"));

function judge(id: string, turn = makeTurn(), options = {}) {
  return judgeTurn([id], turn, {
    root: process.cwd(),
    binding: judgeStubBinding(),
    logDir,
    options: { [id]: options },
  }).then(([verdict]) => verdict);
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

const mockBlueprint = (): BlueprintLike => JSON.parse(fs.readFileSync(MOCK_BLUEPRINT, "utf8"));

afterEach(() => {
  delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
});

describe("adherence judges (stub binding)", () => {
  it("shares the four game-master judges with the game harness", () => {
    expect(JUDGE_IDS).toEqual(["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"]);
    expect(judgesFor("turn").map((j) => j.id)).toEqual(expect.arrayContaining(JUDGE_IDS));
  });

  it.each(JUDGE_IDS)("%s maps a clean verdict onto the verdict contract", async (id: string) => {
    const result = await judge(id);
    expect(result).toMatchObject({ id, tier: "judge", status: "pass" });
    expect(result.details).toMatchObject({ score: 0, major_count: 0 }); // the headline score is the major-finding count
    expect(result.call?.binding).toBe("judge-stub");
  });

  it("fails on a major finding and keeps the finding detail", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({ findings: [finding()], verdict: "fail", reasoning: "Out of character." });
    const result = await judge("gm_roleplay");
    expect(result.status).toBe("fail");
    expect(result.details).toMatchObject({ score: 1, reasoning: "Out of character." });
    expect(result.findings?.[0]).toMatchObject({ kind: "persona", refers_to: "char-alice" });
  });

  it("passes when only minor findings were reported", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({ findings: [finding({ severity: "minor" })], verdict: "pass" });
    const result = await judge("gm_roleplay");
    expect(result.status).toBe("pass");
    expect(result.details).toMatchObject({ major_count: 0, minor_count: 1 });
  });

  it("lets a major finding overrule a 'pass' verdict, and records the disagreement", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({ findings: [finding()], verdict: "pass" });
    const result = await judge("gm_roleplay");
    expect(result.status).toBe("fail");
    expect(result.details).toMatchObject({ model_verdict: "pass", verdict_disagreement: true });
  });

  it("errors when the judge output misses the schema", async () => {
    // A kind from a sibling judge must not validate here: each judge's enum is its own contract.
    process.env.RUNTIME_JUDGE_STUB_VERDICT = verdict({ findings: [finding({ kind: "culprit" })], verdict: "fail" });
    const result = await judge("gm_roleplay");
    expect(result.status).toBe("error");
    expect(result.reason).toContain("kind");
  });

  it("errors when the judge output is not JSON", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = "not json at all";
    const result = await judge("gm_spoiler");
    expect(result.status).toBe("error");
    expect(result.call?.attempts[0].outcome).toBe("not_json");
  });

  it("errors without a blueprint, since the judgment is against the blueprint", async () => {
    const result = await judge("gm_fabrication", makeTurn({ blueprint_path: null }));
    expect(result.status).toBe("error");
    expect(result.reason).toContain("blueprint");
  });

  it("takes the blueprint from the judge option when one is given", async () => {
    const result = await judge("gm_fabrication", makeTurn({ blueprint_path: null }), { blueprintPath: MOCK_BLUEPRINT });
    expect(result.status).toBe("pass");
  });

  it("errors on an empty narration instead of judging nothing", async () => {
    const result = await judge("gm_spoiler", makeTurn({ response: { narration_text: "  ", raw: {} } }));
    expect(result.status).toBe("error");
    expect(result.reason).toContain("no narration");
  });

  it("runs alongside flesch, in the order named", async () => {
    const results = await judgeTurn(["flesch", "gm_roleplay", "gm_spoiler"], makeTurn(), {
      root: process.cwd(),
      binding: judgeStubBinding(),
      logDir,
    });
    expect(results.map((r) => r.id)).toEqual(["flesch", "gm_roleplay", "gm_spoiler"]);
    expect(results.every((r) => r.status === "pass")).toBe(true);
  });
});

describe("buildJudgeUserMessage", () => {
  it("hands the judge the blueprint and a one-judged-turn subject", () => {
    const blueprint = { metadata: { title: "Mock" } } as unknown as BlueprintLike;
    const message = JSON.parse(buildJudgeUserMessage("gm_clue_discipline", makeTurn(), blueprint));
    expect(message.dimension_id).toBe("gm_clue_discipline");
    expect(message.blueprint).toEqual(blueprint);
    expect(message.subject.subject_kind).toBe("interaction");
    expect(message.subject.judged_sequences).toEqual([2]);
  });

  it("labels the judged turn with the role the model actually ran as", () => {
    const blueprint = mockBlueprint();
    const given = { mode: "explore", location_id: "loc-kitchen", history: [] };
    // A search WITH a query resolves to a different role than a bare one, and
    // the label has to follow the same resolver the narrator replay uses.
    const roleOf = (action: Record<string, unknown>) =>
      JSON.parse(buildJudgeUserMessage("gm_clue_discipline", makeTurn({ given, action }), blueprint)).subject.turns.at(-1).role_name;
    expect(roleOf({ type: "search" })).toBe("search_bare");
    expect(roleOf({ type: "search", search_query: "look in the bin" })).toBe("search_targeted");
  });

  it("marks an accusation turn so the spoiler judge stands down", () => {
    const given = { mode: "accuse", location_id: "loc-kitchen", history: [] };
    const action = { type: "accuse", player_reasoning: "It was Alice, the crumbs prove it." };
    const message = JSON.parse(buildJudgeUserMessage("gm_spoiler", makeTurn({ given, action }), mockBlueprint()));
    const judged = message.subject.turns.at(-1);
    expect(judged.role_name).toBe("accusation_judge");
    expect(judged.is_accusation_phase).toBe(true);
  });
});
