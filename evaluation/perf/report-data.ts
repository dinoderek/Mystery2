/**
 * What `perf report` says, as data: runs read from `perf.db`, grouped into trend
 * lines, and each line's steps and per-call medians. The text and the page
 * (`report-text.ts`, `report-html.ts`) only print it. Nothing here writes, and
 * nothing calls a model.
 *
 * A **trend line** is the runs of one loop whose chosen suite attributes
 * (`--match`) are equal, in start order. A **step** is a stretch of consecutive
 * runs of a line with the same prompt version and the same judge versions: a
 * change of either starts the next step. A run is **shown apart**, on no line,
 * when it is flagged not comparable or the index holds no suite attributes for
 * it (a run from before they were recorded).
 *
 * Pass rate is passed subjects over subjects; a judge's, its `pass` verdicts
 * over its `pass` and `fail` ones. Tokens per call is the sum of the four counts
 * (`perf push` sends them apart; this is their total). A call without cost or
 * tokens is left out of that median, not counted as zero.
 */

import fs from "node:fs";
import path from "node:path";

import { openDatabase } from "../../packages/game-engine/src/db/client.ts";
import type { SqlValue } from "../../packages/game-engine/src/db/client.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { canonicalJson, SuiteAttributesSchema } from "../core/suite-attributes.ts";
import type { SuiteAttributes } from "../core/suite-attributes.ts";
import { INDEX_FILE, LOOPS } from "./index-db.ts";
import type { Loop } from "./index-db.ts";

export { LOOPS };
export type { Loop };

/** The suite attributes a trend line can hold fixed, as `run.attributes` names them. */
export const ATTRIBUTE_NAMES = ["command", "options", "inputs", "judges", "models", "samples", "concurrency", "suite"] as const satisfies ReadonlyArray<keyof SuiteAttributes>;
export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

export interface ReportFilter {
  loop: Loop | null;
  suite: string | null;
  /** `YYYY-MM-DD`: only runs that started on or after it (UTC). */
  since: string | null;
  match: readonly AttributeName[];
}

export interface CallData {
  role: string;
  model: string | null;
  durationMs: number;
  costUsd: number | null;
  /** The four token counts added up; null when the call recorded none. */
  tokens: number | null;
}

export interface VerdictData {
  id: string;
  tier: string;
  status: string;
  version: number | null;
}

export interface RunData {
  id: string;
  developer: string;
  command: string;
  loop: Loop;
  startedAt: string;
  comparable: boolean;
  treeClean: boolean | null;
  /** The loop's prompt version, and its place among the versions seen: the generator's for blueprints, the narrator's for narration. */
  prompt: string | null;
  promptSeq: number | null;
  /** Null for a run indexed without suite attributes, or whose stored attributes cannot be read. */
  attributes: SuiteAttributes | null;
  subjects: number;
  passed: number;
  calls: CallData[];
  verdicts: VerdictData[];
}

/** A version of the code under test: what a step is told apart by. */
export interface StepVersion {
  prompt: string | null;
  promptSeq: number | null;
  /** `<judge> v<n>` for each judge version the step's runs recorded, sorted. */
  judges: string[];
}

export interface RoleModelStats {
  role: string;
  model: string;
  calls: number;
  medianDurationMs: number;
  /** Null when no call of the group recorded a cost. */
  medianCostUsd: number | null;
  medianTokens: number | null;
}

export interface JudgeStats {
  judge: string;
  version: number | null;
  pass: number;
  fail: number;
}

export interface Step {
  version: StepVersion;
  runs: RunData[];
  passRate: number | null;
  callsPerRun: number;
  perRoleModel: RoleModelStats[];
  judges: JudgeStats[];
}

export interface TrendLine {
  /** The attributes held fixed, as the first run recorded them. */
  held: ReadonlyArray<{ name: AttributeName; value: unknown }>;
  /** The attributes this line does not hold fixed, so its runs may differ on them. */
  free: readonly AttributeName[];
  runs: RunData[];
  steps: Step[];
}

export interface ApartRun {
  run: RunData;
  reason: string;
}

export interface LoopReport {
  loop: Loop;
  runCount: number;
  lines: TrendLine[];
  apart: ApartRun[];
}

export interface Report {
  filter: ReportFilter;
  loops: LoopReport[];
}

/** `--match`'s value: attribute names, separated by commas. */
export function parseMatch(text: string | undefined): AttributeName[] {
  if (text === undefined) return [...ATTRIBUTE_NAMES];
  const names = text.split(",").map((each) => each.trim());
  const unknown = names.filter((name) => !(ATTRIBUTE_NAMES as readonly string[]).includes(name));
  if (names.length === 0 || unknown.length > 0) {
    throw new UsageError(`--match takes attribute names separated by commas (${ATTRIBUTE_NAMES.join(", ")}); got "${text}"`);
  }
  return ATTRIBUTE_NAMES.filter((name) => names.includes(name));
}

/** `--since`'s value: a calendar date, `YYYY-MM-DD`. */
export function parseSince(text: string): string {
  const date = new Date(`${text}T00:00:00Z`);
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
  if (!valid) throw new UsageError(`--since takes a date as YYYY-MM-DD; got "${text}"`);
  return text;
}

