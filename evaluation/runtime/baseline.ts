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
import { baselineCommits, baselineRevision, revisionSources } from "../core/baseline-sources.ts";
import { baselineChanges, baselineChangeLines, baselineSourceGroups, runInputChanges, sortedUnique } from "./lib/baseline-inputs.ts";
import type { BaselineInputs } from "./lib/baseline-inputs.ts";
import { promptFamily } from "./lib/baseline-prompts.ts";
import { baselineStatus, type BaselineStatus } from "../core/baseline-status.ts";
import { EXPECT_FILE, formatComparison, readSummary, writeSummary } from "./lib/expect-summary.ts";
import type { ExpectSummary } from "./lib/expect-summary.ts";

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
  options: [["--details", "Show changed files alongside the score comparison"]],
  summary: [
    `Sets a run's graded summary (its folder, or its ${EXPECT_FILE}) against a stored baseline. For each narrator`,
    "and model both hold, it prints per case and per group the baseline's share right, the run's, and the change",
    "in percentage points, then what only one of them holds. It reports recorded input drift alongside the scores.",
    "It calls no model and writes nothing.",
  ].join("\n"),
});

const STATUS_HELP = formatHelp({
  usage: "baseline status",
  summary: [
    "Shows what changed since each saved baseline was measured, grouped by prompt family, judge, cases, blueprint and shared code.",
    "Compares with HEAD by default and calls no model. Changes and incomplete provenance are advisory.",
  ].join("\n"),
  options: [
    ["--base <ref>", "Separate drift already present at this ref from changes between this ref and HEAD"],
    ["--details", "Show tracked inputs, changed files and available commit history"],
  ],
});

const TWO_FILES = { positionals: { min: 2, max: 2 } } as const;
const DETAILS = { details: { type: "boolean" } } as const;

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
    const { common, positionals, values } = parseCommandArgs(argv, { ...TWO_FILES, options: DETAILS });
    if (common.help) {
      context.out(COMPARE_HELP);
      return 0;
    }
    const [baseline, run] = positionals.map(readSummary);
    for (const line of comparisonDrift(baseline, run, values.details === true)) context.out(line);
    for (const line of formatComparison(baseline, run)) context.out(line);
    return 0;
  },
};

function comparisonDrift(baseline: ExpectSummary, run: ExpectSummary, details: boolean): string[] {
  const before = baseline.run.inputs;
  const after = run.run.inputs;
  if (!before || !after) return ["Input drift is unverifiable: one or both runs lack input fingerprints."];
  const changes = runInputChanges(before, after);
  const oldCases = new Set(before.cases.map((item) => item.id));
  const newCases = new Set(after.cases.map((item) => item.id));
  const matched = [...newCases].filter((id) => oldCases.has(id)).length;
  const lines = [`Case coverage: ${matched} shared (${oldCases.size} baseline, ${newCases.size} run).`];
  if (changes.length > 0) lines.push("Input differences between runs", ...baselineChangeLines(changes, details));
  if (matched === 0) lines.push("There are no shared cases to compare.");
  if (matched > 0 && changes.length === 0) lines.push("Recorded inputs for the shared cases match.");
  if (before.scope.external_inputs || after.scope.external_inputs) lines.push("Some file inputs are external to the checkout.");
  return lines;
}

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

type Change = ReturnType<typeof baselineChanges>[number];
type StatusOptions = { head: string; base: string | null; details: boolean };

function historyLines(root: string, from: string | null, to: string, changes: readonly Change[]): string[] {
  const files = sortedUnique(changes.flatMap((group) => group.files.map((file) => file.path)));
  if (files.length === 0) return [];
  try {
    const commits = from ? baselineCommits(root, from, to, files) : [];
    if (commits.length === 0) return ["  No matching commits available in local history."];
    const lines = ["  Commits since the common ancestor touching these files", ...commits.slice(0, LISTED_COMMITS).map((commit) => `    ${commit}`)];
    if (commits.length > LISTED_COMMITS) lines.push(`    ... and ${commits.length - LISTED_COMMITS} more`);
    return lines;
  } catch {
    return ["  Source history unavailable locally."];
  }
}

function trackedInputLines(inputs: BaselineInputs): string[] {
  const categories = [...new Set(inputs.sources.map((group) => group.category))];
  return categories.map((category) => {
    const names = inputs.sources.filter((group) => group.category === category).map((group) => group.name);
    return `  ${category} tracked: ${names.join(", ")}`;
  });
}

