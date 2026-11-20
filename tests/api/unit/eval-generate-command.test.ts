// `./dev eval generate`, run in-process on stub bindings: briefs go through the
// real command, runner, registry and result schema, and the generator and the
// judges are eval-snapshot-stub.mjs answering from a table. No model is called,
// and `--install` only ever writes into a temporary config root.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { parseBackends, parseRepair, passedMechanicalChecks } from "../../../evaluation/generate/commands.ts";
import { REPORTS_NOTICE } from "../../../evaluation/generate/repair.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";
import { generatorBrief } from "./fixtures/generator-brief.ts";
import { expectStored, promptFiles } from "./eval-snapshot-store.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "eval-snapshot-stub.mjs");
const JUDGE_ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const DIMENSIONS = [
  "solve_depth",
  "fairness",
  "timeline_coherence",
  "knowledge_coherence",
  "character_grounding",
  "path_payoff",
  "clue_graph",
  "age_appropriate",
];
const KEY = "sk-or-test-key-0123456789";
/** A brief the blueprint fixture satisfies, so its mechanical checks pass. */
const passingBrief = { ...generatorBrief, witnesses: 0 };

let dir = "";
let out: string[] = [];
let err: string[] = [];

function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

function stubBinding(answersFile: string, key: string, capture: string | "-" = "-", extra: Record<string, unknown> = {}) {
  return {
    cmd: process.execPath,
    args: [STUB, capture, answersFile, key, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    timeout_ms: 60_000,
    retries: 0,
    ...extra,
  };
}

interface ConfigOptions {
  /** What each generator backend answers; the key is `generator-agent` or `generator-api`. */
  answers: Record<string, unknown>;
  capture?: string;
  apiModel?: string | null;
  retries?: number;
}

/** A config binding both generators and the judge to the stub. */
function stubConfig({ answers, capture = "-", apiModel = "stub/model", retries = 0 }: ConfigOptions): string {
  const judges = Object.fromEntries(DIMENSIONS.map((id) => [`blueprint.${id}`, { ...JUDGE_ANSWERS[`blueprint.${id}`], verdict: "pass" }]));
  const answersFile = write("answers.json", { ...judges, ...answers });
  return write("config.json", {
    "generator-agent": stubBinding(answersFile, "generator-agent", capture, { model: "agent-model", retries }),
    "generator-api": stubBinding(answersFile, "generator-api", capture, { model: apiModel, retries }),
    "blueprint-judge": stubBinding(answersFile, "blueprint.{id}"),
  });
}

async function generate(argv: string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
  return runEval(["generate", ...argv], { root: process.cwd(), out: (t) => out.push(t), err: (t) => err.push(t), env }, COMMANDS);
}

function resultFiles(): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "result.json") found.push(full);
    }
  };
  if (fs.existsSync(path.join(dir, "out"))) walk(path.join(dir, "out"));
  return found.sort();
}

async function results(): Promise<Result[]> {
  return Promise.all(resultFiles().map((file) => readResult(file)));
}

function argv(extra: string[], brief = path.join(dir, "brief.json")): string[] {
  return [brief, "--output-root", path.join(dir, "out"), "--quiet", ...extra];
}

