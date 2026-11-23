/**
 * A run's graded summary: every `expect` case's samples summed per case and
 * per group, for each narrator and model the run used. `judge turn` writes it
 * as `expect.json` in the run folder; `baseline save` stores one, and
 * `baseline compare` sets a run's against a stored one.
 *
 * A sample that did not run, or could not be graded, is incomplete: counted
 * neither right nor wrong, and a summary holding any is not complete. An
 * ungraded case is summed and shown, but left out of its group.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { InputError } from "../../core/errors.ts";
import type { RunInfo, Verdict } from "../../core/result.ts";
import { table } from "./table.ts";
import type { Direction, UseOutcome } from "./expect.ts";

export const EXPECT_FILE = "expect.json";
export const EXPECT_SUMMARY_VERSION = "mystery-expect-summary/1";
/** The group of a case that names none. */
export const NO_GROUP = "ungrouped";

const count = z.number().int().min(0);
const TallySchema = z
  .object({
    samples: count,
    /** Samples graded right or wrong; the rest are incomplete. */
    graded: count,
    right: count,
    /** right / graded; null when nothing was graded. */
    share: z.number().min(0).max(1).nullable(),
    // A wrong sample may err more than one way, so these can sum past the wrong ones.
    withheld: count,
    given_away: count,
    misread: count,
    judged: count,
    unseen: count,
    refused: count,
    incomplete: count,
  })
  .strict();
export type Tally = z.infer<typeof TallySchema>;

const CaseSummarySchema = TallySchema.extend({ id: z.string().min(1), group: z.string().min(1), ungraded: z.boolean() }).strict();
export type CaseSummary = z.infer<typeof CaseSummarySchema>;
const GroupSummarySchema = TallySchema.extend({ group: z.string().min(1), cases: count }).strict();
export type GroupSummary = z.infer<typeof GroupSummarySchema>;

const NarratorSummarySchema = z
  .object({
    narrator: z.string().min(1),
    /** The model behind the narration: a binding's name and model, or the AI a server was asked for. */
    model: z.string().min(1),
    /** The samples asked for per case. */
    samples_per_case: z.number().int().positive(),
    complete: z.boolean(),
    cases: z.array(CaseSummarySchema),
    groups: z.array(GroupSummarySchema),
  })
  .strict();
export type NarratorSummary = z.infer<typeof NarratorSummarySchema>;

export const ExpectSummarySchema = z
  .object({
    schema_version: z.literal(EXPECT_SUMMARY_VERSION),
    /** The run it summarises; the commit is the prompt revision, exact only when the tree was clean. */
    run: z
      .object({
        id: z.string().min(1),
        started_at: z.string(),
        commit: z.string().nullable(),
        tree_clean: z.boolean().nullable(),
        argv: z.array(z.string()),
      })
      .strict(),
    complete: z.boolean(),
    narrators: z.array(NarratorSummarySchema),
  })
  .strict();
export type ExpectSummary = z.infer<typeof ExpectSummarySchema>;

/** One sample of an `expect` case, with its grade; `verdict` is null when the sample did not run. */
export interface Sample {
  caseId: string;
  narrator: string;
  model: string;
  group: string | null;
  ungraded: boolean;
  verdict: Verdict | null;
}

function emptyTally(): Tally {
  return { samples: 0, graded: 0, right: 0, share: null, withheld: 0, given_away: 0, misread: 0, judged: 0, unseen: 0, refused: 0, incomplete: 0 };
}

function addSample(tally: Tally, verdict: Verdict | null): void {
  tally.samples += 1;
  if (verdict?.status !== "pass" && verdict?.status !== "fail") {
    tally.incomplete += 1;
    return;
  }
  tally.graded += 1;
  if (verdict.status === "pass") tally.right += 1;
  const details = verdict.details as { erred?: Direction[]; use?: UseOutcome | null } | undefined;
  for (const direction of details?.erred ?? []) tally[direction] += 1;
  if (details?.use) tally[details.use] += 1;
}

const COUNTS = ["samples", "graded", "right", "withheld", "given_away", "misread", "judged", "unseen", "refused", "incomplete"] as const;

function addTally(into: Tally, from: Tally): void {
  for (const key of COUNTS) into[key] += from[key];
}

