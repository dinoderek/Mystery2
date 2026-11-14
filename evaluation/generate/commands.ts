/**
 * `./dev eval generate <brief>...`: briefs in, blueprints out, in one run with
 * one subject per brief, backend and model.
 *
 * `--backend agent` runs the Claude agent in its workspace (the `generator-agent`
 * binding); `--backend api` makes one OpenRouter call (`generator-api`). Both
 * are model calls through the core runner, sent the prompt that
 * `buildBlueprintGenerationChatInput` builds, and both land in the same place:
 * the answer is checked against the Blueprint V2 schema, stored beside its
 * `result.json`, and put through the mechanical checks. A blueprint that fails
 * the schema after every attempt is kept and fails its mechanical check, so the
 * run exits 2; only a call that gave nothing to keep breaks the run. `--judge`
 * judges each blueprint straight after, as `judge blueprint` does. `--install`
 * copies each blueprint that passed its mechanical checks into the game's
 * library and leaves the others where they are.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { buildBlueprintGenerationChatInput, StoryBriefSchema } from "../../packages/blueprint-generator/src/index.ts";
import type { StoryBrief } from "../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";
import { getBlueprintsDir } from "../../scripts/local-config.mjs";
import { judgeBindingFor, summaryLines } from "../blueprint/commands.ts";
import { readJsonFile, resolveBrief, STORED_BLUEPRINT } from "../blueprint/inputs.ts";
import { judgeBlueprintSubject, runErrorOf, validateBlueprintSubject, writeBlueprintResult } from "../blueprint/subject.ts";
import type { BlueprintSubject } from "../blueprint/subject.ts";
import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { ConfigError, InputError, UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { createRunFolder, resolveOutputRoot, slugify } from "../core/run-folder.ts";
import type { RunFolder } from "../core/run-folder.ts";
import type { Result } from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { createRunTimer } from "../core/timing.ts";
import { OPENROUTER_KEY_VAR, readOpenRouterKey } from "./openrouter.ts";

export const BACKENDS = ["agent", "api"] as const;
export type Backend = (typeof BACKENDS)[number];

/** The binding each backend runs through. */
export const GENERATOR_BINDINGS: Record<Backend, string> = { agent: "generator-agent", api: "generator-api" };

