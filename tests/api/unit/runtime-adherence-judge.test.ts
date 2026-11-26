import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { answerJsonSchema } from "../../../evaluation/core/judge-prompt.ts";
import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { judgesFor } from "../../../evaluation/core/registry.ts";
import { buildJudgeUserMessage, judgeTurn } from "../../../evaluation/runtime/lib/judges.ts";
import type { BlueprintLike } from "../../../evaluation/runtime/lib/case.ts";
import { judgeStubBinding, makeTurn } from "./runtime-turn-helpers.ts";
import { MOCK_CASE_PATH, readMockCase } from "../../testkit/src/mock-case.ts";

// The gm_* judges run the SHARED briefs over one stored turn. These tests pin
// the runtime binding (projection, verdict mapping, error paths) against the
// deterministic judge-stub wrapper, so they need no model and no network.
// RUNTIME_JUDGE_STUB_VERDICT steers the stub's reply.

const JUDGE_IDS: string[] = judgesFor("game").map((judge) => judge.id);
const MOCK_BLUEPRINT = MOCK_CASE_PATH;
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

const mockBlueprint = (): BlueprintLike => readMockCase() as unknown as BlueprintLike;

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

  it("hands its wrapper the schema its prompt shows", async () => {
    for (const id of JUDGE_IDS) {
      await judge(id);
      const schema = JSON.parse(fs.readFileSync(path.join(logDir, `judge-${id}.schema.json`), "utf8"));
      expect(schema, id).toEqual(answerJsonSchema(await loadJudge(id)));
      expect(fs.readFileSync(path.join(logDir, `judge-${id}.system.txt`), "utf8"), id).toContain(JSON.stringify(schema, null, 2));
    }
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
  it("hands the judge the case itself and a one-judged-turn subject", () => {
    const blueprint = mockBlueprint();
    const message = JSON.parse(buildJudgeUserMessage("gm_clue_discipline", makeTurn(), blueprint));
    expect(message.dimension_id).toBe("gm_clue_discipline");
    // The case without an age of its own: each judged turn carries the one it was narrated at.
    const { metadata, ...rest } = blueprint.clue_graph;
    expect(message.blueprint).toEqual({ ...rest, metadata: Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== "target_age")) });
    expect(message.subject.subject_kind).toBe("interaction");
    expect(message.subject.judged_sequences).toEqual([2]);
    expect(message.subject.turns.at(-1)).toMatchObject({ judged: true, reading_age: 10 });
  });

  it("labels the judged turn with the role the model actually ran as", () => {
    const blueprint = mockBlueprint();
    const given = { mode: "explore", location_id: "loc-kitchen", history: [] };
    // A clue-graph search is narrated in `graph_search` and saved as `search`; the label follows
    // the same resolver the narrator replay uses, with or without a query.
    const roleOf = (action: Record<string, unknown>) =>
      JSON.parse(buildJudgeUserMessage("gm_clue_discipline", makeTurn({ given, action }), blueprint)).subject.turns.at(-1).role_name;
    expect(roleOf({ type: "search" })).toBe("search");
    expect(roleOf({ type: "search", search_query: "look in the bin" })).toBe("search");
    expect(roleOf({ type: "talk", character_id: "char-alice" })).toBe("graph_talk");
  });

  it("marks only a clue-graph case's closing scene, by the role its accusation was worded in", () => {
    const given = { mode: "accuse", location_id: "loc-kitchen", history: [] };
    const action = { type: "accuse", player_reasoning: "It was Alice: the cookie jar is empty." };
    const judgedAs = (role: string, eventType: string) => {
      const response = { ...makeTurn().response, raw: { events: [{ event_type: eventType, payload: { role } }] } };
      return JSON.parse(buildJudgeUserMessage("gm_spoiler", makeTurn({ given, action, response }), mockBlueprint())).subject.turns.at(-1);
    };
    expect(judgedAs("graph_ending", "accuse_resolved")).toMatchObject({ role_name: "graph_ending", is_accusation_phase: true });
    expect(judgedAs("graph_accusation_round", "accuse_failed")).toMatchObject({ role_name: "graph_accusation_round", is_accusation_phase: false });
  });

  it("marks only the closing scene so the spoiler judge stands down, never a failed accusation", () => {
    const given = { mode: "accuse", location_id: "loc-kitchen", history: [] };
    const action = { type: "accuse", player_reasoning: "It was Alice, the crumbs prove it." };
    const judgedAs = (eventType: string) => {
      const response = { ...makeTurn().response, raw: { events: [{ event_type: eventType }] } };
      const message = JSON.parse(buildJudgeUserMessage("gm_spoiler", makeTurn({ given, action, response }), mockBlueprint()));
      return message.subject.turns.at(-1);
    };
    expect(judgedAs("accuse_resolved")).toMatchObject({ role_name: "graph_accusation", is_accusation_phase: true });
    expect(judgedAs("accuse_failed")).toMatchObject({ role_name: "graph_accusation", is_accusation_phase: false });
    // A turn taken from a stored game has no raw answer: its action names the event.
    const stored = (eventType: string) => {
      const response = { ...makeTurn().response, action: eventType, raw: null };
      return JSON.parse(buildJudgeUserMessage("gm_spoiler", makeTurn({ given, action, response }), mockBlueprint())).subject.turns.at(-1);
    };
    expect(stored("accuse_resolved").is_accusation_phase).toBe(true);
    expect(stored("accuse_failed").is_accusation_phase).toBe(false);
    // A turn replayed on a model CLI holds the judge's own output, its action the case's.
    const replayed = (resolution: string) => {
      const response = { ...makeTurn().response, action: "accuse", raw: { narration: "…", accusation_resolution: resolution } };
      return JSON.parse(buildJudgeUserMessage("gm_spoiler", makeTurn({ given, action, response }), mockBlueprint())).subject.turns.at(-1);
    };
    expect(["win", "lose", "continue"].map((resolution) => replayed(resolution).is_accusation_phase)).toEqual([true, true, false]);
  });
});
