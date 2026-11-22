/**
 * `./dev generate <brief>...`: briefs in, blueprints out, in one run with
 * one subject per brief, backend and model.
 *
 * `--format` picks what is written: a clue-graph case (the default) or a
 * Blueprint V2. A clue-graph case is written only by the agent backend, in a
 * clue-graph workspace, and checked by the case validator; it may be repaired
 * from the validator's faults alone, and is installed into the library's
 * `clue-graph/` only when its final round passed every check and judge it ran.
 * What follows describes Blueprint V2, which works as it always has.
 *
 * `--backend agent` runs the Claude agent in its workspace (the `generator-agent`
 * binding); `--backend api` makes one OpenRouter call (`generator-api`). Both
 * are model calls through the core runner, sent the prompt that
 * `buildBlueprintGenerationChatInput` builds, and both land in the same place:
 * the answer is checked against the Blueprint V2 schema, stored beside its
 * `result.json`, and put through the mechanical checks. A blueprint that fails
 * the schema after every attempt is kept and fails its mechanical check, so the
 * run exits 2; only a call that gave nothing to keep breaks the run. `--judge`
 * judges each blueprint straight after, as `judge blueprint` does, and
 * `--repair <n>` then runs up to `n` repair rounds on a blueprint that failed
 * (`repair.ts`; agent backend only). `--install` copies each blueprint that
 * passed its mechanical checks into the game's library and leaves the others
 * where they are; after repair rounds, only a final blueprint that passed
 * everything.
 */

import fs from "node:fs/promises";
import path from "node:path";