export function parseLoop(text: string): Loop {
  if (!(LOOPS as readonly string[]).includes(text)) throw new UsageError(`--loop takes ${LOOPS.join(" or ")}; got "${text}"`);
  return text as Loop;
}

function readAttributes(text: unknown): SuiteAttributes | null {
  if (typeof text !== "string") return null;
  try {
    const parsed = SuiteAttributesSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function sum(...counts: unknown[]): number | null {
  if (counts.every((count) => count === null)) return null;
  return counts.reduce<number>((total, count) => total + (typeof count === "number" ? count : 0), 0);
}

interface Selection {
  where: string;
  params: SqlValue[];
}

function selection(filter: ReportFilter): Selection {
  const clauses: string[] = [];
  const params: SqlValue[] = [];
  const add = (clause: string, value: SqlValue) => {
    clauses.push(clause);
    params.push(value);
  };
  if (filter.loop !== null) add("loop = ?", filter.loop);
  if (filter.suite !== null) add("suite = ?", filter.suite);
  if (filter.since !== null) add("started_at >= ?", filter.since);
  return { where: clauses.length > 0 ? `where ${clauses.join(" and ")}` : "", params };
}

/** Every run of the index the filter keeps, with its subjects' pass count, calls and verdicts, in start order. */
export function readRuns(indexFile: string, filter: ReportFilter): RunData[] {
  if (!fs.existsSync(indexFile)) {
    throw new InputError(`there is no index at ${indexFile}: run ./dev eval perf sync first`);
  }
  const { where, params } = selection(filter);
  const db = openDatabase({ path: indexFile, readonly: true });
  try {
    const rows = db.prepare(`select * from runs ${where} order by started_at, developer, run_id`).all(...params);
    const scope = `run in (select run from runs ${where})`;
    const byRun = <T>(table: string, order: string, make: (row: Record<string, unknown>) => T) => {
      const grouped = new Map<number, T[]>();
      for (const row of db.prepare(`select * from ${table} where ${scope} order by run, ${order}`).all(...params)) {
        const list = grouped.get(row.run as number) ?? [];
        list.push(make(row));
        grouped.set(row.run as number, list);
      }
      return grouped;
    };
    const calls = byRun<CallData>("calls", "n", (row) => ({
      role: row.role as string,
      model: row.model as string | null,
      durationMs: row.duration_ms as number,
      costUsd: row.cost_usd as number | null,
      tokens: sum(row.tokens_input, row.tokens_output, row.tokens_cache_read, row.tokens_cache_write),
    }));
    const verdicts = byRun<VerdictData>("verdicts", "n", (row) => ({ id: row.verdict as string, tier: row.tier as string, status: row.status as string, version: row.judge_version as number | null }));
    const subjects = byRun<boolean>("subjects", "position", (row) => row.passed === 1);
    return rows.map((row) => {
      const loop = row.loop as Loop;
      const own = subjects.get(row.run as number) ?? [];
      return {
        id: row.run_id as string,
        developer: row.developer as string,
        command: row.command as string,
        loop,
        startedAt: row.started_at as string,
        comparable: row.comparable === 1,
        treeClean: row.tree_clean === null ? null : row.tree_clean === 1,
        prompt: (loop === "blueprint" ? row.generator_prompt : row.narrator_prompt) as string | null,
        promptSeq: (loop === "blueprint" ? row.generator_prompt_seq : row.narrator_prompt_seq) as number | null,
        attributes: readAttributes(row.attributes),
        subjects: own.length,
        passed: own.filter(Boolean).length,
        calls: calls.get(row.run as number) ?? [],
        verdicts: verdicts.get(row.run as number) ?? [],
      };
    });
  } finally {
    db.close();
  }
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function present(values: ReadonlyArray<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

/** Why a run is on no trend line; null when it can be. */
function apartReason(run: RunData): string | null {
  if (!run.comparable) return run.treeClean === true ? "a judge gave a verdict with no recorded version" : "the tree was not known to be clean";
  if (run.attributes === null) return "no suite attributes recorded";
  return null;
}

function versionOf(run: RunData): StepVersion {
  const judges = new Set<string>();
  for (const verdict of run.verdicts) if (verdict.version !== null) judges.add(`${verdict.id} v${verdict.version}`);
  return { prompt: run.prompt, promptSeq: run.promptSeq, judges: [...judges].sort() };
}

function sameVersion(a: StepVersion, b: StepVersion): boolean {
  return a.prompt === b.prompt && a.judges.join("\n") === b.judges.join("\n");
}

function judgeStats(runs: readonly RunData[]): JudgeStats[] {
  const byJudge = new Map<string, JudgeStats>();
  for (const verdict of runs.flatMap((run) => run.verdicts)) {
    if (verdict.tier !== "judge" || (verdict.status !== "pass" && verdict.status !== "fail")) continue;
    const key = `${verdict.id}\n${verdict.version}`;
    const stats = byJudge.get(key) ?? { judge: verdict.id, version: verdict.version, pass: 0, fail: 0 };
    stats[verdict.status] += 1;
    byJudge.set(key, stats);
  }
  return [...byJudge.values()].sort((a, b) => a.judge.localeCompare(b.judge) || (a.version ?? 0) - (b.version ?? 0));
}

export interface CallGroup {
  key: string;
  role: string;
  model: string;
  calls: CallData[];
}

/** The group a call belongs to: its role and model. */
export function callKey(call: CallData): string {
  return `${call.role} · ${call.model ?? "unknown model"}`;
}

/** The calls of `runs`, grouped by role and model, in role then model order. */
export function groupCalls(runs: readonly RunData[]): CallGroup[] {
  const groups = new Map<string, CallGroup>();
  for (const call of runs.flatMap((run) => run.calls)) {
    const key = callKey(call);
    const group = groups.get(key) ?? { key, role: call.role, model: call.model ?? "unknown model", calls: [] };
    group.calls.push(call);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}

function roleModelStats(runs: readonly RunData[]): RoleModelStats[] {
  return groupCalls(runs).map(({ role, model, calls }) => ({
    role,
    model,
    calls: calls.length,
    medianDurationMs: median(calls.map((call) => call.durationMs)) as number,
    medianCostUsd: median(present(calls.map((call) => call.costUsd))),
    medianTokens: median(present(calls.map((call) => call.tokens))),
  }));
}

function makeStep(version: StepVersion, runs: RunData[]): Step {
  const subjects = runs.reduce((total, run) => total + run.subjects, 0);
  return {
    version,
    runs,
    passRate: subjects === 0 ? null : runs.reduce((total, run) => total + run.passed, 0) / subjects,
    callsPerRun: runs.reduce((total, run) => total + run.calls.length, 0) / runs.length,
    perRoleModel: roleModelStats(runs),
    judges: judgeStats(runs),
  };
}

/** Consecutive runs with one version are one step; a change of version starts the next. */
function stepsOf(runs: readonly RunData[]): Step[] {
  const steps: Step[] = [];
  let current: { version: StepVersion; runs: RunData[] } | null = null;
  for (const run of runs) {
    const version = versionOf(run);
    if (current !== null && sameVersion(current.version, version)) {
      current.runs.push(run);
      continue;
    }
    if (current !== null) steps.push(makeStep(current.version, current.runs));
    current = { version, runs: [run] };
  }
  if (current !== null) steps.push(makeStep(current.version, current.runs));
  return steps;
}

/** The runs of a loop on trend lines, grouped by the matched attributes' values, lines in the order their first run started. */
function linesOf(runs: readonly RunData[], match: readonly AttributeName[]): TrendLine[] {
  const groups = new Map<string, RunData[]>();
  for (const run of runs) {
    const attributes = run.attributes as SuiteAttributes;
    const key = canonicalJson(match.map((name) => attributes[name]));
    groups.set(key, [...(groups.get(key) ?? []), run]);
  }
  return [...groups.values()].map((group) => {
    const attributes = group[0].attributes as SuiteAttributes;
    return {
      held: match.map((name) => ({ name, value: attributes[name] })),
      free: ATTRIBUTE_NAMES.filter((name) => !match.includes(name)),
      runs: group,
      steps: stepsOf(group),
    };
  });
}

export function buildReport(runs: readonly RunData[], filter: ReportFilter): Report {
  const loops = (filter.loop === null ? LOOPS : [filter.loop]).map((loop): LoopReport => {
    const own = runs.filter((run) => run.loop === loop);
    const apart: ApartRun[] = [];
    const together: RunData[] = [];
    for (const run of own) {
      const reason = apartReason(run);
      if (reason === null) together.push(run);
      else apart.push({ run, reason });
    }
    return { loop, runCount: own.length, lines: linesOf(together, filter.match), apart };
  });
  return { filter, loops };
}

/** The report of the index under an output root. */
export function readReport(outputRoot: string, filter: ReportFilter): Report {
  return buildReport(readRuns(path.join(outputRoot, INDEX_FILE), filter), filter);
}

/** What a line holds fixed, one `name: value` per attribute, for a person to read. */
export function describeHeld(held: TrendLine["held"]): Array<{ name: AttributeName; text: string }> {
  return held.map(({ name, value }) => ({ name, text: describeValue(name, value) }));
}

function describeValue(name: AttributeName, value: unknown): string {
  if (value === null) return "none";
  if (name === "inputs") {
    const inputs = value as SuiteAttributes["inputs"];
    return inputs.length === 0 ? "none" : inputs.map((input) => `${input.id}#${input.hash ?? "unread"}`).join(", ");
  }
  if (name === "models") {
    const entries = Object.entries(value as SuiteAttributes["models"]).filter(([, labels]) => labels !== null);
    return entries.length === 0 ? "none" : entries.map(([role, labels]) => `${role}=${(labels as string[]).join("+")}`).join(", ");
  }
  if (name === "options") {
    const entries = Object.entries(value as SuiteAttributes["options"]);
    return entries.length === 0 ? "none" : entries.map(([option, each]) => `${option}=${String(each)}`).join(", ");
  }
  if (Array.isArray(value)) return value.length === 0 ? "none" : value.join(", ");
  return String(value);
}
