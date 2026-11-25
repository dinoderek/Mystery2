/**
 * `./dev generate <brief>...`: clue-graph briefs in, clue-graph cases out, in
 * one run with one subject per brief and model.
 *
 * The Claude agent writes each case in a clue-graph workspace (the
 * `generator-agent` binding), sent the prompt that
 * `buildClueGraphGenerationChatInput` builds. The case is stored beside its
 * `result.json` and checked by the case validator; a case that fails is kept
 * and fails its check, so the run exits 2, and only a call that gave nothing
 * to keep breaks the run. `--judge` judges each case straight after, as
 * `judge blueprint` does. `--repair <n>` runs up to `n` repair rounds on a
 * case that failed (`repair.ts`); the validator's faults alone are enough to
 * repair from. `--install` copies each case into the library's `clue-graph/`
 * only when its final round passed every check and judge it ran.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { buildClueGraphGenerationChatInput, ClueGraphBriefSchema } from "../../packages/blueprint-generator/src/index.ts";
import type { ClueGraphBrief } from "../../packages/blueprint-generator/src/index.ts";
import { getBlueprintsDir } from "../../scripts/local-config.mjs";
import { judgeBindingFor, summaryLines } from "../blueprint/commands.ts";
import { readJsonFile, resolveBrief } from "../blueprint/inputs.ts";
import { judgeBlueprintSubject, runErrorOf, validateBlueprintSubject, writeBlueprintResult } from "../blueprint/subject.ts";
import type { BlueprintSubject } from "../blueprint/subject.ts";
import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { createRunFolder, resolveOutputRoot, slugify } from "../core/run-folder.ts";
import { runIdentity } from "../core/run-identity.ts";
import type { RunFolder } from "../core/run-folder.ts";
import type { Result } from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { createRunTimer } from "../core/timing.ts";
import { caseParser } from "./blueprint-answer.ts";
import { repairLoop, roundLines, runCostLine } from "./repair.ts";

/** A case's repair rounds when `--repair` is not given, and the most it may ask for. */
export const CLUE_GRAPH_REPAIR = { default: 2, max: 5 } as const;

/** The binding that runs the generator agent. */
export const GENERATOR_BINDING = "generator-agent";

const HELP = formatHelp({
  usage: "generate <brief>...",
  summary:
    "Turns each clue-graph brief (a brief file or a spec directory holding input.brief.json) into a clue-graph case, checks it, and writes one result.json per brief and model. Exits 0 when all pass, 2 when a case fails a check or a judge, 1 when the run breaks.",
  options: [
    ["--model <id>", "the generator agent's model for these runs. Repeatable; every brief runs with every model (default: the binding's own)"],
    ["--judge", "judge each case straight after, as judge blueprint does"],
    ["--repair <n>", `up to n rounds in which the generator fixes the faults its failing checks and judges report, and every check and judge runs again (default: ${CLUE_GRAPH_REPAIR.default}, at most ${CLUE_GRAPH_REPAIR.max})`],
    ["--install", "copy each case into the game's library at blueprints/clue-graph/<metadata.id>.json once its final round passed every check and judge it ran"],
    ["--parallelism <n>", "how many cases to generate at once (default: 1)"],
    ["--quiet", "no live progress digest"],
  ],
});

function strings(value: OptionValue): string[] {
  return (Array.isArray(value) ? value : [value]).filter((item): item is string => typeof item === "string");
}

function unique<T>(items: readonly T[]): T[] {
  return [...new Set(items)];
}

function parseParallelism(value: OptionValue): number {
  if (value === undefined) return 1;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new UsageError(`--parallelism needs a positive whole number, got "${String(value)}"`);
  return parsed;
}

/** `--repair`: a whole number of rounds, `CLUE_GRAPH_REPAIR` bounds it. */
export function parseRepair(value: OptionValue): number {
  if (value === undefined) return CLUE_GRAPH_REPAIR.default;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new UsageError(`--repair needs a whole number of rounds, got "${String(value)}"`);
  if (parsed > CLUE_GRAPH_REPAIR.max) throw new UsageError(`--repair runs at most ${CLUE_GRAPH_REPAIR.max} rounds on a case, got ${parsed}`);
  return parsed;
}

interface BriefInput {
  /** Names the subject: the spec directory's name, or the brief file's. */
  slug: string;
  brief: ClueGraphBrief;
}

/** Reads each brief as a clue-graph brief. */
async function readBriefs(inputs: readonly string[]): Promise<BriefInput[]> {
  const briefs: BriefInput[] = [];
  for (const input of inputs) {
    const source = await resolveBrief(input);
    const parsed = ClueGraphBriefSchema.safeParse(await readJsonFile(source.file, "brief"));
    if (!parsed.success) {
      const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
      throw new InputError(`brief ${source.file} is not a clue-graph brief: ${issues}`);
    }
    briefs.push({ slug: source.slug, brief: parsed.data });
  }
  return briefs;
}

interface Job {
  id: string;
  brief: ClueGraphBrief;
  /** The generator binding with this job's model. */
  binding: ResolvedBinding;
}