import {
  buildBlueprintGenerationChatInput,
  buildClueGraphGenerationChatInput,
  ClueGraphBriefSchema,
  StoryBriefSchema,
} from "../../packages/blueprint-generator/src/index.ts";
import type { ClueGraphBrief, StoryBrief } from "../../packages/blueprint-generator/src/index.ts";
import { getBlueprintsDir } from "../../scripts/local-config.mjs";
import { judgeBindingFor, summaryLines } from "../blueprint/commands.ts";
import { readJsonFile, resolveBrief } from "../blueprint/inputs.ts";
import { judgeBlueprintSubject, runErrorOf, validateBlueprintSubject, writeBlueprintResult } from "../blueprint/subject.ts";
import type { BlueprintSubject } from "../blueprint/subject.ts";
import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import type { BlueprintFormat } from "../core/registry.ts";
import { ConfigError, InputError, UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { createRunFolder, resolveOutputRoot, slugify } from "../core/run-folder.ts";
import type { RunFolder } from "../core/run-folder.ts";
import type { Result } from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { createRunTimer } from "../core/timing.ts";
import { blueprintParser, caseParser } from "./blueprint-answer.ts";
import { OPENROUTER_KEY_VAR, readOpenRouterKey } from "./openrouter.ts";
import { repairLoop, roundLines, runCostLine } from "./repair.ts";

export const FORMATS = ["clue-graph", "v2"] as const;
export type Format = (typeof FORMATS)[number];

/** How the checks and judges name each format. */
const BLUEPRINT_FORMAT: Record<Format, BlueprintFormat> = { "clue-graph": "clue_graph", v2: "v2" };

/** A clue-graph case's repair rounds when `--repair` is not given, and the most it may ask for. */
export const CLUE_GRAPH_REPAIR = { default: 2, max: 5 } as const;

export const BACKENDS = ["agent", "api"] as const;
export type Backend = (typeof BACKENDS)[number];

/** The binding each backend runs through. */
export const GENERATOR_BINDINGS: Record<Backend, string> = { agent: "generator-agent", api: "generator-api" };

const HELP = formatHelp({
  usage: "generate <brief>...",
  summary:
    "Turns each brief (a brief file or a spec directory holding input.brief.json) into a clue-graph case or a Blueprint V2, checks it, and writes one result.json per brief, backend and model. Exits 0 when all pass, 2 when a case or blueprint fails a check or a judge, 1 when the run breaks.",
  options: [
    ["--format <clue-graph|v2>", "what to write: a clue-graph case from a clue-graph brief, or a Blueprint V2 from a story brief (default: clue-graph)"],
    ["--backend <agent|api>", "agent: the Claude agent in a workspace; api: one OpenRouter call, Blueprint V2 only. Repeatable (default: agent)"],
    ["--model <id>", "the model for these runs: an alias for agent, an OpenRouter id for api. Repeatable; every brief and backend runs with every model (default: each binding's own)"],
    ["--judge", "judge each blueprint straight after, as judge blueprint does"],
    ["--repair <n>", `on the agent backend: up to n rounds in which the generator fixes the faults its failing checks and judges report, and every check and judge runs again. A Blueprint V2 needs --judge (default: 0); a clue-graph case does not (default: ${CLUE_GRAPH_REPAIR.default}, at most ${CLUE_GRAPH_REPAIR.max})`],
    ["--install", "copy each blueprint that passes its mechanical checks into the game's library (<config root>/blueprints); after repair rounds, only a final blueprint that passed everything. A clue-graph case goes to blueprints/clue-graph/<metadata.id>.json once its final round passed every check and judge it ran"],
    ["--parallelism <n>", "how many blueprints to generate at once (default: 1)"],
    ["--quiet", "no live progress digest"],
  ],
});

function strings(value: OptionValue): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string");
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

/** `--format`, validated; `clue-graph` when not given. */
export function parseFormat(value: OptionValue): Format {
  if (value === undefined) return "clue-graph";
  if (typeof value !== "string" || !(FORMATS as readonly string[]).includes(value)) {
    throw new UsageError(`--format must be one of ${FORMATS.join(", ")} (got ${String(value)})`);
  }
  return value as Format;
}

/** `--backend`, validated; `agent` when none is given. Only the agent backend writes a clue-graph case. */
export function parseBackends(value: OptionValue, format: Format = "v2"): Backend[] {
  const given = unique(strings(value));
  const unknown = given.filter((name) => !(BACKENDS as readonly string[]).includes(name));
  if (unknown.length > 0) throw new UsageError(`--backend must be one of ${BACKENDS.join(", ")} (got ${unknown.join(", ")})`);
  if (format === "clue-graph" && given.includes("api")) {
    throw new UsageError("the api backend writes only Blueprint V2: a clue-graph case is written by the agent backend, which runs the validator on its own case. Use --backend agent, or --format v2");
  }
  return given.length === 0 ? ["agent"] : (given as Backend[]);
}

function parseParallelism(value: OptionValue): number {
  if (value === undefined) return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--parallelism needs a positive whole number, got "${String(value)}"`);
  return parsed;
}

/**
 * `--repair`: a whole number of rounds. For a Blueprint V2, 0 when not given;
 * it needs `--judge` and only the agent backend can take it. For a clue-graph
 * case, which only the agent backend writes, `CLUE_GRAPH_REPAIR` bounds it
 * and the validator's faults are enough to repair from.
 */
export function parseRepair(value: OptionValue, judge: boolean, backends: readonly Backend[], format: Format = "v2"): number {
  if (value === undefined) return format === "clue-graph" ? CLUE_GRAPH_REPAIR.default : 0;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new UsageError(`--repair needs a whole number of rounds, got "${String(value)}"`);
  if (format === "clue-graph") {
    if (parsed > CLUE_GRAPH_REPAIR.max) throw new UsageError(`--repair runs at most ${CLUE_GRAPH_REPAIR.max} rounds on a clue-graph case, got ${parsed}`);
    return parsed;
  }
  if (parsed === 0) return 0;
  if (!judge) throw new UsageError("--repair needs --judge: a repair round works from the judges' verdicts");
  if (backends.includes("api")) {
    throw new UsageError("--repair works only with the agent backend: the api backend is one OpenRouter call that writes a blueprint from a brief, and cannot edit one in place");
  }
  return parsed;
}

interface BriefInput {
  /** Names the subject: the spec directory's name, or the brief file's. */
  slug: string;
  brief: StoryBrief | ClueGraphBrief;
}

/** Reads each brief as the format's brief; one of the other format's says which `--format` it needs. */
async function readBriefs(inputs: readonly string[], format: Format): Promise<BriefInput[]> {
  const [schema, other] = format === "clue-graph" ? [ClueGraphBriefSchema, StoryBriefSchema] : [StoryBriefSchema, ClueGraphBriefSchema];
  const briefs: BriefInput[] = [];
  for (const input of inputs) {
    const source = await resolveBrief(input);
    const raw = await readJsonFile(source.file, "brief");
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      const what = format === "clue-graph" ? "a clue-graph brief" : "a story brief";
      const hint = other.safeParse(raw).success ? ` It is ${format === "clue-graph" ? "a Blueprint V2 story brief: pass --format v2" : "a clue-graph brief: drop --format v2"}.` : "";
      throw new InputError(`brief ${source.file} is not ${what}: ${issues}.${hint}`);
    }
    briefs.push({ slug: source.slug, brief: parsed.data });
  }
  return briefs;
}

interface Job {
  id: string;
  format: Format;
  backend: Backend;
  brief: StoryBrief | ClueGraphBrief;
  /** The generator binding with this job's model. */
  binding: ResolvedBinding;
}

/** One job for every brief, backend and model; a job with no model uses its binding's. */
function planJobs(format: Format, briefs: readonly BriefInput[], bindings: Record<Backend, ResolvedBinding>, backends: readonly Backend[], models: readonly string[]): Job[] {
  const jobs: Job[] = [];
  for (const { slug, brief } of briefs) {
    for (const backend of backends) {
      for (const model of models.length > 0 ? models : [null]) {
        const binding = model === null ? bindings[backend] : { ...bindings[backend], model };
        if (backend === "api" && !binding.model) {
          throw new ConfigError(`binding "${binding.name}" has no model: pass --model <OpenRouter model id> or set one in the config`);
        }
        jobs.push({ id: slugify([slug, backend, binding.model].filter(Boolean).join(" ")), format, backend, brief, binding });
      }
    }
  }
  return jobs;
}

/** The bindings the run records: each generator binding once, with the model every job of it used when they all used one. */
function bindingsUsed(jobs: readonly Job[], judge: ResolvedBinding | null): ResolvedBinding[] {
  const byName = new Map<string, ResolvedBinding[]>();
  for (const job of jobs) byName.set(job.binding.name, [...(byName.get(job.binding.name) ?? []), job.binding]);
  const used = [...byName.values()].map((group) => {
    const models = unique(group.map((binding) => binding.model));
    return models.length === 1 ? group[0] : { ...group[0], model: null };
  });
  return judge ? [...used, judge] : used;
}

interface RunSettings {
  run: RunFolder;
  /** Names the key the `api` backend sends; undefined for a backend that needs none. */
  apiKey: string | undefined;
  quiet: boolean;
  write: (line: string) => void;
}

/** The job's prompt: its format's system prompt and user message. */
function generationInput(job: Job): Promise<{ systemPrompt: string; userMessageContent: string }> {
  return job.format === "clue-graph"
    ? buildClueGraphGenerationChatInput(job.brief as ClueGraphBrief)
    : buildBlueprintGenerationChatInput(job.brief as StoryBrief);
}

/** What the job's generator wrapper is started with: its format, and the api backend's key. */
function generatorEnv(job: Job, apiKey: string | undefined): Record<string, string> {
  return { EVAL_GENERATE_FORMAT: job.format, ...(job.backend === "api" && apiKey ? { [OPENROUTER_KEY_VAR]: apiKey } : {}) };
}

/**
 * Sends the generation prompt through the job's binding and returns the
 * blueprint to keep. Throws, with the stage tagged, when the call gave nothing
 * to keep.
 */
async function produce(job: Job, subject: BlueprintSubject, settings: RunSettings): Promise<unknown> {
  const { timer, folder } = subject;
  const chatInput = await timer.stage("build_generation_input", () => generationInput(job));
  settings.write(`[eval] ${job.id}: generating via ${job.binding.name}${job.binding.model ? ` (${job.binding.model})` : ""}`);
  const digest = startDigest(`generate ${job.id}`, ["generate"], { logDir: folder.logDir, quiet: settings.quiet, write: settings.write });
  const parser = job.format === "clue-graph" ? caseParser() : blueprintParser();
  try {
    const outcome = await timer.stage(
      "generate",
      () =>
        runModel({
          binding: job.binding,
          step: "generate",
          systemPrompt: chatInput.systemPrompt,
          userMessage: chatInput.userMessageContent,
          logDir: folder.logDir,
          env: { ...generatorEnv(job, settings.apiKey), EVAL_RUN_DIR: folder.dir },
          parse: parser.parse,
        }),
      (result) => ({ attempts: result.call.attempts.length }),
    );
    subject.production = [outcome.call];
    if (!settings.quiet && outcome.ok) settings.write(`[eval] ${job.id}: generated (${formatDuration(timer.lastStageMs())})`);
    if (outcome.ok) return outcome.value;
    // A blueprint that was JSON but never passed the schema is still the subject.
    if (parser.lastRejected() !== undefined) return parser.lastRejected();
    throw Object.assign(new Error(`generation failed after ${outcome.call.attempts.length} attempt(s): ${outcome.error}`), { runErrorStage: "generate" });
  } finally {
    digest.stop();
  }
}

interface JudgeSettings {
  binding: ResolvedBinding | null;
  /** The most repair rounds after round 0; 0 for none. */
  repair: number;
}

/** Generates, stores and checks one blueprint, and writes its result. A broken generation is that result's `run_error`. */
async function runJob(job: Job, settings: RunSettings & JudgeSettings): Promise<{ job: Job; result: Result; subject: BlueprintSubject }> {
  const folder = settings.run.subject({ kind: "blueprint", id: job.id });
  const subject: BlueprintSubject = { run: settings.run, folder, id: job.id, timer: createRunTimer(), production: null };
  try {
    const blueprint = await produce(job, subject, settings);
    const format = BLUEPRINT_FORMAT[job.format];
    const result = settings.binding
      ? await judgeBlueprintSubject(subject, { brief: job.brief, blueprint, binding: settings.binding, selection: "all", quiet: settings.quiet, write: settings.write, format })
      : await validateBlueprintSubject(subject, { brief: job.brief, blueprint, format });
    // A Blueprint V2 is repaired only from its judges' verdicts; a clue-graph case also from its validator's faults.
    const canRepair = settings.binding !== null || job.format === "clue-graph";
    if (settings.repair === 0 || !canRepair || result.run_error !== null) return { job, result, subject };
    try {
      const chatInput = await generationInput(job);
      const repairSettings = {
        binding: job.binding,
        judge: settings.binding,
        parser: job.format === "clue-graph" ? caseParser : blueprintParser,
        format,
        env: generatorEnv(job, settings.apiKey),
        rounds: settings.repair,
        brief: job.brief,
        systemPrompt: chatInput.systemPrompt,
        userMessage: chatInput.userMessageContent,
        quiet: settings.quiet,
        write: settings.write,
      };
      return { job, result: await repairLoop(subject, repairSettings, { blueprint, result }), subject };
    } catch (error) {
      // Round 0 stays the result; the error that stopped the loop is its run error.
      return { job, result: await writeBlueprintResult(subject, { verdicts: result.verdicts, runError: runErrorOf(error), stored: true }), subject };
    }
  } catch (error) {
    const result = await writeBlueprintResult(subject, { verdicts: [], runError: runErrorOf(error), stored: false });
    return { job, result, subject };
  }
}

/** Whether a result holds a blueprint that passed every mechanical check. */
export function passedMechanicalChecks(result: Result): boolean {
  const checks = result.verdicts.filter((verdict) => verdict.tier === "mechanical");
  return result.run_error === null && result.subject.path !== null && checks.length > 0 && checks.every((check) => check.status === "pass");
}

/** Copies the stored blueprint into the library as `<id>.json`; never replaces a file already there. */
async function installBlueprint(stored: string, library: string, id: string): Promise<string> {
  await fs.mkdir(library, { recursive: true });
  const destination = path.join(library, `${id}.json`);
  try {
    await fs.copyFile(stored, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new InputError(`${destination} already exists; move or remove it to install ${id}`);
    }
    throw error;
  }
  return destination;
}

/** A case's `metadata.id`, which its validator has checked is kebab-case, so it is a safe file name. */
async function caseId(stored: string): Promise<string> {
  const parsed = JSON.parse(await fs.readFile(stored, "utf8")) as { metadata: { id: string } };
  return parsed.metadata.id;
}

/**
 * Installs what may be installed and says why the rest was not: a blueprint
 * that passed its mechanical checks, or, after repair rounds, a final blueprint
 * that passed everything. A clue-graph case goes to the library's
 * `clue-graph/`, named by its `metadata.id`, only when its final round passed
 * every check and judge it ran. Returns whether every install that was due
 * succeeded.
 */
async function installAll(done: ReadonlyArray<{ job: Job; result: Result; subject: BlueprintSubject }>, library: string, write: (line: string) => void): Promise<boolean> {
  let ok = true;
  for (const { job, result, subject } of done) {
    if (job.format === "clue-graph") {
      if (!result.summary.passed || result.subject.path === null) {
        write(`[eval] not installed: ${job.id}'s final case did not pass ${result.verdicts.some((verdict) => verdict.tier === "judge") ? "every check and judge" : "the validator"}`);
        continue;
      }
      try {
        const stored = path.join(subject.folder.dir, result.subject.path);
        write(`[eval] installed: ${await installBlueprint(stored, path.join(library, "clue-graph"), await caseId(stored))}`);
      } catch (error) {
        ok = false;
        write(`[eval] not installed: ${(error as Error).message}`);
      }
      continue;
    }
    if (result.rounds !== undefined && !result.summary.passed) {
      write(`[eval] not installed: ${job.id}'s final blueprint did not pass every check and judge`);
      continue;
    }
    if (!passedMechanicalChecks(result)) {
      write(`[eval] not installed: ${job.id} did not pass its mechanical checks`);
      continue;
    }
    try {
      write(`[eval] installed: ${await installBlueprint(path.join(subject.folder.dir, result.subject.path as string), library, path.basename(subject.folder.dir))}`);
    } catch (error) {
      ok = false;
      write(`[eval] not installed: ${(error as Error).message}`);
    }
  }
  return ok;
}