function everyFileUnder(folder: string): string[] {
  return fs.readdirSync(folder, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => path.join(entry.parentPath, entry.name));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-generate-"));
  out = [];
  err = [];
  write("brief.json", passingBrief);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generate", () => {
  it("makes one subject per brief with the agent backend and records the attempt as production", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    write("second/input.brief.json", { ...passingBrief, titleHint: "Another" });
    expect(await generate(argv(["--config", config], path.join(dir, "brief.json")).concat(path.join(dir, "second")))).toBe(0);

    const found = await results();
    expect(found).toHaveLength(2);
    expect(found.map((result) => result.subject.id).sort()).toEqual(["brief-agent-agent-model", "second-agent-agent-model"]);
    for (const result of found) {
      expect(result.subject).toMatchObject({ kind: "blueprint", path: "blueprint.json" });
      expect(result.run_error).toBeNull();
      expect(result.summary.passed).toBe(true);
      expect(result.production?.calls).toHaveLength(1);
      expect(result.production?.calls[0]).toMatchObject({ binding: "generator-agent", model: "agent-model" });
      expect(result.production?.calls[0].attempts.map((attempt) => attempt.outcome)).toEqual(["ok"]);
      expect(result.verdicts.every((verdict) => verdict.tier === "mechanical")).toBe(true);
    }
    expect(Object.keys(found[0].run.bindings)).toEqual(["generator-agent"]);
    expect(found[0].run.command).toBe("generate");
  });

  it("makes a subject per brief, backend and model in one run, and the same prompt reaches both backends", async () => {
    const capture = path.join(dir, "captured");
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2, "generator-api": validBlueprintV2 }, capture });
    // The snapshot brief asks for a witness the fixture lacks, so its blueprints fail that one check.
    write("brief.json", generatorBrief);
    const code = await generate(argv(["--config", config, "--backend", "agent", "--backend", "api", "--model", "m/one", "--model", "m/two"]), { OPENROUTER_API_KEY: KEY });
    expect(code).toBe(2);

    const found = await results();
    expect(found.map((result) => result.subject.id).sort()).toEqual(["brief-agent-m-one", "brief-agent-m-two", "brief-api-m-one", "brief-api-m-two"]);
    const models = found.map((result) => `${result.production?.calls[0].binding}:${result.production?.calls[0].model}`).sort();
    expect(models).toEqual(["generator-agent:m/one", "generator-agent:m/two", "generator-api:m/one", "generator-api:m/two"]);
    const hashes = new Set(found.map((result) => result.production?.calls[0].prompt_sha256));
    expect(hashes.size).toBe(1);
    // The binding is recorded once per name; two models leave its model open.
    expect(found[0].run.bindings["generator-api"].model).toBeNull();

    for (const key of ["generator-agent", "generator-api"]) {
      const parts = {
        system: fs.readFileSync(path.join(capture, `${key}.system.txt`), "utf8"),
        user: fs.readFileSync(path.join(capture, `${key}.user.txt`), "utf8"),
      };
      for (const [file, content] of Object.entries(promptFiles("generator", parts))) expectStored(file, content);
    }
  });

  it("records the model a single-model run used on the binding", async () => {
    const config = stubConfig({ answers: { "generator-api": validBlueprintV2 } });
    expect(await generate(argv(["--config", config, "--backend", "api", "--model", "only/one"]), { OPENROUTER_API_KEY: KEY })).toBe(0);
    const [result] = await results();
    expect(result.run.bindings["generator-api"].model).toBe("only/one");
  });

  it("judges each blueprint straight after with --judge", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    expect(await generate(argv(["--config", config, "--judge"]))).toBe(2);
    const [result] = await results();
    expect(result.verdicts.filter((verdict) => verdict.tier === "judge").map((verdict) => verdict.id)).toEqual(DIMENSIONS);
    expect(Object.keys(result.run.bindings).sort()).toEqual(["blueprint-judge", "generator-agent"]);
    expect(result.production).not.toBeNull();
  });

  it("exits 2 and keeps a blueprint that fails the schema, and does not install it", async () => {
    const config = stubConfig({ answers: { "generator-agent": { title: "not a blueprint" } } });
    const library = path.join(dir, "root", "blueprints");
    const code = await generate(argv(["--config", config, "--install"]), { MYSTERY_CONFIG_ROOT: path.join(dir, "root") });
    expect(code).toBe(2);

    const [result] = await results();
    expect(result.run_error).toBeNull();
    expect(result.subject.path).toBe("blueprint.json");
    expect(result.verdicts.find((verdict) => verdict.id === "blueprint_schema_valid")?.status).toBe("fail");
    expect(result.production?.calls[0].attempts.map((attempt) => attempt.outcome)).toEqual(["invalid"]);
    expect(passedMechanicalChecks(result)).toBe(false);
    expect(fs.existsSync(library)).toBe(false);
    expect(out.join("\n")).toContain("not installed: brief-agent-agent-model did not pass its mechanical checks");
  });

  it("exits 2 and does not install a blueprint that fails a mechanical check", async () => {
    write("brief.json", { ...passingBrief, culprits: 2 });
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    const root = path.join(dir, "root");
    expect(await generate(argv(["--config", config, "--install"]), { MYSTERY_CONFIG_ROOT: root })).toBe(2);
    const [result] = await results();
    expect(result.verdicts.find((verdict) => verdict.id === "culprit_count_matches_brief")?.status).toBe("fail");
    expect(fs.existsSync(path.join(root, "blueprints"))).toBe(false);
  });

  it("installs a blueprint that passes into the library, and will not replace one already there", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    const root = path.join(dir, "root");
    expect(await generate(argv(["--config", config, "--install"]), { MYSTERY_CONFIG_ROOT: root })).toBe(0);

    const installed = path.join(root, "blueprints", "brief-agent-agent-model.json");
    expect(JSON.parse(fs.readFileSync(installed, "utf8"))).toEqual(validBlueprintV2);
    expect(out.join("\n")).toContain(`installed: ${installed}`);

    fs.writeFileSync(installed, "{}");
    out = [];
    expect(await generate(argv(["--config", config, "--install"]), { MYSTERY_CONFIG_ROOT: root })).toBe(1);
    expect(fs.readFileSync(installed, "utf8")).toBe("{}");
    expect(out.join("\n")).toContain("already exists");
  });

  it("installs the same brief given twice under two names", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    const root = path.join(dir, "root");
    const brief = path.join(dir, "brief.json");
    expect(await generate([brief, brief, "--output-root", path.join(dir, "out"), "--quiet", "--config", config, "--install"], { MYSTERY_CONFIG_ROOT: root })).toBe(0);
    expect(fs.readdirSync(path.join(root, "blueprints")).sort()).toEqual(["brief-agent-agent-model-2.json", "brief-agent-agent-model.json"]);
  });

  it("does not touch the library without --install", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    const root = path.join(dir, "root");
    expect(await generate(argv(["--config", config]), { MYSTERY_CONFIG_ROOT: root })).toBe(0);
    expect(fs.existsSync(root)).toBe(false);
  });

  it("breaks the run (exit 1) when the generator gives nothing to keep, recording every attempt as production", async () => {
    const config = stubConfig({ answers: {}, retries: 1 });
    expect(await generate(argv(["--config", config]))).toBe(1);
    const [result] = await results();
    expect(result.run_error?.stage).toBe("generate");
    expect(result.subject.path).toBeNull();
    expect(result.production?.calls).toHaveLength(1);
    expect(result.production?.calls[0].attempts.map((attempt) => attempt.outcome)).toEqual(["exit", "exit"]);
    expect(Object.keys(result.run.bindings)).toEqual(["generator-agent"]);
  });

  it("retries an answer that fails the schema and keeps the one that passes", async () => {
    const answersFile = write("flaky-answers.json", { flaky: validBlueprintV2 });
    const counter = path.join(dir, "attempts");
    const flaky = write(
      "flaky.mjs",
      `import fs from "node:fs";
       const n = fs.existsSync(${JSON.stringify(counter)}) ? 2 : 1;
       fs.writeFileSync(${JSON.stringify(counter)}, String(n));
       process.stdout.write(JSON.stringify({ result: JSON.stringify(n === 1 ? { title: "first try" } : JSON.parse(fs.readFileSync(${JSON.stringify(answersFile)}, "utf8")).flaky) }));`,
    );
    const config = write("flaky-config.json", {
      "generator-agent": { cmd: process.execPath, args: [flaky], extract_path: "result", model: "m", timeout_ms: 60_000, retries: 1 },
    });
    expect(await generate(argv(["--config", config]))).toBe(0);
    const [result] = await results();
    expect(result.production?.calls[0].attempts.map((attempt) => attempt.outcome)).toEqual(["invalid", "ok"]);
    expect(result.summary.passed).toBe(true);
  });

  it("generates several blueprints at once with --parallelism", async () => {
    const config = stubConfig({ answers: { "generator-agent": validBlueprintV2 } });
    expect(await generate(argv(["--config", config, "--model", "a", "--model", "b", "--model", "c", "--parallelism", "3"]))).toBe(0);
    expect(await results()).toHaveLength(3);
  });

  it("never writes the OpenRouter key into the run folder or the output", async () => {
    const config = stubConfig({ answers: { "generator-api": validBlueprintV2 } });
    expect(await generate(argv(["--config", config, "--backend", "api"]), { OPENROUTER_API_KEY: KEY })).toBe(0);
    const files = everyFileUnder(path.join(dir, "out"));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(fs.readFileSync(file, "utf8")).not.toContain(KEY);
    expect(out.join("\n") + err.join("\n")).not.toContain(KEY);
    const invocation = files.find((file) => file.endsWith(".invocation.json")) as string;
    expect(JSON.parse(fs.readFileSync(invocation, "utf8")).env_added).toContain("OPENROUTER_API_KEY");
  });

  it("reads the key from .env.local in the config root when the environment has none", async () => {
    const config = stubConfig({ answers: { "generator-api": validBlueprintV2 } });
    const root = path.join(dir, "root");
    write("root/.env.local", `OPENROUTER_API_KEY=${KEY}\n`);
    expect(await generate(argv(["--config", config, "--backend", "api"]), { MYSTERY_CONFIG_ROOT: root })).toBe(0);
  });
});

