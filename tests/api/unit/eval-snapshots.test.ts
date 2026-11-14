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

import type { Result } from "../../../evaluation/core/result.ts";
import { gradeGame } from "../../../evaluation/playtest/lib/judge.mjs";
import { listPersonas, modelInvestigator } from "../../../evaluation/playtest/lib/investigator.mjs";
import { buildView } from "../../../evaluation/playtest/lib/view.mjs";
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
import { makeRawTrace } from "./trace-fixtures.ts";

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
const GM_JUDGES = ["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"];
const PERSONAS = listPersonas() as string[];

const PROMPT_IDS = [
  ...BLUEPRINT_DIMENSIONS.map((id) => `blueprint.${id}`),
  "generator",
  ...GM_JUDGES.map((id) => `trace.${id}`),
  ...GM_JUDGES.map((id) => `runtime.${id}`),
  "runtime.age_appropriate",
  ...PERSONAS.map((persona) => `investigator.${persona}`),
];
const VERDICT_NAMES = ["blueprint", "trace", "runtime", "playtest-judging"];

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

function capturedPrompt(key: string): PromptParts {
  const dir = path.join(scratch, "captured");
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
    ["dev", "eval", "generate", briefFile, "--judge", "--config", config, "--output-root", outputRoot, "--quiet"],
    outputRoot,
  )) as Result;
  verdicts.set("blueprint", blueprintVerdicts(result));
  prompts.set("generator", capturedPrompt("generator"));
  for (const id of BLUEPRINT_DIMENSIONS) prompts.set(`blueprint.${id}`, capturedPrompt(`blueprint.${id}`));
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

async function runRuntimeHarness(answersFile: string) {
  const dir = path.join(scratch, "runtime");
  fs.mkdirSync(dir, { recursive: true });
  const blueprintFile = path.join(dir, "blueprint.json");
  fs.writeFileSync(blueprintFile, JSON.stringify(validBlueprintV2));

  const judgeConfig = Object.fromEntries([
    ["age_appropriate", { cliConfig: stubBinding(answersFile, "runtime.age_appropriate") }],
    ...GM_JUDGES.map((id) => [id, { cliConfig: stubBinding(answersFile, "runtime.{id}") }]),
  ]);
  const testCase = {
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
    judges: ["flesch", "age_appropriate", ...GM_JUDGES],
    judgeConfig,
  };
  const caseFile = path.join(dir, "case.mjs");
  fs.writeFileSync(caseFile, `export default ${JSON.stringify(testCase)};\n`);

  const outputRoot = path.join(dir, "out");
  const result = await runForResult(
    ["evaluation/runtime/run.mjs", caseFile, "--backend", "cli:stub", "--out", outputRoot],
    outputRoot,
  );
  const [interactionFile] = findFiles(outputRoot, "interaction.json");
  const interaction = JSON.parse(fs.readFileSync(interactionFile, "utf8"));
  verdicts.set("runtime", {
    case_id: result.case_id,
    backend: result.backend,
    model: result.model,
    narration: interaction.response.narration_text,
    judges: result.judges.map((judge: Json) => ({
      ...judge,
      details: {
        ...judge.details,
        attempts: judge.details?.attempts?.map((attempt: Json) => attempt.outcome),
      },
    })),
    summary: result.summary,
  });
  for (const id of GM_JUDGES) prompts.set(`runtime.${id}`, capturedPrompt(`runtime.${id}`));
  prompts.set("runtime.age_appropriate", capturedPrompt("runtime.age_appropriate"));
}

async function runPlaytestJudging(answersFile: string) {
  const gameDir = path.join(scratch, "playtest", "game-1");
  const config = path.join(scratch, "playtest", "config.json");
  fs.mkdirSync(gameDir, { recursive: true });
  fs.writeFileSync(path.join(gameDir, "trace.json"), JSON.stringify(makeRawTrace()));
  // The same trace the trace harness judges, so its prompts are not kept twice.
  fs.writeFileSync(config, JSON.stringify({ "game-judge": stubBinding(answersFile, "trace.{id}", "-") }));

  const grades = await gradeGame({
    repoRoot: REPO_ROOT,
    gameDir,
    targetAge: 9,
    judgeTraceArgs: ["--config", config],
  });
  verdicts.set("playtest-judging", grades);
}

async function composeInvestigatorPrompts() {
  const record = path.join(scratch, "investigator-calls.jsonl");
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
      },
      transcript: [
        { kind: "narration", speaker: "Narrator", text: "You arrive in the kitchen." },
        { kind: "input", text: "search", plan: "look around" },
        { kind: "narration", speaker: "Narrator", text: "You find cookie crumbs on the floor." },
      ],
    });

    for (const persona of PERSONAS) {
      const investigator = modelInvestigator({ persona, model: "sonnet", binary: FAKE_CLAUDE });
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
  fs.writeFileSync(answersFile, JSON.stringify({ ...ANSWERS, generator: validBlueprintV2 }));

  await Promise.all([
    runBlueprintPipeline(answersFile),
    runTraceHarness(answersFile),
    runRuntimeHarness(answersFile),
    runPlaytestJudging(answersFile),
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