/** The key the `api` backend needs, or a `ConfigError` when it is not in the environment or `.env.local`. */
function requireApiKey(context: EvalContext): string {
  const key = readOpenRouterKey(context.env, context.root);
  if (!key) {
    throw new ConfigError(`the api backend needs ${OPENROUTER_KEY_VAR}, in the environment or in .env.local in the config root`);
  }
  return key;
}

export const generateCommand: EvalCommand = {
  name: "generate",
  summary: "Turn briefs into blueprints with the agent or api backend, then check them",
  help: HELP.replace("./dev eval generate", "./dev generate"),
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: {
        format: { type: "string" },
        backend: { type: "string", multiple: true },
        model: { type: "string", multiple: true },
        judge: { type: "boolean" },
        repair: { type: "string" },
        install: { type: "boolean" },
        parallelism: { type: "string" },
        quiet: { type: "boolean" },
      },
      positionals: { min: 1, max: 1000 },
    });
    const format = parseFormat(values.format);
    const backends = parseBackends(values.backend, format);
    const models = unique(strings(values.model));
    const parallelism = parseParallelism(values.parallelism);
    const quiet = values.quiet === true;
    const repair = parseRepair(values.repair, values.judge === true, backends, format);
    const briefs = await readBriefs(positionals, format);

    const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
    const bindings = Object.fromEntries(backends.map((backend) => [backend, resolveBinding(config, GENERATOR_BINDINGS[backend], { root: context.root })])) as Record<Backend, ResolvedBinding>;
    const jobs = planJobs(format, briefs, bindings, backends, models);
    const judge = values.judge === true ? judgeBindingFor("all", context, common) : null;
    const apiKey = backends.includes("api") ? requireApiKey(context) : undefined;

    const run = createRunFolder({
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      command: "generate",
      argv,
      root: context.root,
      bindings: bindingsUsed(jobs, judge),
    });
    context.out(`[eval] run=${run.dir}`);
    const settings = { run, apiKey, quiet, write: context.out, binding: judge, repair };
    const done = await mapPool(jobs, parallelism, (job) => runJob(job, settings));
    const index = await run.finish();

    for (const { job, result, subject } of done) {
      context.out(`[eval] ${job.id}:`);
      for (const line of summaryLines(result, subject.folder.resultFile)) context.out(line);
      for (const line of roundLines(result)) context.out(line);
    }
    if (repair > 0) context.out(runCostLine(done.map(({ result }) => result)));
    const installed = values.install === true ? await installAll(done, getBlueprintsDir(context.root, context.env), context.out) : true;
    return installed ? index.exit_code : 1;
  },
};