function withShare<T extends Tally>(tally: T): T {
  return { ...tally, share: tally.graded > 0 ? tally.right / tally.graded : null };
}

function narratorSummary(narrator: string, model: string, samples: readonly Sample[], perCase: number): NarratorSummary {
  const cases = new Map<string, CaseSummary>();
  for (const sample of samples) {
    const entry = cases.get(sample.caseId) ?? { id: sample.caseId, group: sample.group ?? NO_GROUP, ungraded: sample.ungraded, ...emptyTally() };
    addSample(entry, sample.verdict);
    cases.set(sample.caseId, entry);
  }
  const groups = new Map<string, GroupSummary>();
  for (const entry of cases.values()) {
    if (entry.ungraded) continue;
    const group = groups.get(entry.group) ?? { group: entry.group, cases: 0, ...emptyTally() };
    group.cases += 1;
    addTally(group, entry);
    groups.set(entry.group, group);
  }
  const caseList = [...cases.values()].map(withShare);
  return {
    narrator,
    model,
    samples_per_case: perCase,
    complete: caseList.every((entry) => entry.incomplete === 0),
    cases: caseList,
    groups: [...groups.values()].map(withShare),
  };
}

/** Sums a run's samples, in the order they come, per narrator and model. */
export function summarizeSamples(samples: readonly Sample[], perCase: number, run: RunInfo): ExpectSummary {
  const byNarrator = new Map<string, Sample[]>();
  for (const sample of samples) {
    const key = `${sample.narrator}\u0000${sample.model}`;
    byNarrator.set(key, [...(byNarrator.get(key) ?? []), sample]);
  }
  const narrators = [...byNarrator.values()].map((list) => narratorSummary(list[0].narrator, list[0].model, list, perCase));
  return {
    schema_version: EXPECT_SUMMARY_VERSION,
    run: { id: run.id, started_at: run.started_at, commit: run.commit, tree_clean: run.tree_clean, argv: run.argv },
    complete: narrators.every((entry) => entry.complete),
    narrators,
  };
}

