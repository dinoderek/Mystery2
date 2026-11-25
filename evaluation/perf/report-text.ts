/**
 * `perf report`'s text: for each loop, its trend lines, each saying what it
 * holds fixed, then its steps (a prompt and judge version) with pass rate, calls
 * per run and per-call medians by role and model, then the runs shown apart.
 * The numbers are `report-data.ts`'s.
 */

import { describeHeld } from "./report-data.ts";
import type { ApartRun, LoopReport, Report, ReportFilter, RoleModelStats, Step, TrendLine } from "./report-data.ts";

export function percent(rate: number | null): string {
  return rate === null ? "-" : `${(rate * 100).toFixed(0)}%`;
}

export function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function dollars(usd: number | null): string {
  return usd === null ? "-" : `$${usd.toFixed(4)}`;
}

export function count(value: number | null): string {
  return value === null ? "-" : Math.round(value).toLocaleString("en-US");
}

export function day(startedAt: string): string {
  return startedAt.slice(0, 10);
}

/** A step's prompt version: its place among the versions seen, and its hash. */
export function promptLabel(step: Step): string {
  const { prompt, promptSeq } = step.version;
  return prompt === null ? "unrecorded" : `#${promptSeq ?? "?"} ${prompt}`;
}

export function dates(runs: ReadonlyArray<{ startedAt: string }>): string {
  const first = day(runs[0].startedAt);
  const last = day(runs[runs.length - 1].startedAt);
  return first === last ? first : `${first} to ${last}`;
}

/** What the filter asked for, for a heading or an empty loop. */
export function describeFilter(filter: ReportFilter): string {
  const parts = [filter.suite === null ? null : `suite ${filter.suite}`, filter.since === null ? null : `since ${filter.since}`];
  const given = parts.filter((part) => part !== null);
  return given.length === 0 ? "" : ` (${given.join(", ")})`;
}

/** Two spaces in front of a line, none in front of a blank one. */
function indent(line: string): string {
  return line === "" ? "" : `  ${line}`;
}

function table(header: readonly string[], rows: ReadonlyArray<readonly string[]>): string[] {
  const widths = header.map((cell, column) => Math.max(cell.length, ...rows.map((row) => row[column].length)));
  const format = (row: readonly string[]) => `  ${row.map((cell, column) => cell.padEnd(widths[column])).join("  ").trimEnd()}`;
  return [format(header), ...rows.map(format)];
}

function roleModelRows(stats: readonly RoleModelStats[]): string[][] {
  return stats.map((each) => [each.role, each.model, String(each.calls), seconds(each.medianDurationMs), dollars(each.medianCostUsd), count(each.medianTokens)]);
}

function stepLines(step: Step, number: number): string[] {
  const judges = step.version.judges.length === 0 ? "none recorded" : step.version.judges.join(", ");
  const rates = step.judges.map((each) => `${each.judge} v${each.version ?? "?"} ${percent(each.pass / (each.pass + each.fail))} (${each.pass}/${each.pass + each.fail})`);
  return [
    `step ${number}: prompt ${promptLabel(step)}; judges ${judges}`,
    `  ${step.runs.length} run(s), ${dates(step.runs)}; pass rate ${percent(step.passRate)}; ${step.callsPerRun.toFixed(1)} calls per run`,
    ...(rates.length > 0 ? [`  judge pass rates: ${rates.join("; ")}`] : []),
    ...table(["role", "model", "calls", "duration", "cost", "tokens"], roleModelRows(step.perRoleModel)),
  ];
}

function lineLines(line: TrendLine, number: number): string[] {
  const lines = [`line ${number}: ${line.runs.length} run(s), ${dates(line.runs)}`, "  holds fixed:"];
  for (const { name, text } of describeHeld(line.held)) lines.push(`    ${name}: ${text}`);
  lines.push(`  not held fixed: ${line.free.length === 0 ? "nothing" : line.free.join(", ")}`);
  lines.push("  medians are per call; tokens are input, output and cache added up");
  line.steps.forEach((step, index) => lines.push("", ...stepLines(step, index + 1).map(indent)));
  return lines;
}

/** One reason a run is not on a line, in a row of the shown-apart table. */
export function apartRow({ run, reason }: ApartRun): string[] {
  return [run.developer, run.id, run.command, run.subjects === 0 ? "-" : percent(run.passed / run.subjects), reason];
}

function loopLines(loop: LoopReport, filter: ReportFilter): string[] {
  const heading = `${loop.loop} loop: ${loop.runCount} run(s)${describeFilter(filter)}`;
  if (loop.runCount === 0) return [heading, "  no runs"];
  const lines = [heading, `  ${loop.lines.length} trend line(s), ${loop.apart.length} run(s) shown apart`];
  loop.lines.forEach((line, index) => lines.push("", ...lineLines(line, index + 1).map(indent)));
  if (loop.apart.length > 0) {
    lines.push("", "  shown apart, on no line:", ...table(["developer", "run", "command", "pass", "why"], loop.apart.map(apartRow)).map(indent));
  }
  return lines;
}

export function renderText(report: Report): string {
  const sections = report.loops.map((loop) => loopLines(loop, report.filter).join("\n"));
  return `${sections.join("\n\n")}\n`;
}