const HELP = formatHelp({
  usage: "generate <brief>...",
  summary:
    "Turns each brief (a brief file or a spec directory holding input.brief.json) into a Blueprint V2, checks it against the schema and the mechanical checks, and writes one result.json per brief, backend and model. Exits 0 when all pass, 2 when a blueprint fails a check or a judge, 1 when the run breaks.",
  options: [
    ["--backend <agent|api>", "agent: the Claude agent in a workspace; api: one OpenRouter call. Repeatable (default: agent)"],
    ["--model <id>", "the model for these runs: an alias for agent, an OpenRouter id for api. Repeatable; every brief and backend runs with every model (default: each binding's own)"],
    ["--judge", "judge each blueprint straight after, as judge blueprint does"],
    ["--install", "copy each blueprint that passes its mechanical checks into the game's library (<config root>/blueprints)"],
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

/** `--backend`, validated; `agent` when none is given. */
export function parseBackends(value: OptionValue): Backend[] {
  const given = unique(strings(value));
  const unknown = given.filter((name) => !(BACKENDS as readonly string[]).includes(name));
  if (unknown.length > 0) throw new UsageError(`--backend must be one of ${BACKENDS.join(", ")} (got ${unknown.join(", ")})`);
  return given.length === 0 ? ["agent"] : (given as Backend[]);
}

function parseParallelism(value: OptionValue): number {
  if (value === undefined) return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--parallelism needs a positive whole number, got "${String(value)}"`);
  return parsed;
}

interface BriefInput {
  /** Names the subject: the spec directory's name, or the brief file's. */
  slug: string;
  brief: StoryBrief;
}

async function readBriefs(inputs: readonly string[]): Promise<BriefInput[]> {
  const briefs: BriefInput[] = [];
  for (const input of inputs) {
    const source = await resolveBrief(input);
    const parsed = StoryBriefSchema.safeParse(await readJsonFile(source.file, "brief"));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new InputError(`brief ${source.file} is not a story brief: ${issues}`);
    }
    briefs.push({ slug: source.slug, brief: parsed.data });
  }
  return briefs;
}

interface Job {
  id: string;
  backend: Backend;
  brief: StoryBrief;
  /** The generator binding with this job's model. */
  binding: ResolvedBinding;
}

/** One job for every brief, backend and model; a job with no model uses its binding's. */
function planJobs(briefs: readonly BriefInput[], bindings: Record<Backend, ResolvedBinding>, backends: readonly Backend[], models: readonly string[]): Job[] {
  const jobs: Job[] = [];
  for (const { slug, brief } of briefs) {
    for (const backend of backends) {
      for (const model of models.length > 0 ? models : [null]) {
        const binding = model === null ? bindings[backend] : { ...bindings[backend], model };
        if (backend === "api" && !binding.model) {
          throw new ConfigError(`binding "${binding.name}" has no model: pass --model <OpenRouter model id> or set one in the config`);
        }
        jobs.push({ id: slugify([slug, backend, binding.model].filter(Boolean).join(" ")), backend, brief, binding });
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

/**
 * Takes the model's answer as the blueprint: it must be JSON and match the
 * schema, or the attempt is retried. The last JSON that failed the schema is
 * kept, so a blueprint that never passed is still stored and fails its check.
 */
function blueprintParser(): { parse: (answer: string) => unknown; lastRejected: () => unknown } {
  let rejected: unknown;
  return {
    parse(answer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(answer);
      } catch (error) {
        throw new Error(`the answer is not valid JSON (${(error as Error).message}). First 200 chars: ${answer.slice(0, 200)}`, { cause: error });
      }
      const checked = BlueprintV2Schema.safeParse(parsed);
      if (checked.success) return parsed;
      rejected = parsed;
      const issues = checked.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      const more = checked.error.issues.length > 5 ? ` (+${checked.error.issues.length - 5} more)` : "";
      throw new Error(`the blueprint failed BlueprintV2Schema: ${issues.join("; ")}${more}`);
    },
    lastRejected: () => rejected,
  };
}

interface RunSettings {
  run: RunFolder;
  /** Names the key the `api` backend sends; undefined for a backend that needs none. */
  apiKey: string | undefined;
  quiet: boolean;
  write: (line: string) => void;
}

/**
 * Sends the generation prompt through the job's binding and returns the
 * blueprint to keep. Throws, with the stage tagged, when the call gave nothing
 * to keep.
 */
async function produce(job: Job, subject: BlueprintSubject, settings: RunSettings): Promise<unknown> {
  const { timer, folder } = subject;
  const chatInput = await timer.stage("build_generation_input", () => buildBlueprintGenerationChatInput(job.brief));
  settings.write(`[eval] ${job.id}: generating via ${job.binding.name}${job.binding.model ? ` (${job.binding.model})` : ""}`);
  const digest = startDigest(`generate ${job.id}`, ["generate"], { logDir: folder.logDir, quiet: settings.quiet, write: settings.write });
  const parser = blueprintParser();
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
          env: { EVAL_RUN_DIR: folder.dir, ...(job.backend === "api" && settings.apiKey ? { [OPENROUTER_KEY_VAR]: settings.apiKey } : {}) },
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
}

/** Generates, stores and checks one blueprint, and writes its result. A broken generation is that result's `run_error`. */
async function runJob(job: Job, settings: RunSettings & JudgeSettings): Promise<{ job: Job; result: Result; subject: BlueprintSubject }> {
  const folder = settings.run.subject({ kind: "blueprint", id: job.id });
  const subject: BlueprintSubject = { run: settings.run, folder, id: job.id, timer: createRunTimer(), production: null };
  try {
    const blueprint = await produce(job, subject, settings);
    const result = settings.binding
      ? await judgeBlueprintSubject(subject, { brief: job.brief, blueprint, binding: settings.binding, selection: "all", quiet: settings.quiet, write: settings.write })
      : await validateBlueprintSubject(subject, { brief: job.brief, blueprint });
    return { job, result, subject };
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

/** Copies the stored blueprint into the library under the subject's id; never replaces one already there. */
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

/** Installs what may be installed and says why the rest was not. Returns whether every install that was due succeeded. */
async function installAll(done: ReadonlyArray<{ job: Job; result: Result; subject: BlueprintSubject }>, library: string, write: (line: string) => void): Promise<boolean> {
  let ok = true;
  for (const { job, result, subject } of done) {
    if (!passedMechanicalChecks(result)) {
      write(`[eval] not installed: ${job.id} did not pass its mechanical checks`);
      continue;
    }
    try {
      write(`[eval] installed: ${await installBlueprint(path.join(subject.folder.dir, STORED_BLUEPRINT), library, job.id)}`);
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
  help: HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: {
        backend: { type: "string", multiple: true },
        model: { type: "string", multiple: true },
        judge: { type: "boolean" },
        install: { type: "boolean" },
        parallelism: { type: "string" },
        quiet: { type: "boolean" },
      },
      positionals: { min: 1, max: 1000 },
    });
    const backends = parseBackends(values.backend);
    const models = unique(strings(values.model));
    const parallelism = parseParallelism(values.parallelism);
    const quiet = values.quiet === true;
    const briefs = await readBriefs(positionals);

    const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
    const bindings = Object.fromEntries(backends.map((backend) => [backend, resolveBinding(config, GENERATOR_BINDINGS[backend], { root: context.root })])) as Record<Backend, ResolvedBinding>;
    const jobs = planJobs(briefs, bindings, backends, models);
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
    const settings = { run, apiKey, quiet, write: context.out, binding: judge };
    const done = await mapPool(jobs, parallelism, (job) => runJob(job, settings));
    const index = await run.finish();

    for (const { job, result, subject } of done) {
      context.out(`[eval] ${job.id}:`);
      for (const line of summaryLines(result, subject.folder.resultFile)) context.out(line);
    }
    const installed = values.install === true ? await installAll(done, getBlueprintsDir(context.root, context.env), context.out) : true;
    return installed ? index.exit_code : 1;
  },
};