export function writeSummary(file: string, summary: ExpectSummary): void {
  const checked = ExpectSummarySchema.parse(summary);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(checked, null, 2)}\n`, "utf8");
}

/** Reads a graded summary: a run folder's `expect.json`, or a summary or baseline file itself. */
export function readSummary(target: string): ExpectSummary {
  const absolute = path.resolve(target);
  const file = fs.existsSync(absolute) && fs.statSync(absolute).isDirectory() ? path.join(absolute, EXPECT_FILE) : absolute;
  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new InputError(`cannot read a graded summary from ${file}: ${(error as Error).message}`);
  }
  const parsed = ExpectSummarySchema.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new InputError(`${file} is not a graded summary: ${issue.path.join(".") || "(root)"}: ${issue.message}`);
  }
  return parsed.data;
}

function percent(share: number | null): string {
  return share === null ? "-" : `${Math.round(share * 100)}%`;
}

function tallyCells(tally: Tally): string[] {
  return [
    `${tally.right}/${tally.graded}`,
    percent(tally.share),
    String(tally.withheld),
    String(tally.given_away),
    String(tally.misread),
    String(tally.judged),
    String(tally.unseen),
    String(tally.refused),
    String(tally.incomplete),
  ];
}

const TALLY_HEADER = ["right", "share", "withheld", "given away", "misread", "judged", "unseen", "refused", "incomplete"];

function revision(summary: ExpectSummary): string {
  const commit = summary.run.commit ? summary.run.commit.slice(0, 12) : "no commit";
  return summary.run.tree_clean === false ? `${commit} (uncommitted changes)` : commit;
}

function incompleteNote(summary: ExpectSummary): string[] {
  if (summary.complete) return [];
  const missing = summary.narrators.flatMap((entry) => entry.cases).reduce((sum, entry) => sum + entry.incomplete, 0);
  const all = summary.narrators.flatMap((entry) => entry.cases).reduce((sum, entry) => sum + entry.samples, 0);
  return [`INCOMPLETE: ${missing} of ${all} samples did not run or could not be graded; shares are over the rest. Re-run it before storing or trusting it.`];
}

/** The per-case and per-group tables `judge turn` prints after a run with `expect` cases. */
export function formatSummary(summary: ExpectSummary): string[] {
  const lines: string[] = [];
  for (const entry of summary.narrators) {
    lines.push("", `${entry.model} (${entry.narrator}), ${entry.samples_per_case} samples per case, at ${revision(summary)}`);
    const caseRows = entry.cases.map((item) => [item.id, item.ungraded ? `${item.group} (ungraded)` : item.group, ...tallyCells(item)]);
    lines.push(...table(["case", "group", ...TALLY_HEADER], caseRows));
    const groupRows = entry.groups.map((item) => [item.group, String(item.cases), ...tallyCells(item)]);
    if (groupRows.length > 0) lines.push("", ...table(["group", "cases", ...TALLY_HEADER], groupRows));
  }
  lines.push(...incompleteNote(summary));
  return lines;
}

function change(before: number | null, after: number | null): string {
  if (before === null || after === null) return "-";
  const points = Math.round((after - before) * 100);
  return points === 0 ? "0" : `${points > 0 ? "+" : ""}${points} pts`;
}

function pairRows<T extends { share: number | null }>(
  before: ReadonlyMap<string, T>,
  after: ReadonlyMap<string, T>,
  label: (key: string, item: T) => string[],
): { rows: string[][]; onlyBefore: string[]; onlyAfter: string[] } {
  const rows: string[][] = [];
  for (const [key, item] of after) {
    const old = before.get(key);
    if (old) rows.push([...label(key, item), percent(old.share), percent(item.share), change(old.share, item.share)]);
  }
  return {
    rows,
    onlyBefore: [...before.keys()].filter((key) => !after.has(key)),
    onlyAfter: [...after.keys()].filter((key) => !before.has(key)),
  };
}

function onlyLines(onlyBefore: string[], onlyAfter: string[], noun: string): string[] {
  return [
    ...(onlyBefore.length > 0 ? [`${noun} only in the baseline: ${onlyBefore.join(", ")}`] : []),
    ...(onlyAfter.length > 0 ? [`${noun} only in the run: ${onlyAfter.join(", ")}`] : []),
  ];
}

function compareNarrator(before: NarratorSummary, after: NarratorSummary): string[] {
  const lines = [`${after.model} (${after.narrator}): ${before.samples_per_case} samples per case in the baseline, ${after.samples_per_case} in the run`];
  const cases = pairRows(
    new Map(before.cases.map((item) => [item.id, item])),
    new Map(after.cases.map((item) => [item.id, item])),
    (key, item) => [key, item.ungraded ? `${item.group} (ungraded)` : item.group],
  );
  lines.push(...table(["case", "group", "baseline", "run", "change"], cases.rows), ...onlyLines(cases.onlyBefore, cases.onlyAfter, "cases"));
  const groups = pairRows(
    new Map(before.groups.map((item) => [item.group, item])),
    new Map(after.groups.map((item) => [item.group, item])),
    (key) => [key],
  );
  if (groups.rows.length > 0) lines.push("", ...table(["group", "baseline", "run", "change"], groups.rows));
  lines.push(...onlyLines(groups.onlyBefore, groups.onlyAfter, "groups"));
  return lines;
}

/** What `baseline compare` prints: per narrator and model both hold, the change in share per case and per group. */
export function formatComparison(baseline: ExpectSummary, run: ExpectSummary): string[] {
  const lines = [`baseline ${baseline.run.id} at ${revision(baseline)}; run ${run.run.id} at ${revision(run)}`];
  const key = (entry: NarratorSummary) => `${entry.narrator}\u0000${entry.model}`;
  const stored = new Map(baseline.narrators.map((entry) => [key(entry), entry]));
  for (const entry of run.narrators) {
    const before = stored.get(key(entry));
    lines.push("", ...(before ? compareNarrator(before, entry) : [`${entry.model} (${entry.narrator}): the baseline holds no result for it`]));
  }
  const ran = new Set(run.narrators.map(key));
  for (const entry of baseline.narrators.filter((item) => !ran.has(key(item)))) {
    lines.push("", `${entry.model} (${entry.narrator}): only in the baseline`);
  }
  for (const [name, summary] of [["baseline", baseline], ["run", run]] as const) {
    if (!summary.complete) lines.push(`INCOMPLETE ${name}: some samples did not run or could not be graded; its shares are over the rest.`);
  }
  return lines;
}
