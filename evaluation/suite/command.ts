/**
 * `./dev eval suite <name>`: runs a suite file unattended. It plans every
 * call (`plan.ts`), makes the ones its journal does not hold (`run.ts`,
 * `journal.ts`), writes the stored results in the truth set's form, scores
 * them with `score`'s own code, checks the thresholds and exits by the core's
 * codes: 1 when the run broke (a missing binding, an unreadable file, the
 * usage-limit stop), 2 when a threshold was not met, 0 when every one was.
 *
 * A suite's state is `<output root>/suites/<name>/`: the journal
 * (`calls.jsonl`) and one run folder per invocation, `<date>/<time>-suite/`,
 * holding each call made then and `suite.json`, what the run did. Running the
 * same suite again on the same output root continues from its journal; one
 * run of a suite holds its folder at a time (`run.lock`).
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { UsageLimitError } from "../core/errors.ts";
import { EXIT_PASSED, EXIT_RUN_BROKE, EXIT_VERDICT_FAILED } from "../core/result.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import type { RunFolder } from "../core/run-folder.ts";
import { loadTruthSet, readResultsFile, TRUTH_ROOT } from "../lib/truth/loader.ts";
import type { TruthSet } from "../lib/truth/loader.ts";
import { scoreVerdicts } from "../lib/truth/score.ts";
import { reading } from "../lib/truth/inputs.ts";
import { STORED_RESULTS_VERSION, verdictKey } from "../lib/truth/schemas.ts";
import type { StoredVerdict } from "../lib/truth/schemas.ts";
import { SCORE_FILE, writeScoreFile } from "../score/command.ts";
import { formatScore } from "../score/table.ts";
import { locateSuite, readSuiteFile, SUITES_DIR } from "./file.ts";
import type { SuiteFile } from "./file.ts";
import { JOURNAL_FILE, lockSuite, openJournal } from "./journal.ts";
import type { CallJournal } from "./journal.ts";
import { planSuite } from "./plan.ts";
import type { SuitePlan } from "./plan.ts";
import { runSuitePlan } from "./run.ts";
import type { SuiteOutcome } from "./run.ts";
import { checkThresholds } from "./thresholds.ts";
import type { ThresholdCheck } from "./thresholds.ts";

export const SUITE_RUN_FILE = "suite.json";
/** Under the output root, the folder that holds each suite's state. */
export const SUITES_STATE = "suites";

const HELP = formatHelp({
  usage: "suite <name>",
  summary: [
    `Runs a suite unattended: judges its subjects, stores the results, scores them and checks its thresholds.`,
    `<name> is a suite in ${SUITES_DIR}/ (<name>.json), or a suite file's path. Exits 1 when the run broke`,
    "(a missing binding, an unreadable file, the usage limit), 2 when a threshold was not met, 0 when all were.",
    "",
    "A suite file is JSON:",
    "  subjects        bases, blueprint_plants, games, game_variants: each \"all\" or a list of truth-set ids",
    "  judges          registry judge ids, any of them, whether or not a battery runs it. A blueprint judge",
    "                  judges each blueprint; a game judge each game and variant whole; a turn judge",
    "                  (age_appropriate_turn) each narrated turn of them, on the narration it holds",
    "  models          by binding (blueprint-judge, game-judge, turn-judge), the models to run on (default:",
    "                  the binding's own, after --model-override)",
    "  samples         how many times each judge judges each subject on each model (default 1)",
    "  concurrency     how many subjects are judged at once; one subject's calls run side by side (default 1)",
    "  thresholds      a list, each with judge (or <judge>@<model>; default every judge), kind (default each",
    "                  of its kinds) and one or more of min_found_of_real and min_real_of_reported (point",
    "                  shares from 0 to 1; unmeasured does not meet) and max_errors (verdicts that did not judge)",
    "  description     free text",
    "",
    "A call is one judge on one subject, model and sample, and is finished once its judge answered or failed",
    "after its retries; a failure is stored as the judge's error and counted. Each finished call is kept in",
    `<output root>/${SUITES_STATE}/<name>/${JOURNAL_FILE} by subject, judge, model, sample and prompt hash, and`,
    "never made again: a stopped run resumes where it stopped, and a changed brief or model is a new call.",
    "At the login's usage limit the suite stops at once, storing nothing as a judge's error; run it again",
    "after the reset. Prompts, logs and workspaces stay in that folder; the stored results hold none. One run",
    "of a suite holds that folder at a time. To make a finished call again, delete its line from the journal.",
  ].join("\n"),
  options: [
    ["--truth <dir>", `the truth set (default: ${TRUTH_ROOT})`],
    ["--results <file>", "where the stored results are written (default: results/<name>.json in the truth set)"],
  ],
});