describe("generate --repair", () => {
  // The fixture reads above an 8-year-old's grade, so a battery that passes it is one for 14-year-olds.
  const green = { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, target_age: 14 } };
  const greenBrief = { ...passingBrief, targetAge: 14 };
  beforeEach(() => {
    write("brief.json", greenBrief);
  });

  /**
   * A generator that answers a generation with `first` and a repair round with
   * `repaired` (or exits 1 when it is undefined), and keeps every repair
   * message it is sent in `repairs/<round>.json`.
   */
  function repairingConfig(first: unknown, repaired: unknown, judges: Record<string, unknown> = {}): string {
    const answers = write("repair-answers.json", { first, repaired: repaired ?? null });
    const repairs = path.join(dir, "repairs");
    const generator = write(
      "repairing.mjs",
      `import fs from "node:fs";
       import path from "node:path";
       const message = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
       const answers = JSON.parse(fs.readFileSync(${JSON.stringify(answers)}, "utf8"));
       if (message.repair) {
         fs.mkdirSync(${JSON.stringify(repairs)}, { recursive: true });
         fs.writeFileSync(path.join(${JSON.stringify(repairs)}, message.repair.round + ".json"), JSON.stringify(message));
         if (answers.repaired === null) process.exit(1);
       }
       const cost = message.repair ? 0.5 : 1.25;
       const answer = message.repair ? answers.repaired : answers.first;
       process.stdout.write(JSON.stringify({ total_cost_usd: cost, result: answer === "not json" ? answer : JSON.stringify(answer) }));`,
    );
    const passing = Object.fromEntries(DIMENSIONS.map((id) => [`blueprint.${id}`, { ...JUDGE_ANSWERS[`blueprint.${id}`], verdict: "pass" }]));
    const judgeAnswers = write("judge-answers.json", { ...passing, ...judges });
    return write("repair-config.json", {
      "generator-agent": { cmd: process.execPath, args: [generator, "{{system_prompt_file}}", "{{user_message_file}}"], extract_path: "result", model: "agent-model", timeout_ms: 60_000, retries: 0 },
      "blueprint-judge": stubBinding(judgeAnswers, "blueprint.{id}"),
    });
  }

  function repairMessage(round: number): { story_brief: unknown; repair: { round: number; blueprint: unknown; notice: string; reports: Array<Record<string, unknown>> } } {
    return JSON.parse(fs.readFileSync(path.join(dir, "repairs", `${round}.json`), "utf8"));
  }

  it("repairs a failing blueprint to green, keeping round 0, and installs only the final blueprint", async () => {
    const broken = { title: "not a blueprint" };
    const config = repairingConfig(broken, green);
    const root = path.join(dir, "root");
    expect(await generate(argv(["--config", config, "--judge", "--repair", "2", "--install"]), { MYSTERY_CONFIG_ROOT: root })).toBe(0);

    const [result] = await results();
    expect(result.rounds?.map((round) => round.round)).toEqual([0, 1]);
    const [first, final] = result.rounds ?? [];
    expect(first.path).toBe("blueprint.json");
    expect(first.summary.passed).toBe(false);
    expect(first.verdicts.find((verdict) => verdict.id === "blueprint_schema_valid")?.status).toBe("fail");
    expect(final.path).toBe(path.join("rounds", "1", "blueprint.json"));
    expect(final.summary.passed).toBe(true);
    expect(result.subject.path).toBe(final.path);
    expect(result.verdicts).toEqual(final.verdicts);
    expect(result.summary.passed).toBe(true);
    expect(result.production?.calls.map((call) => call.binding)).toEqual(["generator-agent", "generator-agent"]);
    expect(first.cost_usd).toBe(1.25);
    expect(final.cost_usd).toBe(0.5);
    expect(final.timing?.stages.map((stage) => stage.name)).toEqual(expect.arrayContaining(["repair", "mechanical", "dimensions"]));

    // Round 0 stays where it was; the repaired blueprint and its brief sit in its round's folder.
    const subjectDir = path.dirname(resultFiles()[0]);
    expect(JSON.parse(fs.readFileSync(path.join(subjectDir, "blueprint.json"), "utf8"))).toEqual(broken);
    expect(JSON.parse(fs.readFileSync(path.join(subjectDir, "rounds", "1", "blueprint.json"), "utf8"))).toEqual(green);
    expect(JSON.parse(fs.readFileSync(path.join(subjectDir, "rounds", "1", "brief.json"), "utf8"))).toEqual(greenBrief);

    // The generator was sent its blueprint and the failing check, as quoted data.
    const message = repairMessage(1);
    expect(message.story_brief).toEqual(greenBrief);
    expect(message.repair.blueprint).toEqual(broken);
    expect(message.repair.notice).toBe(REPORTS_NOTICE);
    expect(message.repair.reports.map((report) => report.id)).toContain("blueprint_schema_valid");
    expect(message.repair.reports.every((report) => report.tier === "mechanical")).toBe(true);

    expect(JSON.parse(fs.readFileSync(path.join(root, "blueprints", "brief-agent-agent-model.json"), "utf8"))).toEqual(green);
    const printed = out.join("\n");
    expect(printed).toContain("[eval] first pass: failed (");
    expect(printed).toContain("final: passed after 1 repair round(s)");
    expect(printed).toContain("[eval] cost: round 0 $1.25, round 1 $0.50; total $1.75");
    expect(printed).toContain("[eval] run cost: $1.75");
  });

  it("stops after n rounds when a judge keeps failing, sends the judge's reasoning, and installs nothing", async () => {
    const failing = { issues: [{ subject: "alice", description: "Alice is in two places at four." }], verdict: "fail", reasoning: "The timeline breaks at four." };
    const config = repairingConfig(green, green, { "blueprint.timeline_coherence": failing });
    const root = path.join(dir, "root");
    expect(await generate(argv(["--config", config, "--judge", "--repair", "2", "--install"]), { MYSTERY_CONFIG_ROOT: root })).toBe(2);

    const [result] = await results();
    expect(result.rounds?.map((round) => round.summary.passed)).toEqual([false, false, false]);
    expect(result.subject.path).toBe(path.join("rounds", "2", "blueprint.json"));
    const report = repairMessage(2).repair.reports.find((each) => each.id === "timeline_coherence");
    expect(report).toEqual({ id: "timeline_coherence", tier: "judge", answer: failing });
    expect(fs.existsSync(path.join(root, "blueprints"))).toBe(false);
    expect(out.join("\n")).toContain("final blueprint did not pass every check and judge");
  });

  it("breaks the run when a repair call gives nothing to keep, keeping the rounds before it", async () => {
    const config = repairingConfig({ title: "not a blueprint" }, undefined);
    expect(await generate(argv(["--config", config, "--judge", "--repair", "1"]))).toBe(1);
    const [result] = await results();
    expect(result.run_error?.stage).toBe("repair_round_1");
    expect(result.rounds).toHaveLength(1);
    expect(result.subject.path).toBe("blueprint.json");
    expect(result.production?.calls).toHaveLength(2);
    expect(result.production?.calls[1].attempts.map((attempt) => attempt.outcome)).toEqual(["exit"]);
    expect(out.join("\n")).toContain("final: broke during a repair round");
  });

  it("still prints what a broken repair round cost", async () => {
    const config = repairingConfig({ title: "not a blueprint" }, "not json");
    expect(await generate(argv(["--config", config, "--judge", "--repair", "1"]))).toBe(1);
    const [result] = await results();
    expect(result.production?.calls[1].cost_usd).toBe(0.5);
    const printed = out.join("\n");
    expect(printed).toContain("[eval] cost: round 0 $1.25, round 1 (broke) $0.50; total $1.75");
    expect(printed).toContain("[eval] run cost: $1.75");
  });

  it("runs no repair round on a blueprint that passes", async () => {
    const config = repairingConfig(green, undefined);
    expect(await generate(argv(["--config", config, "--judge", "--repair", "3"]))).toBe(0);
    const [result] = await results();
    expect(result.rounds).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, "repairs"))).toBe(false);
    expect(out.join("\n")).toContain("final: passed after 0 repair round(s)");
  });

  it("records no rounds with --repair 0", async () => {
    const config = repairingConfig({ title: "not a blueprint" }, green);
    expect(await generate(argv(["--config", config, "--judge", "--repair", "0"]))).toBe(2);
    const [result] = await results();
    expect(result.rounds).toBeUndefined();
    expect(out.join("\n")).not.toContain("run cost");
  });
});