function affectedCases(change: Change, inputs: BaselineInputs): Change {
  const { category, name } = change;
  const cases = inputs.cases.filter((item) => (
    (category === "Narrator prompts" && !inputs.scope.server && promptFamily(item.action) === name)
    || (category === "Judges" && item.judges.includes(name))
    || (category === "Blueprints" && item.blueprints.includes(name))
  ));
  if (cases.length === 0 || change.files.some((file) => file.kind === "unverifiable")) return change;
  return { ...change, note: `${cases.length} measured ${cases.length === 1 ? "case" : "cases"}` };
}

function reportChanges(root: string, range: { from: string | null; to: string }, changes: readonly Change[], inputs: BaselineInputs, details: boolean): string[] {
  if (changes.length === 0) return ["  Recorded repository inputs match."];
  const labels = changes.map((change) => affectedCases(change, inputs));
  return [...baselineChangeLines(labels, details), ...(details ? historyLines(root, range.from, range.to, changes) : [])];
}

function fingerprintStatus(root: string, file: string, run: ExpectSummary["run"], options: StatusOptions) {
  const inputs = run.inputs as BaselineInputs;
  const head = baselineSourceGroups(revisionSources(root, options.head), inputs.scope, inputs.sources);
  const changes = baselineChanges(inputs.sources, head);
  const stale = changes.some((group) => group.files.length === 0 || group.files.some((file) => file.kind !== "unverifiable"));
  const unknown = inputs.scope.external_inputs || changes.some((group) => group.files.some((file) => file.kind === "unverifiable"));
  const kind = stale ? "stale" : unknown ? "unknown" : "current";
  const date = run.started_at.slice(0, 10);
  const commit = run.commit === null ? "no source commit" : run.commit.slice(0, 7);
  const heading = `${file}: ${stale ? "STALE" : kind} (last evaluated ${date} at ${commit})`;
  const lines = [heading];
  const source = inputs.history_anchor ?? run.commit;
  if (options.base) {
    const base = baselineSourceGroups(revisionSources(root, options.base), inputs.scope, inputs.sources);
    lines.push("  Saved baseline → PR base", ...reportChanges(root, { from: source, to: options.base }, baselineChanges(inputs.sources, base), inputs, options.details));
    lines.push("  PR base → HEAD", ...reportChanges(root, { from: options.base, to: options.head }, baselineChanges(base, head), inputs, options.details));
  } else {
    lines.push(...reportChanges(root, { from: source, to: options.head }, changes, inputs, options.details));
  }
  if (inputs.scope.external_inputs) lines.push("  Some inputs are outside the checkout and cannot be checked against Git.");
  if (options.details) {
    lines.push(...trackedInputLines(inputs));
    lines.push(`  Run settings: narrators ${inputs.settings.narrator_models.join(", ") || "none"}, judge models ${inputs.settings.judge_models.join(", ") || "none"}, samples ${inputs.settings.samples ?? "n/a"}`);
  }
  return { kind, lines } as const;
}

function statusOptions(root: string, base: unknown, details: boolean): StatusOptions | null {
  let head: string;
  try {
    head = baselineRevision(root, "HEAD");
  } catch {
    if (base === undefined) return null;
    throw new InputError("baseline status --base requires a checkout with a resolvable HEAD");
  }
  try {
    return { head, base: typeof base === "string" ? baselineRevision(root, base) : null, details };
  } catch {
    throw new InputError(`cannot resolve baseline status base "${String(base)}"`);
  }
}

export const baselineStatusCommand: EvalCommand = {
  name: "baseline status",
  summary: "Report what changed since each saved baseline was evaluated",
  help: STATUS_HELP,
  async run(argv, context) {
    const { common, values } = parseCommandArgs(argv, {
      options: { ...DETAILS, base: { type: "string" } }, positionals: { min: 0, max: 0 },
    });
    if (common.help) {
      context.out(STATUS_HELP);
      return 0;
    }
    const options = statusOptions(context.root, values.base, values.details === true);
    const tally = { current: 0, stale: 0, unknown: 0 };
    for (const file of findBaselines(context.root)) {
      const { run } = readSummary(path.join(context.root, file));
      if (run.inputs && options) {
        const { kind, lines } = fingerprintStatus(context.root, file, run, options);
        tally[kind] += 1;
        for (const line of lines) context.out(line);
      } else {
        const status: BaselineStatus = run.tree_clean === false
          ? { kind: "unknown", reason: "its working tree had changes and the run recorded no input fingerprints" }
          : baselineStatus(context.root, run.commit);
        tally[status.kind] += 1;
        for (const line of statusLines(file, run.commit, status)) context.out(line);
        if (!run.inputs && status.kind !== "unknown") {
          context.out("  Legacy comparison checked shared paths only. Case and blueprint provenance is incomplete.");
        }
      }
    }
    context.out(`[baseline status] ${tally.current} current, ${tally.stale} stale, ${tally.unknown} unknown`);
    return 0;
  },
};
