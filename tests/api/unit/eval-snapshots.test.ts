// What the evaluation harnesses ask, and what they conclude, pinned on stub
// bindings.
//
// Every harness runs as it ships, with its model CLI replaced by
// eval-snapshot-stub.mjs, which keeps the system prompt and user message it
// is handed. So the first set of tests compares the exact bytes each judge,
// the generator and the investigator would send a model with the stored ones,
// and the second set compares the verdicts each harness reaches on a fixed
// answer for each judge. Editing a brief, a schema, a preamble or the way a
// prompt is composed fails the first set; changing how a verdict is reached
// fails the second. No model is called.
//
// Stored files live in tests/api/unit/snapshots/evaluation/. Re-recording them
// is a decision about what the judges are asked, never a way to make a test
// pass: `npm run test:snapshots:record`, then read the diff.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { GameState } from "../../../packages/shared/src/mystery-api-contracts.ts";
import { resolveBinding } from "../../../evaluation/core/config.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { judgeTurnCommand } from "../../../evaluation/runtime/judge-turn.ts";
import { gradeGame } from "../../../evaluation/playtest/lib/judge.ts";
import { INVESTIGATOR_BINDING, listPersonas, modelInvestigator } from "../../../evaluation/playtest/lib/investigator.ts";
import { buildView } from "../../../evaluation/playtest/lib/view.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";
import { generatorBrief } from "./fixtures/generator-brief.ts";
import {
  clearForRecording,
  expectStored,
  promptFiles,
  storedFiles,
  verdictFile,
  type PromptParts,
} from "./eval-snapshot-store.ts";
import { makeClueGraphRawTrace, makeRawTrace } from "./trace-fixtures.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = process.cwd();
const STUB = path.join(HERE, "eval-snapshot-stub.mjs");
const FAKE_CLAUDE = path.join(HERE, "fixtures", "fake-claude-cli.mjs");
const ANSWERS = JSON.parse(
  fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8"),
) as Record<string, unknown>;

const BLUEPRINT_DIMENSIONS = [
  "solve_depth",
  "fairness",
  "timeline_coherence",
  "knowledge_coherence",
  "character_grounding",
  "path_payoff",
  "clue_graph",
  "age_appropriate",
];
/** The judges of a clue-graph case, run on the greenhouse story by `judge blueprint`. */
const CASE_JUDGES = ["cg_soundness", "cg_truth_agreement", "cg_character_grounding", "cg_step_sense"];
const GM_JUDGES = ["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"];
// Candidates run only when named, so each harness runs them apart from its default battery.
const BLUEPRINT_CANDIDATES = ["solve_depth_fairness", "knowledge_timeline_coherence", "blueprint_broad"];
const GM_CANDIDATES = ["gm_broad"];
/** A clue-graph game's judges carry format guidance, so every game-master judge is kept for it too. */
const GRAPH_JUDGES = [...GM_JUDGES, ...GM_CANDIDATES];
const PERSONAS = listPersonas() as string[];

const PROMPT_IDS = [
  ...BLUEPRINT_DIMENSIONS.map((id) => `blueprint.${id}`),
  "generator",
  "generator.repair",
  ...GM_JUDGES.map((id) => `trace.${id}`),
  ...GM_JUDGES.map((id) => `runtime.${id}`),
  "runtime.age_appropriate",
  ...PERSONAS.map((persona) => `investigator.${persona}`),
  ...BLUEPRINT_CANDIDATES.map((id) => `blueprint.${id}`),
  ...GM_CANDIDATES.flatMap((id) => [`trace.${id}`, `runtime.${id}`]),
  ...GRAPH_JUDGES.flatMap((id) => [`trace-clue-graph.${id}`, `runtime-clue-graph.${id}`]),
  ...CASE_JUDGES.map((id) => `blueprint.${id}`),
];
const VERDICT_NAMES = ["blueprint", "trace", "runtime", "playtest-judging", "candidates", "blueprint-clue-graph"];

type Json = any; // eslint-disable-line @typescript-eslint/no-explicit-any

