/**
 * `baseline save` and `baseline compare`: a run's graded summary (the
 * `expect.json` `judge turn` writes) stored as a baseline, and a later run set
 * against one. They read and write files only and call no model.
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