/** One job for every brief and model; a job with no model uses the binding's. */
function planJobs(briefs: readonly BriefInput[], binding: ResolvedBinding, models: readonly string[]): Job[] {
  return briefs.flatMap(({ slug, brief }) =>
    (models.length > 0 ? models : [null]).map((model) => {
      const jobBinding = model === null ? binding : { ...binding, model };
      return { id: slugify([slug, jobBinding.model].filter(Boolean).join(" ")), brief, binding: jobBinding };
    }),
  );
}

/** The bindings the run records: the generator binding once, with the model every job used when they all used one; and the judge's. */
function bindingsUsed(jobs: readonly Job[], judge: ResolvedBinding | null): ResolvedBinding[] {
  const models = unique(jobs.map((job) => job.binding.model));
  const generator = models.length === 1 ? jobs[0].binding : { ...jobs[0].binding, model: null };
  return judge ? [generator, judge] : [generator];
}

interface RunSettings {
  run: RunFolder;
  quiet: boolean;
  write: (line: string) => void;
}

/**
 * Sends the generation prompt through the job's binding and returns the case
 * to keep. Throws, with the stage tagged, when the call gave nothing to keep.
 */
async function produce(job: Job, subject: BlueprintSubject, settings: RunSettings): Promise<unknown> {
  const { timer, folder } = subject;
  const chatInput = await timer.stage("build_generation_input", () => buildClueGraphGenerationChatInput(job.brief));
  settings.write(`[eval] ${job.id}: generating via ${job.binding.name}${job.binding.model ? ` (${job.binding.model})` : ""}`);
  const digest = startDigest(`generate ${job.id}`, ["generate"], { logDir: folder.logDir, quiet: settings.quiet, write: settings.write });
  const parser = caseParser();
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
          env: { EVAL_RUN_DIR: folder.dir },
          parse: parser.parse,
        }),
      (result) => ({ attempts: result.call.attempts.length }),
    );
    subject.production = [outcome.call];
    if (!settings.quiet && outcome.ok) settings.write(`[eval] ${job.id}: generated (${formatDuration(timer.lastStageMs())})`);
    if (outcome.ok) return outcome.value;
    // An answer that was JSON but not an object is still the subject.
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

/** Generates, stores and checks one case, and writes its result. A broken generation is that result's `run_error`. */
async function runJob(job: Job, settings: RunSettings & JudgeSettings): Promise<{ job: Job; result: Result; subject: BlueprintSubject }> {
  const folder = settings.run.subject({ kind: "blueprint", id: job.id });
  const subject: BlueprintSubject = { run: settings.run, folder, id: job.id, timer: createRunTimer(), production: null };
  try {
    const blueprint = await produce(job, subject, settings);
    const result = settings.binding
      ? await judgeBlueprintSubject(subject, { brief: job.brief, blueprint, binding: settings.binding, selection: "all", quiet: settings.quiet, write: settings.write })
      : await validateBlueprintSubject(subject, { brief: job.brief, blueprint });
    if (settings.repair === 0 || result.run_error !== null) return { job, result, subject };
    try {
      const chatInput = await buildClueGraphGenerationChatInput(job.brief);
      const repairSettings = {
        binding: job.binding,
        judge: settings.binding,
        parser: caseParser,
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

/** Copies the stored case into the library as `<id>.json`; never replaces a file already there. */
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
 * Installs each case into the library's `clue-graph/`, named by its
 * `metadata.id`, only when its final round passed every check and judge it
 * ran, and says why any other was not. Returns whether every install that was
 * due succeeded.
 */
async function installAll(done: ReadonlyArray<{ job: Job; result: Result; subject: BlueprintSubject }>, library: string, write: (line: string) => void): Promise<boolean> {
  let ok = true;
  for (const { job, result, subject } of done) {
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
  }
  return ok;
}

export const generateCommand: EvalCommand = {
  name: "generate",
  summary: "Turn clue-graph briefs into cases with the generator agent, then check them",
  help: HELP.replace("./dev eval generate", "./dev generate"),
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: {
        model: { type: "string", multiple: true },
        judge: { type: "boolean" },
        repair: { type: "string" },
        install: { type: "boolean" },
        parallelism: { type: "string" },
        quiet: { type: "boolean" },
      },
      positionals: { min: 1, max: 1000 },
    });
    const models = unique(strings(values.model));
    const parallelism = parseParallelism(values.parallelism);
    const quiet = values.quiet === true;
    const repair = parseRepair(values.repair);
    const briefs = await readBriefs(positionals);

    const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
    const binding = resolveBinding(config, GENERATOR_BINDING, { root: context.root });
    const jobs = planJobs(briefs, binding, models);
    const judge = values.judge === true ? judgeBindingFor("all", context, common) : null;

    const run = createRunFolder({
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      command: "generate",
      argv,
      root: context.root,
      identity: runIdentity(common, context.root),
      bindings: bindingsUsed(jobs, judge),
    });
    context.out(`[eval] run=${run.dir}`);
    const settings = { run, quiet, write: context.out, binding: judge, repair };
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