const prompts = new Map<string, PromptParts>();
const verdicts = new Map<string, unknown>();
let scratch = "";

/** A binding for the stub: it keeps what it is sent under `key`, and answers from the table. */
function stubBinding(answersFile: string, key: string, captureDir: string | "-" = path.join(scratch, "captured")) {
  return {
    cmd: process.execPath,
    args: [STUB, captureDir, answersFile, key, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    timeout_ms: 60_000,
    retries: 0,
  };
}

function runNode(args: string[]): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => (output += chunk));
    child.stderr.on("data", (chunk) => (output += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code, output }));
  });
}

function findFiles(dir: string, name: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findFiles(full, name));
    else if (entry.name === name) found.push(full);
  }
  return found;
}

/** The one result.json a harness wrote under `dir`, or the output that says why there is none. */
async function runForResult(args: string[], dir: string): Promise<Json> {
  const { output } = await runNode(args);
  const results = fs.existsSync(dir) ? findFiles(dir, "result.json") : [];
  if (results.length !== 1) {
    throw new Error(`${args[0]} wrote ${results.length} result.json files under ${dir}:\n${output}`);
  }
  return JSON.parse(fs.readFileSync(results[0], "utf8"));
}

function capturedPrompt(key: string, folder = "captured"): PromptParts {
  const dir = path.join(scratch, folder);
  const system = path.join(dir, `${key}.system.txt`);
  const user = path.join(dir, `${key}.user.txt`);
  if (!fs.existsSync(system) || !fs.existsSync(user)) throw new Error(`${key} was never sent a prompt`);
  return { system: fs.readFileSync(system, "utf8"), user: fs.readFileSync(user, "utf8") };
}

function check(result: Json) {
  return { id: result.id, status: result.status, details: result.details };
}

function dimension(result: Json) {
  return {
    id: result.id,
    overall: result.overall,
    analyzer: result.analyzer ? { status: result.analyzer.status, details: result.analyzer.details } : null,
    judge: result.judge
      ? {
          status: result.judge.status,
          reasoning: result.judge.reasoning,
          major_count: result.judge.major_count ?? null,
          minor_count: result.judge.minor_count ?? null,
          model_verdict: result.judge.model_verdict ?? null,
          verdict_disagreement: result.judge.verdict_disagreement ?? null,
          answer: result.judge.raw,
        }
      : null,
    error: result.error ? { stage: result.error.stage, message: result.error.message } : null,
  };
}

/**
 * The verdict set a blueprint run stores: the new result.json read back into the
 * shape the snapshot has always had. The fields a result no longer carries are
 * fixed, so what is compared is each check's and dimension's status, details,
 * reasoning and answer.
 */
function blueprintVerdicts(result: Result) {
  const byId = new Map(result.verdicts.map((verdict) => [verdict.id, verdict]));
  const dimensionIds = result.verdicts.filter((verdict) => verdict.tier === "judge").map((verdict) => verdict.id);
  return {
    generation: { source: "cli", attempts: result.production?.calls[0].attempts.map((attempt) => attempt.outcome) },
    mechanical: result.verdicts
      .filter((verdict) => verdict.tier === "mechanical")
      .map((verdict) => ({ id: verdict.id, status: verdict.status, details: verdict.details ?? null })),
    dimensions: dimensionIds.map((id) => {
      const analyzer = byId.get(`${id}.analyzer`);
      const judge = byId.get(id) as Result["verdicts"][number];
      const statuses = [analyzer?.status, judge.status].filter((status) => status !== undefined);
      return {
        id,
        overall: statuses.every((status) => status === "pass") ? "pass" : "fail",
        analyzer: analyzer ? { status: analyzer.status, details: analyzer.details } : null,
        judge: {
          status: judge.status,
          reasoning: (judge.answer as Json).reasoning,
          major_count: null,
          minor_count: null,
          model_verdict: null,
          verdict_disagreement: null,
          answer: judge.answer,
        },
        error: null,
      };
    }),
    run_error: result.run_error,
  };
}

