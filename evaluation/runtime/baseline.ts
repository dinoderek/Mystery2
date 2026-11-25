/**
 * `baseline save` and `baseline compare`: a run's graded summary (the
 * `expect.json` `judge turn` writes) stored as a baseline, and a later run set
 * against one. `baseline status` reports which stored baselines the code has
 * moved past. They read and write files and git only and call no model.
 *
 * A baseline is a graded summary as the run wrote it, so it records each
 * narrator, model and sample count and the commit the prompts were at. Only a
 * complete run is stored: a sample that did not run is never a result.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { InputError } from "../core/errors.ts";
import { baselineStatus, type BaselineStatus } from "../core/baseline-status.ts";
import { EXPECT_FILE, formatComparison, readSummary, writeSummary } from "./lib/expect-summary.ts";

const SAVE_HELP = formatHelp({
  usage: "baseline save <run> <file>",
  summary: [
    `Stores a judge turn run's graded summary (<run> is its folder, or its ${EXPECT_FILE}) as a baseline file,`,
    "replacing one already there. A run with a sample that did not run or could not be graded is refused:",
    "re-run it. By convention a case folder keeps its baselines in baselines/<model>.json beside its cases.",
  ].join("\n"),
});

const COMPARE_HELP = formatHelp({
  usage: "baseline compare <baseline> <run>",
  summary: [
    `Sets a run's graded summary (its folder, or its ${EXPECT_FILE}) against a stored baseline. For each narrator`,
    "and model both hold, it prints per case and per group the baseline's share right, the run's, and the change",
    "in percentage points, then what only one of them holds. It calls no model and writes nothing.",
  ].join("\n"),
});

const STATUS_HELP = formatHelp({
  usage: "baseline status",
  summary: [
    "For each baselines/*.json under evaluation/runtime/cases, says whether it is current or stale against HEAD.",
    "A baseline is stale when what its runs read (judge briefs and schemas, the harness, the narrator's prompts, the engine)",
    "differs between its run's commit and HEAD; the commits since that touch those paths are listed.",
    "It reports and never blocks: exit 0 whatever it finds, a commit it cannot resolve included. Calls no model.",
  ].join("\n"),
});

const TWO_FILES = { positionals: { min: 2, max: 2 } } as const;

export const baselineSaveCommand: EvalCommand = {
  name: "baseline save",
  summary: "Store a judge turn run's graded summary as a baseline",
  help: SAVE_HELP,
  async run(argv, context) {
    const { common, positionals } = parseCommandArgs(argv, TWO_FILES);
    if (common.help) {
      context.out(SAVE_HELP);
      return 0;
    }
    const [run, file] = positionals;
    const summary = readSummary(run);
    if (!summary.complete) {
      throw new InputError(`${run} is incomplete: some samples did not run or could not be graded. Re-run it before storing it as a baseline.`);
    }
    const target = path.resolve(file);
    const replaced = fs.existsSync(target);
    writeSummary(target, summary);
    for (const entry of summary.narrators) {
      context.out(`[baseline save] ${entry.model} (${entry.narrator}): ${entry.cases.length} case(s), ${entry.samples_per_case} samples per case`);
    }
    if (summary.run.tree_clean === false) context.out(`[baseline save] note: run ${summary.run.id} had uncommitted changes, so its commit is not the exact prompt revision`);
    context.out(`[baseline save] ${replaced ? "replaced" : "wrote"} ${target}`);
    return 0;
  },
};

export const baselineCompareCommand: EvalCommand = {
  name: "baseline compare",
  summary: "Compare a judge turn run's graded summary with a stored baseline, per case and per group",
  help: COMPARE_HELP,
  async run(argv, context) {
    const { common, positionals } = parseCommandArgs(argv, TWO_FILES);
    if (common.help) {
      context.out(COMPARE_HELP);
      return 0;
    }
    const [baseline, run] = positionals;
    for (const line of formatComparison(readSummary(baseline), readSummary(run))) context.out(line);
    return 0;
  },
};

const CASES_DIR = path.join("evaluation", "runtime", "cases");
const BASELINE_FILE = /(^|[\\/])baselines[\\/][^\\/]+\.json$/;
/** Commits listed under a stale baseline before the rest are counted. */
const LISTED_COMMITS = 15;

function findBaselines(root: string): string[] {
  const cases = path.join(root, CASES_DIR);
  if (!fs.existsSync(cases)) return [];
  return fs
    .readdirSync(cases, { recursive: true, encoding: "utf8" })
    .filter((entry) => BASELINE_FILE.test(entry))
    .map((entry) => path.join(CASES_DIR, entry))
    .sort();
}

function statusLines(file: string, commit: string | null, status: BaselineStatus): string[] {
  const at = commit === null ? "no commit" : `run at ${commit.slice(0, 7)}`;
  if (status.kind === "current") return [`${file}: current (${at})`];
  if (status.kind === "unknown") return [`${file}: unknown, ${status.reason}`];
  const { commits } = status;
  if (commits.length === 0) return [`${file}: STALE (${at}), what its runs read differs from HEAD, but no commit on its history touches them`];
  const noun = commits.length === 1 ? "commit" : "commits";
  const head = `${file}: STALE (${at}), ${commits.length} ${noun} touch what its runs read`;
  const listed = commits.slice(0, LISTED_COMMITS).map((c) => `    ${c.short} ${c.subject}`);
  const more = commits.length > LISTED_COMMITS ? [`    ... and ${commits.length - LISTED_COMMITS} more`] : [];
  return [head, ...listed, ...more];
}

export const baselineStatusCommand: EvalCommand = {
  name: "baseline status",
  summary: "Report which stored baselines are stale against HEAD",
  help: STATUS_HELP,
  async run(argv, context) {
    const { common } = parseCommandArgs(argv, { positionals: { min: 0, max: 0 } });
    if (common.help) {
      context.out(STATUS_HELP);
      return 0;
    }
    const tally = { current: 0, stale: 0, unknown: 0 };
    for (const file of findBaselines(context.root)) {
      const { commit } = readSummary(path.join(context.root, file)).run;
      const status = baselineStatus(context.root, commit);
      tally[status.kind] += 1;
      for (const line of statusLines(file, commit, status)) context.out(line);
    }
    context.out(`[baseline status] ${tally.current} current, ${tally.stale} stale, ${tally.unknown} unknown`);
    return 0;
  },
};
