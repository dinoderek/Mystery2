/**
 * `perf baseline <name>`: runs a committed baseline suite,
 * `evaluation/perf/suites/<name>.json`, and pushes its records.
 *
 * A suite file is a saved set of suite attributes (`core/suite-attributes.ts`)
 * for each run it makes, and the models every binding runs on:
 *
 * - `models`: binding name to model. Each is given to every run as a
 *   `--model-override`, so the local config's wrappers run, on the suite's
 *   models, and a baseline run is the same on every machine.
 * - `runs`: each one run command, run in order, in this process:
 *   - `command`: `generate` or `judge turn`;
 *   - `inputs`: its briefs or case folders, from the repo root;
 *   - `options`: its own options, by flag name; `true` is a bare flag;
 *   - `samples`, `concurrency`: given as that command's flags (`RUN_FLAGS`), or
 *     null for its default.
 *
 * One `perf baseline` is one suite run: every run it makes records the suite's
 * name and the same commit, since a dirty tree is refused before anything runs.
 * Cases whose summaries are kept apart, as each case folder's baselines are,
 * are separate runs of one suite. When the runs end, their records are pushed
 * (`push.ts`); a push that fails is said once and leaves the exit code the
 * runs', and the next `perf push` sends it.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { COMMON_OPTIONS, formatHelp, parseCommandArgs } from "../core/args.ts";
import { runEval } from "../core/dispatch.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { EXIT_PASSED, EXIT_RUN_BROKE, EXIT_VERDICT_FAILED } from "../core/result.ts";
import { readCommit as readCheckoutCommit, resolveOutputRoot } from "../core/run-folder.ts";
import { generateCommand } from "../generate/commands.ts";
import { judgeTurnCommand } from "../runtime/judge-turn.ts";
import { pushFolders, requirePerfRemote } from "./push.ts";
import { runFolders } from "./run-folders.ts";
import { RECORD_FILE, readRecord } from "./record.ts";

export const SUITES_DIR = path.join("evaluation", "perf", "suites");

/** The flag each command a suite may run takes `samples` and `concurrency` as; null where it has none. */
export const RUN_FLAGS = {
  generate: { samples: null, concurrency: "parallelism" },
  "judge turn": { samples: "samples", concurrency: "concurrency" },
} as const;
type SuiteCommand = keyof typeof RUN_FLAGS;

const SUITE_NAME = /^[a-z][a-z0-9-]*$/;

const SuiteRunSchema = z
  .object({
    command: z.enum(Object.keys(RUN_FLAGS) as [SuiteCommand, ...SuiteCommand[]]),
    inputs: z.array(z.string().min(1)).min(1),
    options: z.record(z.union([z.string().min(1), z.number(), z.boolean()])),
    samples: z.number().int().positive().nullable(),
    concurrency: z.number().int().positive().nullable(),
  })
  .strict()
  .superRefine((run, ctx) => {
    const flags = RUN_FLAGS[run.command];
    for (const name of Object.keys(run.options)) {
      // What the suite sets itself, or the numbered attributes, never come as options.
      if (name in COMMON_OPTIONS || name === flags.samples || name === flags.concurrency) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["options", name], message: `--${name} is not an option a suite sets` });
      }
    }
    if (run.samples !== null && flags.samples === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["samples"], message: `${run.command} takes no samples` });
    }
  });
export type SuiteRun = z.infer<typeof SuiteRunSchema>;

export const SuiteFileSchema = z
  .object({
    _comment: z.string().optional(),
    models: z.record(z.string().min(1)),
    runs: z.array(SuiteRunSchema).min(1),
  })
  .strict();
export type SuiteFile = z.infer<typeof SuiteFileSchema>;

/** The suite names in `dir`: its `.json` files' names. */
export function suiteNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.slice(0, -".json".length))
    .sort();
}

/** Reads and checks the suite file `<dir>/<name>.json`. */
export function readSuite(dir: string, name: string): SuiteFile {
  if (!SUITE_NAME.test(name)) throw new UsageError(`a suite's name is lower-case words joined by "-", got "${name}"`);
  const file = path.join(dir, `${name}.json`);
  if (!fs.existsSync(file)) {
    throw new UsageError(`no suite "${name}" in ${dir}. Suites: ${suiteNames(dir).join(", ") || "none"}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new InputError(`suite ${file} is not JSON: ${(error as Error).message}`);
  }
  const parsed = SuiteFileSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(suite)"}: ${issue.message}`).join("; ");
    throw new InputError(`suite ${file} is invalid: ${issues}`);
  }
  return parsed.data;
}

/** The argv after `./dev eval` that makes one of a suite's runs: its command, inputs, options and numbers, then the suite's name and models. */
export function suiteRunArgv(run: SuiteRun, suite: { name: string; models: Record<string, string> }, root: string): string[] {
  const flags = RUN_FLAGS[run.command];
  // The commands read inputs from the working directory; relative, so a shared record holds no checkout's path.
  const argv = [...run.command.split(" "), ...run.inputs.map((input) => path.relative(process.cwd(), path.resolve(root, input)) || ".")];
  for (const [name, value] of Object.entries(run.options)) {
    if (value === true) argv.push(`--${name}`);
    else if (value !== false) argv.push(`--${name}`, String(value));
  }
  if (run.samples !== null && flags.samples !== null) argv.push(`--${flags.samples}`, String(run.samples));
  if (run.concurrency !== null) argv.push(`--${flags.concurrency}`, String(run.concurrency));
  argv.push("--suite", suite.name);
  for (const [binding, model] of Object.entries(suite.models)) argv.push("--model-override", `${binding}=${model}`);
  return argv;
}