/** A game-master judge's verdict in the result format, as the verdict snapshots record a dimension. */
function judgeDimension(verdict: Json) {
  return dimension({
    id: verdict.id,
    overall: verdict.status,
    analyzer: null,
    judge: {
      status: verdict.status,
      reasoning: verdict.details?.reasoning,
      major_count: verdict.details?.major_count,
      minor_count: verdict.details?.minor_count,
      model_verdict: verdict.details?.model_verdict,
      verdict_disagreement: verdict.details?.verdict_disagreement,
      raw: verdict.answer,
    },
    error: null,
  });
}

async function runBlueprintPipeline(answersFile: string) {
  const briefFile = path.join(scratch, "blueprint", "brief.json");
  const config = path.join(scratch, "blueprint", "config.json");
  fs.mkdirSync(path.dirname(briefFile), { recursive: true });
  fs.writeFileSync(briefFile, JSON.stringify(generatorBrief));
  fs.writeFileSync(
    config,
    JSON.stringify({
      "generator-agent": stubBinding(answersFile, "generator"),
      "blueprint-judge": stubBinding(answersFile, "blueprint.{id}"),
    }),
  );

  const outputRoot = path.join(scratch, "blueprint", "out");
  const result = (await runForResult(
    ["dev", "generate", briefFile, "--judge", "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  )) as Result;
  verdicts.set("blueprint", blueprintVerdicts(result));
  prompts.set("generator", capturedPrompt("generator"));
  for (const id of BLUEPRINT_DIMENSIONS) prompts.set(`blueprint.${id}`, capturedPrompt(`blueprint.${id}`));
}

/** A repair round on the blueprint the stub judges fail: what the generator is sent to repair it. */
async function runRepairRound(answersFile: string) {
  const briefFile = path.join(scratch, "repair", "brief.json");
  const config = path.join(scratch, "repair", "config.json");
  fs.mkdirSync(path.dirname(briefFile), { recursive: true });
  fs.writeFileSync(briefFile, JSON.stringify(generatorBrief));
  fs.writeFileSync(
    config,
    JSON.stringify({
      "generator-agent": stubBinding(answersFile, "generator.repair"),
      "blueprint-judge": stubBinding(answersFile, "blueprint.{id}", "-"),
    }),
  );
  const outputRoot = path.join(scratch, "repair", "out");
  const result = (await runForResult(
    ["dev", "generate", briefFile, "--judge", "--repair", "1", "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  )) as Result;
  if (result.rounds?.length !== 2) throw new Error(`the repair run made ${result.rounds?.length ?? 0} round(s), not 2`);
  // The generation and the repair share the key; the repair is sent last.
  prompts.set("generator.repair", capturedPrompt("generator.repair"));
}

async function runTraceHarness(answersFile: string) {
  const traceFile = path.join(scratch, "trace", "trace.json");
  const config = path.join(scratch, "trace", "config.json");
  fs.mkdirSync(path.dirname(traceFile), { recursive: true });
  fs.writeFileSync(traceFile, JSON.stringify(makeRawTrace()));
  fs.writeFileSync(config, JSON.stringify({ "game-judge": stubBinding(answersFile, "trace.{id}") }));

  const outputRoot = path.join(scratch, "trace", "out");
  const result = await runForResult(
    ["dev", "eval", "judge", "game", traceFile, "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  );
  const reconstruction = JSON.parse(
    fs.readFileSync(path.join(path.dirname(findFiles(outputRoot, "result.json")[0]), "reconstruction.json"), "utf8"),
  );
  // The verdicts, in the shape they were recorded in before the harness moved onto
  // the core's result format.
  const judges = result.verdicts.filter((verdict: Json) => verdict.tier === "judge");
  verdicts.set("trace", {
    reconstruction: { turns: reconstruction.turns.length, context_errors: reconstruction.issues.length, issues: reconstruction.issues },
    mechanical: result.verdicts.filter((verdict: Json) => verdict.tier === "mechanical").map(check),
    dimensions: judges.map(judgeDimension),
    run_error: result.run_error,
  });
  for (const id of GM_JUDGES) prompts.set(`trace.${id}`, capturedPrompt(`trace.${id}`));
}

/** One ask of Toby in the greenhouse clue-graph case, with the move and greeting before it as recorded by the engine. */
function graphTurnCase(blueprintFile: string, judges: string[]) {
  return {
    id: "ask-toby",
    blueprint: { path: blueprintFile },
    given: {
      mode: "talk",
      location_id: "potting_shed",
      talk_character_id: "toby",
      time_remaining: 9,
      history: [
        { event_type: "move", actor: "system", narration: "You step into the potting shed.", payload: { location_id: "potting_shed", clue_graph: { type: "move", location: "potting_shed" } } },
        {
          event_type: "talk",
          actor: "system",
          narration: "Toby looks up from the pots. \"I was sweeping up all evening,\" he says.",
          payload: { character_id: "toby", location_id: "potting_shed", revealed_clue_ids: ["toby_alibi", "react_toby_trainers", "toby_blames_thorne"], clue_graph: { type: "talk", character: "toby" } },
        },
      ],
    },
    action: { type: "ask", player_input: "Where did you leave your wellies?" },
    judges,
  };
}

/** Replays one case through `judge turn` with these judges, and reads back what it wrote. */
async function runTurnCase(
  answersFile: string,
  folder: string,
  judges: string[],
  expectedCode: number,
  { graph = false, captureDir }: { graph?: boolean; captureDir?: string } = {},
) {
  const dir = path.join(scratch, folder);
  fs.mkdirSync(dir, { recursive: true });
  const blueprintFile = path.join(dir, "blueprint.json");
  fs.writeFileSync(
    blueprintFile,
    graph ? fs.readFileSync(path.join(REPO_ROOT, "blueprints", "clue-graph", "greenhouse-prizewinner.json")) : JSON.stringify(validBlueprintV2),
  );

  const testCase = graph ? graphTurnCase(blueprintFile, judges) : {
    id: "ask-alice",
    blueprint: { path: blueprintFile },
    given: {
      mode: "talk",
      location_id: "kitchen",
      talk_character_id: "alice",
      time_remaining: 7,
      history: [
        {
          event_type: "talk",
          actor: "system",
          narration: "You step closer to Alice by the counter. She gives you a quick, tight smile.",
          payload: { character_id: "alice" },
        },
      ],
    },
    action: { type: "ask", player_input: "Where did the cookies go?" },
    judges,
  };
  const caseFile = path.join(dir, "case.mjs");
  fs.writeFileSync(caseFile, `export default ${JSON.stringify(testCase)};\n`);
  const config = path.join(dir, "config.json");
  fs.writeFileSync(
    config,
    JSON.stringify({
      "narrator-stub": {
        cmd: "evaluation/runtime/config/wrappers/stub-runtime.sh",
        args: ["{{user_message_file}}"],
        timeout_ms: 30_000,
      },
      "turn-judge": stubBinding(answersFile, "runtime.{id}", captureDir),
    }),
  );

  const outputRoot = path.join(dir, "out");
  const output: string[] = [];
  const code = await judgeTurnCommand.run(
    [caseFile, "--narrator", "narrator-stub", "--config", config, "--output-root", outputRoot],
    { root: REPO_ROOT, out: (text) => output.push(text), err: (text) => output.push(text), env: {} },
  );
  if (code !== expectedCode) throw new Error(`judge turn exited ${code}:\n${output.join("\n")}`);
  const [resultFile] = findFiles(outputRoot, "result.json");
  const result = JSON.parse(fs.readFileSync(resultFile, "utf8"));
  const turn = JSON.parse(fs.readFileSync(path.join(path.dirname(resultFile), "turn.json"), "utf8"));
  return {
    case_id: turn.case_id,
    narrator: turn.narrator,
    model: turn.model,
    narration: turn.response.narration_text,
    judges: result.verdicts.map((verdict: Json) => {
      const { score, ...details } = verdict.details;
      return {
        id: verdict.id,
        tier: verdict.tier,
        status: verdict.status,
        score,
        details,
        findings: verdict.findings ?? null,
        attempts: verdict.call?.attempts.map((attempt: Json) => attempt.outcome) ?? null,
      };
    }),
    summary: result.summary,
  };
}

/**
 * A clue-graph game on both harnesses: the trace harness on a played greenhouse
 * game and `judge turn` on one conversation turn of it. The prompts are kept
 * apart from the V2 ones, so the graph guidance each judge is handed shows.
 */
async function runClueGraphHarnesses(answersFile: string) {
  const dir = path.join(scratch, "clue-graph");
  const traceFile = path.join(dir, "trace.json");
  const config = path.join(dir, "config.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(traceFile, JSON.stringify(makeClueGraphRawTrace()));
  fs.writeFileSync(
    config,
    JSON.stringify({ "game-judge": stubBinding(answersFile, "trace.{id}", path.join(scratch, "captured-graph-trace")) }),
  );
  const outputRoot = path.join(dir, "out");
  await runForResult(
    ["dev", "eval", "judge", "game", traceFile, "--judges", GRAPH_JUDGES.join(","), "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  );
  await runTurnCase(answersFile, "runtime-clue-graph", GRAPH_JUDGES, 2, { graph: true, captureDir: path.join(scratch, "captured-graph-runtime") });
  for (const id of GRAPH_JUDGES) {
    prompts.set(`trace-clue-graph.${id}`, capturedPrompt(`trace.${id}`, "captured-graph-trace"));
    prompts.set(`runtime-clue-graph.${id}`, capturedPrompt(`runtime.${id}`, "captured-graph-runtime"));
  }
}

/** `judge blueprint` on the greenhouse case: its check, and the four judges a clue-graph case gets. */
async function runClueGraphBlueprint(answersFile: string) {
  const dir = path.join(scratch, "blueprint-clue-graph");
  const caseFile = path.join(dir, "greenhouse-prizewinner.json");
  const config = path.join(dir, "config.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, "blueprints", "clue-graph", "greenhouse-prizewinner.json"), caseFile);
  fs.writeFileSync(
    config,
    JSON.stringify({ "blueprint-judge": stubBinding(answersFile, "blueprint.{id}", path.join(scratch, "captured-case")) }),
  );
  const outputRoot = path.join(dir, "out");
  const result = (await runForResult(
    ["dev", "eval", "judge", "blueprint", caseFile, "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  )) as Result;
  verdicts.set("blueprint-clue-graph", {
    verdicts: result.verdicts.map((verdict) => ({
      id: verdict.id,
      tier: verdict.tier,
      status: verdict.status,
      details: verdict.details ?? null,
      findings: verdict.findings ?? null,
    })),
    summary: result.summary,
    run_error: result.run_error,
  });
  for (const id of CASE_JUDGES) prompts.set(`blueprint.${id}`, capturedPrompt(`blueprint.${id}`, "captured-case"));
}

async function runRuntimeHarness(answersFile: string) {
  // Two failing judges is a verdict (2); anything else means the run broke.
  verdicts.set("runtime", await runTurnCase(answersFile, "runtime", ["flesch", "age_appropriate_turn", ...GM_JUDGES], 2));
  for (const id of GM_JUDGES) prompts.set(`runtime.${id}`, capturedPrompt(`runtime.${id}`));
  prompts.set("runtime.age_appropriate", capturedPrompt("runtime.age_appropriate"));
}

/** A judge's verdict as the candidate snapshot records it: what it reached and from which findings. */
function candidateVerdict(verdict: Json) {
  return { id: verdict.id, status: verdict.status, findings: verdict.findings ?? null, details: verdict.details ?? null };
}

/**
 * The candidates, each named on its harness's command: the blueprint ones on
 * the blueprint the generator answers with, the game one on the trace and on
 * a turn. Their prompts are kept beside the battery's.
 */
async function runCandidates(answersFile: string) {
  const dir = path.join(scratch, "candidates");
  const blueprintFile = path.join(dir, "blueprint.json");
  const briefFile = path.join(dir, "brief.json");
  const traceFile = path.join(dir, "trace.json");
  const config = path.join(dir, "config.json");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(blueprintFile, JSON.stringify(validBlueprintV2));
  fs.writeFileSync(briefFile, JSON.stringify(generatorBrief));
  fs.writeFileSync(traceFile, JSON.stringify(makeRawTrace()));
  fs.writeFileSync(
    config,
    JSON.stringify({
      "blueprint-judge": stubBinding(answersFile, "blueprint.{id}"),
      "game-judge": stubBinding(answersFile, "trace.{id}"),
    }),
  );

  const blueprintOut = path.join(dir, "blueprint-out");
  const blueprint = (await runForResult(
    ["dev", "eval", "judge", "blueprint", blueprintFile, "--brief", briefFile, "--judges", BLUEPRINT_CANDIDATES.join(","),
      "--config", config, "--output-root", blueprintOut, "--quiet"],
    blueprintOut,
  )) as Result;
  const traceOut = path.join(dir, "trace-out");
  const trace = await runForResult(
    ["dev", "eval", "judge", "game", traceFile, "--judges", GM_CANDIDATES.join(","), "--config", config, "--output-root", traceOut, "--quiet"],
    traceOut,
  );
  const runtime = await runTurnCase(answersFile, "candidates-runtime", GM_CANDIDATES, 0);
  const judged = (result: Json) => result.verdicts.filter((verdict: Json) => verdict.tier === "judge").map(candidateVerdict);
  verdicts.set("candidates", { blueprint: judged(blueprint), trace: judged(trace), runtime: runtime.judges });
  for (const id of BLUEPRINT_CANDIDATES) prompts.set(`blueprint.${id}`, capturedPrompt(`blueprint.${id}`));
  for (const id of GM_CANDIDATES) {
    prompts.set(`trace.${id}`, capturedPrompt(`trace.${id}`));
    prompts.set(`runtime.${id}`, capturedPrompt(`runtime.${id}`));
  }
}

async function runPlaytestJudging(answersFile: string) {
  const gameDir = path.join(scratch, "playtest", "game-1");
  const config = path.join(scratch, "playtest", "config.json");
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, "trace.json"), JSON.stringify(makeRawTrace()));
  // The same trace the trace harness judges, so its prompts are not kept twice.
  fs.writeFileSync(config, JSON.stringify({ "game-judge": stubBinding(answersFile, "trace.{id}", "-") }));

  const { grades } = await gradeGame({
    root: REPO_ROOT,
    gameDir,
    targetAge: 9,
    judgeArgs: ["--config", config],
  });
  verdicts.set("playtest-judging", grades);
}

async function composeInvestigatorPrompts() {
  const record = path.join(scratch, "investigator-calls.jsonl");
  // The investigator's wrapper starts whatever CLAUDE_CLI_PATH names, as it does for the server's narrator.
  vi.stubEnv("CLAUDE_CLI_PATH", FAKE_CLAUDE);
  vi.stubEnv("FAKE_CLAUDE_RECORD", record);
  vi.stubEnv("FAKE_CLAUDE_BEHAVIOUR", "ok");
  vi.stubEnv("FAKE_CLAUDE_OUTPUT", JSON.stringify({ plan: "look around", input: "search" }));
  try {
    const view = buildView({
      title: "The Missing Cookies",
      state: {
        premise: "The cookie plate is empty and snack time is almost here.",
        mystery_summary: "The cookies disappeared from the kitchen sometime around 10 AM.",
        locations: [
          { id: "kitchen", name: "Kitchen", summary: "Where the cookies were set out." },
          { id: "hallway", name: "Hallway", summary: null },
        ],
        characters: [
          { id: "alice", first_name: "Alice", last_name: "Smith", location_id: "kitchen", sex: "female", summary: "Helped bake." },
          { id: "bob", first_name: "Bob", last_name: "Jones", location_id: "hallway", sex: "male", summary: null },
        ],
        discovered_clues: [
          {
            id: "loc-crumbs",
            text: "Cookie crumbs lead toward the hallway.",
            source: "search",
            origin: { kind: "location", location_id: "kitchen", location_name: "Kitchen" },
          },
        ],
        time_remaining: 7,
        location: "kitchen",
        mode: "explore",
        current_talk_character: null,
      } as unknown as GameState,
      transcript: [
        { kind: "narration", speaker: "Narrator", text: "You arrive in the kitchen." },
        { kind: "input", text: "search", plan: "look around" },
        { kind: "narration", speaker: "Narrator", text: "You find cookie crumbs on the floor." },
      ],
    });

    // The investigator's binding as the example config names it, so the call
    // goes through the same wrapper and runner as a real run.
    const example = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "evaluation", "config.example.json"), "utf8"));
    const binding = resolveBinding({ file: "config.example.json", bindings: { [INVESTIGATOR_BINDING]: example[INVESTIGATOR_BINDING] } }, INVESTIGATOR_BINDING, { root: REPO_ROOT });
    for (const persona of PERSONAS) {
      const investigator = modelInvestigator({ persona, binding, logDir: path.join(scratch, "investigator-logs", persona) });
      await investigator.next(view);
    }
    const calls = fs
      .readFileSync(record, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { args: string[]; stdin: string });
    expect(calls).toHaveLength(PERSONAS.length);

    calls.forEach((call, index) => {
      const flag = call.args.indexOf("--system-prompt");
      const system = call.args[flag + 1];
      const args = call.args.map((arg, position) => (position === flag + 1 ? "<system prompt>" : arg));
      prompts.set(`investigator.${PERSONAS[index]}`, { system, user: call.stdin, args });
    });
  } finally {
    vi.unstubAllEnvs();
  }
}

beforeAll(async () => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-snapshots-"));
  const answersFile = path.join(scratch, "answers.json");
  // The generator "answers" with a blueprint, the same fixture the runtime case judges.
  fs.writeFileSync(answersFile, JSON.stringify({ ...ANSWERS, generator: validBlueprintV2, "generator.repair": validBlueprintV2 }));

  await Promise.all([
    runBlueprintPipeline(answersFile),
    runRepairRound(answersFile),
    runTraceHarness(answersFile),
    runRuntimeHarness(answersFile),
    runPlaytestJudging(answersFile),
    runCandidates(answersFile),
    runClueGraphHarnesses(answersFile),
    runClueGraphBlueprint(answersFile),
  ]);
  await composeInvestigatorPrompts();
  clearForRecording();
}, 180_000);

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

/** A stored verdict set holds no path of this run's scratch folder. */
function withoutScratch(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  const roots = new Set([scratch, fs.realpathSync(scratch)]);
  return [...roots].reduce((acc, root) => acc.split(root).join("<scratch>"), text);
}

describe("evaluation prompt snapshots", () => {
  it.each(PROMPT_IDS)("%s is sent the stored prompt", (id) => {
    const parts = prompts.get(id);
    if (!parts) throw new Error(`${id} was not composed`);
    for (const [file, content] of Object.entries(promptFiles(id, parts))) expectStored(file, content);
  });

  it("sends the investigator the arguments the claude CLI is called with", () => {
    const { args } = prompts.get(`investigator.${PERSONAS[0]}`) ?? {};
    expect(args).toEqual(expect.arrayContaining(["--print", "--output-format", "json", "--json-schema"]));
  });
});

describe("evaluation verdict snapshots", () => {
  it.each(VERDICT_NAMES)("%s reaches the stored verdicts on stub bindings", (name) => {
    const verdict = verdicts.get(name);
    if (verdict === undefined) throw new Error(`${name} reached no verdicts`);
    expectStored(verdictFile(name), `${withoutScratch(verdict)}\n`);
  });
});

// Last, so that while recording it sees every file the others wrote.
describe("evaluation snapshot files", () => {
  it("has one for every prompt and verdict set, and none left over", () => {
    const expected = [
      ...PROMPT_IDS.flatMap((id) => Object.keys(promptFiles(id, prompts.get(id) ?? { system: "", user: "" }))),
      ...VERDICT_NAMES.map(verdictFile),
    ].sort();
    expect(storedFiles()).toEqual(expected);
  });
});