function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Writes the stored results, then reads them back through the truth set's loader, which checks them. */
async function storeResults(set: TruthSet, file: string, verdicts: readonly StoredVerdict[]): Promise<StoredVerdict[]> {
  const ordered = [...verdicts].sort((a, b) => byCodePoint(verdictKey(a), verdictKey(b)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ schema_version: STORED_RESULTS_VERSION, verdicts: ordered }, null, 2)}\n`, "utf8");
  return reading(() => readResultsFile(set, file));
}

interface RunRecord {
  suite: SuiteFile;
  truth: string;
  results: string;
  journal: CallJournal;
  plan: SuitePlan;
}

function writeRunFile(run: RunFolder, record: RunRecord, outcome: Partial<SuiteOutcome> & { stopped: string | null; thresholds: ThresholdCheck[]; exit_code: number }): void {
  const file = {
    run: run.info(),
    suite: { name: record.suite.name, file: record.suite.file },
    truth: record.truth,
    results: outcome.stopped === null ? record.results : null,
    journal: record.journal.file,
    calls: { planned: record.plan.calls, made: outcome.made ?? null, recalled: outcome.recalled ?? null, finished: record.journal.finished() },
    stopped: outcome.stopped,
    thresholds: outcome.thresholds,
    exit_code: outcome.exit_code,
  };
  fs.writeFileSync(path.join(run.dir, SUITE_RUN_FILE), `${JSON.stringify(file, null, 2)}\n`, "utf8");
}

function stop(error: UsageLimitError, run: RunFolder, record: RunRecord, context: EvalContext): number {
  writeRunFile(run, record, { stopped: error.message, thresholds: [], exit_code: EXIT_RUN_BROKE });
  context.err(
    `eval suite: stopped: ${error.message}. ${record.journal.finished()} of ${record.plan.calls} call(s) are finished and kept in ` +
      `${record.journal.file}; nothing was stored as a judge's error. Run the suite again once the limit resets to continue from there.`,
  );
  return EXIT_RUN_BROKE;
}

async function runSuite(argv: string[], context: EvalContext): Promise<number> {
  const { common, values, positionals } = parseCommandArgs(argv, {
    options: { truth: { type: "string" }, results: { type: "string" } },
    positionals: { min: 1, max: 1 },
  });
  const suite = readSuiteFile(locateSuite(positionals[0], context.root));
  const truthRoot = typeof values.truth === "string" ? path.resolve(values.truth) : path.join(context.root, TRUTH_ROOT);
  const set = await reading(() => loadTruthSet(truthRoot));
  const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
  const plan = planSuite(suite.suite, set, (name) => resolveBinding(config, name, { root: context.root }));
  const results = typeof values.results === "string" ? path.resolve(values.results) : path.join(truthRoot, "results", `${suite.name}.json`);

  const stateDir = path.join(resolveOutputRoot(common.outputRoot, context.env), SUITES_STATE, suite.name);
  const release = lockSuite(stateDir);
  try {
    const run = createRunFolder({ outputRoot: stateDir, command: "suite", argv, root: context.root, bindings: plan.bindings });
    const journal = openJournal(path.join(stateDir, JOURNAL_FILE), run.dir);
    return await runHeld({ suite, truth: truthRoot, results, journal, plan }, { set, run, context });
  } finally {
    release();
  }
}

/** The run itself, once the suite's state is held: the calls, then the results, the score and the thresholds. */
async function runHeld(record: RunRecord, { set, run, context }: { set: TruthSet; run: RunFolder; context: EvalContext }): Promise<number> {
  const { suite, plan, journal, results } = record;
  context.out(`[suite] ${suite.name}: ${plan.calls} call(s) on ${plan.subjects.length} subject(s), journal holds ${journal.held} -> ${run.dir}`);

  let outcome: SuiteOutcome;
  try {
    outcome = await runSuitePlan(plan, { context, run, journal, concurrency: suite.suite.concurrency });
  } catch (error) {
    if (error instanceof UsageLimitError) return stop(error, run, record, context);
    throw error;
  }

  const verdicts = await storeResults(set, results, outcome.verdicts);
  const shown = (file: string) => {
    const relative = path.relative(context.root, file);
    return relative.startsWith("..") ? file : relative.split(path.sep).join("/");
  };
  const report = scoreVerdicts(set, verdicts);
  const inputs = { truth: shown(record.truth), results: [shown(results)] };
  writeScoreFile(path.join(run.dir, SCORE_FILE), report, inputs);
  context.out(formatScore(report, inputs));

  const thresholds = checkThresholds(suite.suite.thresholds, report);
  if (thresholds.length > 0) context.out(["", "Thresholds:", ...thresholds.flatMap((check) => check.lines.map((line) => `  ${line}`))].join("\n"));
  const exitCode = thresholds.every((check) => check.met) ? EXIT_PASSED : EXIT_VERDICT_FAILED;
  writeRunFile(run, record, { ...outcome, stopped: null, thresholds, exit_code: exitCode });
  context.out(`\n[suite] ${outcome.made} call(s) made, ${outcome.recalled} finished before; results ${results}; run ${run.dir} (exit ${exitCode})`);
  return exitCode;
}

export const suiteCommand: EvalCommand = {
  name: "suite",
  summary: "Run a suite file unattended: judge, store, score, check thresholds; resumes where it stopped",
  help: HELP,
  run: runSuite,
};