/** The exit code of several runs: 1 if any broke, else 2 if any failed, else 0. */
function combinedExit(codes: readonly number[]): number {
  if (codes.some((code) => code !== EXIT_PASSED && code !== EXIT_VERDICT_FAILED)) return EXIT_RUN_BROKE;
  return codes.includes(EXIT_VERDICT_FAILED) ? EXIT_VERDICT_FAILED : EXIT_PASSED;
}

const HELP = formatHelp({
  usage: "perf baseline <name>",
  summary: [
    `Runs the committed baseline suite ${SUITES_DIR}/<name>.json: each of its runs in order, on the suite's models in`,
    "place of the config's, recording the suite's name, then pushes their records to the data repository as perf push",
    "does. A dirty tree is refused before anything runs. A failed push is said once and leaves the exit code the runs':",
    "perf push sends it later. Exits as a run does: 1 if any run broke, else 2 if any failed, else 0. Calls models.",
    "The suite sets --suite and --model-override itself; giving either is a usage error.",
  ].join("\n"),
});

export interface PerfBaselineDeps {
  /** Where the suite files are, absolute; the repo's by default. */
  suitesDir?: string;
  /** The checkout's commit and tree state; replaced in tests. */
  readCommit?: (root: string) => { commit: string | null; tree_clean: boolean | null };
  /** The commands a suite's runs dispatch to. */
  commands?: readonly EvalCommand[];
}

/** The record in `folder`, or null when it cannot be read: the push says so, once. */
function recordOrNull(folder: string) {
  try {
    return readRecord(folder);
  } catch {
    return null;
  }
}

/** The run folders a suite run made: new under the output root since `before`, with a record naming the suite, or one unreadable. */
function suiteFolders(outputRoot: string, before: ReadonlySet<string>, name: string): string[] {
  return runFolders(outputRoot).filter((folder) => {
    if (before.has(folder) || !fs.existsSync(path.join(folder, RECORD_FILE))) return false;
    const record = recordOrNull(folder);
    return record === null || record.run.suite === name;
  });
}

/** Says which bindings a run used on the local config's model, since the suite names none for them. */
function unpinnedBindings(folder: string, models: Record<string, string>, context: EvalContext): void {
  const run = recordOrNull(folder)?.run;
  if (!run) return;
  for (const [binding, used] of Object.entries(run.bindings)) {
    if (used.model !== null && !(binding in models)) {
      context.err(`[perf baseline] ${run.id}: binding ${binding} ran on the config's model ${used.model}; the suite names none for it`);
    }
  }
}

export function createPerfBaselineCommand(deps: PerfBaselineDeps = {}): EvalCommand {
  const readCommit = deps.readCommit ?? readCheckoutCommit;
  const commands = deps.commands ?? [generateCommand, judgeTurnCommand];
  return {
    name: "perf baseline",
    summary: "Run a committed baseline suite on its own models and push its records",
    help: HELP,
    async run(argv, context) {
      const { common, positionals } = parseCommandArgs(argv, { positionals: { min: 1, max: 1 } });
      if (common.help) {
        context.out(HELP);
        return 0;
      }
      if (common.suite !== null) throw new UsageError("--suite is the suite's name, given as <name>");
      if (Object.keys(common.modelOverrides).length > 0) throw new UsageError("a suite names its models; --model-override is not taken");
      const [name] = positionals;
      const suite = readSuite(deps.suitesDir ?? path.join(context.root, SUITES_DIR), name);
      const { commit, tree_clean } = readCommit(context.root);
      if (tree_clean !== true) {
        throw new InputError(
          tree_clean === false
            ? "the tree has uncommitted changes: a baseline is evidence only for a commit, so commit or set them aside first"
            : "the checkout's commit cannot be read: a baseline runs only from a clean git checkout",
        );
      }

      const outputRoot = resolveOutputRoot(common.outputRoot, context.env);
      // As given: each run's argv is recorded and shared, and the runs resolve the same output root from the same env.
      const passed = [
        ...(common.configPath ? ["--config", common.configPath] : []),
        ...(common.outputRoot ? ["--output-root", common.outputRoot] : []),
        ...(common.label ? ["--label", common.label] : []),
      ];
      context.out(`[perf baseline] ${name}: ${suite.runs.length} run(s) at ${commit?.slice(0, 12)}`);
      const before = new Set(runFolders(outputRoot));
      const codes: number[] = [];
      for (const [i, run] of suite.runs.entries()) {
        const runArgv = [...suiteRunArgv(run, { name, models: suite.models }, context.root), ...passed];
        context.out(`[perf baseline] run ${i + 1}/${suite.runs.length}: ${run.command} ${run.inputs.join(" ")}`);
        codes.push(await runEval(runArgv, context, commands));
      }
      const exit = combinedExit(codes);

      const folders = suiteFolders(outputRoot, before, name);
      for (const folder of folders) unpinnedBindings(folder, suite.models, context);
      context.out(`[perf baseline] ${name}: ${folders.length} run(s) recorded, exit ${exit}`);
      try {
        const remote = requirePerfRemote({ root: context.root, configPath: common.configPath });
        pushFolders(folders, { root: context.root, configPath: common.configPath, outputRoot, remote, context });
      } catch (error) {
        context.err(`[perf baseline] not pushed: ${(error as Error).message}. The records stay in their run folders; ./dev eval perf push sends them`);
      }
      return exit;
    },
  };
}

export const perfBaselineCommand = createPerfBaselineCommand();