describe("parseRepair", () => {
  it("defaults to 0 and needs --judge and the agent backend for more", () => {
    expect(parseRepair(undefined, false, ["api"])).toBe(0);
    expect(parseRepair("0", false, ["api"])).toBe(0);
    expect(parseRepair("2", true, ["agent"])).toBe(2);
    expect(() => parseRepair("1", false, ["agent"])).toThrow("--repair needs --judge");
    expect(() => parseRepair("1", true, ["agent", "api"])).toThrow("--repair works only with the agent backend");
    expect(() => parseRepair("-1", true, ["agent"])).toThrow("--repair needs a whole number");
    expect(() => parseRepair("one", true, ["agent"])).toThrow("--repair needs a whole number");
  });
});

describe("generate, before it starts", () => {
  async function refused(extra: string[], env: NodeJS.ProcessEnv = {}, config = stubConfig({ answers: {} })) {
    expect(await generate(argv(["--config", config, ...extra]), env)).toBe(1);
    expect(fs.existsSync(path.join(dir, "out"))).toBe(false);
    return err.join("\n");
  }

  it("stops when the api backend has no key", async () => {
    expect(await refused(["--backend", "api"], { MYSTERY_CONFIG_ROOT: path.join(dir, "empty") })).toContain("OPENROUTER_API_KEY");
  });

  it("stops when the api backend has no model", async () => {
    const config = stubConfig({ answers: {}, apiModel: null });
    expect(await refused(["--backend", "api"], { OPENROUTER_API_KEY: KEY }, config)).toContain('binding "generator-api" has no model');
  });

  it("ignores an exported AI_MODEL and AI_PROVIDER when the api backend has no model", async () => {
    const config = stubConfig({ answers: {}, apiModel: null });
    const env = { OPENROUTER_API_KEY: KEY, AI_MODEL: "vendor/exported", AI_PROVIDER: "openrouter" };
    expect(await refused(["--backend", "api"], env, config)).toContain('binding "generator-api" has no model');
  });

  it("uses --model, not an exported AI_MODEL", async () => {
    const config = stubConfig({ answers: { "generator-api": validBlueprintV2 }, apiModel: null });
    expect(await generate(argv(["--config", config, "--backend", "api", "--model", "flag/model"]), { OPENROUTER_API_KEY: KEY, AI_MODEL: "vendor/exported" })).toBe(0);
    const [result] = await results();
    expect(result.production?.calls[0].model).toBe("flag/model");
  });

  it("takes the api model from --model-override", async () => {
    const config = stubConfig({ answers: { "generator-api": validBlueprintV2 }, apiModel: null });
    expect(await generate(argv(["--config", config, "--backend", "api", "--model-override", "generator-api=via/override"]), { OPENROUTER_API_KEY: KEY })).toBe(0);
    const [result] = await results();
    expect(result.production?.calls[0].model).toBe("via/override");
  });

  it("stops on an unknown backend", async () => {
    expect(await refused(["--backend", "chat"])).toContain("--backend must be one of agent, api");
  });

  it("stops on --repair with the api backend, before any generation", async () => {
    expect(await refused(["--backend", "api", "--judge", "--repair", "1"], { OPENROUTER_API_KEY: KEY })).toContain("--repair works only with the agent backend");
  });

  it("stops on a bad --parallelism", async () => {
    expect(await refused(["--parallelism", "0"])).toContain("--parallelism needs a positive whole number");
  });

  it("stops when a binding is missing from the config, naming it", async () => {
    const config = write("only-judge.json", { "blueprint-judge": stubBinding(write("a.json", {}), "x") });
    expect(await refused([], {}, config)).toContain('has no binding "generator-agent"');
  });

  it("stops when the judge binding cannot run, before any generation", async () => {
    const config = write("broken.json", {
      "generator-agent": stubBinding(write("a.json", {}), "x"),
      "blueprint-judge": { cmd: "no-such-wrapper-xyz", args: [], timeout_ms: 1000 },
    });
    expect(await refused(["--judge"], {}, config)).toContain("cannot run");
  });

  it("stops on a brief that is not a story brief, saying what is wrong", async () => {
    write("brief.json", { brief: "", targetAge: "old" });
    expect(await refused([])).toContain("is not a story brief");
  });

  it("stops on a brief that is not there", async () => {
    expect(await generate(argv(["--config", stubConfig({ answers: {} })], path.join(dir, "missing.json")))).toBe(1);
    expect(err.join("\n")).toContain("brief path not found");
  });

  it("needs at least one brief, and prints its help", async () => {
    expect(await generate(["--quiet"])).toBe(1);
    expect(err.join("\n")).toContain("expected at least 1 argument");
    out = [];
    expect(await generate(["--help"])).toBe(0);
    expect(out.join("\n")).toContain("--backend <agent|api>");
    expect(out.join("\n")).toContain("--install");
  });
});

describe("parseBackends", () => {
  it("defaults to the agent and drops repeats", () => {
    expect(parseBackends(undefined)).toEqual(["agent"]);
    expect(parseBackends(["api", "agent", "api"])).toEqual(["api", "agent"]);
  });
});
