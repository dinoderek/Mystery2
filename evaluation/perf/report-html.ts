/**
 * `perf report`'s page: one self-contained HTML file, written to
 * `<output root>/perf/report.html`. Styles and charts are inline, nothing is
 * fetched, and there is no script. It has the text report's content (a heading
 * per loop; per trend line what it holds fixed, its steps and per-call medians;
 * the runs shown apart) and, per line, five charts over its runs in start
 * order: pass rate, calls per run, and median duration, cost and tokens per call
 * by role and model, with a dashed mark where a step starts.
 */

import { renderChart, escapeHtml as esc, SERIES_CLASSES } from "./report-chart.ts";
import type { ChartMark, ChartSeries } from "./report-chart.ts";
import { callKey, describeHeld, groupCalls, median } from "./report-data.ts";
import type { LoopReport, Report, RunData, TrendLine } from "./report-data.ts";
import { apartRow, count, dates, day, describeFilter, dollars, percent, promptLabel, seconds } from "./report-text.ts";

const COLORS_LIGHT = ["#0b6bcb", "#c2410c", "#15803d", "#7e22ce", "#b45309", "#0e7490", "#be123c", "#4d7c0f"];
const COLORS_DARK = ["#6cb6ff", "#fb923c", "#4ade80", "#c4a1ff", "#fbbf24", "#22d3ee", "#fb7185", "#a3e635"];

function palette(colors: readonly string[]): string {
  return colors.map((color, index) => `--c${index}:${color};`).join("");
}

function seriesRules(): string {
  const classes = Array.from({ length: SERIES_CLASSES }, (_, index) => index);
  return classes.map((index) => `.line.s${index}{stroke:var(--c${index})}.dot.s${index}{fill:var(--c${index})}.swatch.s${index}{background:var(--c${index})}`).join("");
}

const STYLE = `
:root{--bg:#fff;--fg:#1c2330;--muted:#5b6678;--rule:#d9dee7;--panel:#f6f8fb;${palette(COLORS_LIGHT)}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#10141c;--fg:#e6eaf2;--muted:#9aa5b8;--rule:#2b3445;--panel:#171d29;${palette(COLORS_DARK)}}}
body{margin:0;padding:24px 16px;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:960px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}h2{font-size:20px;margin:32px 0 8px}h3{font-size:16px;margin:24px 0 4px}h4{font-size:14px;margin:16px 0 4px}
p,li,dd{color:var(--muted)}.fixed{background:var(--panel);border:1px solid var(--rule);border-radius:8px;padding:8px 16px;margin:8px 0}
dl{margin:0;display:grid;grid-template-columns:max-content 1fr;gap:2px 16px}dt{font-weight:600}dd{margin:0;overflow-wrap:anywhere}
.scroll{overflow-x:auto}table{border-collapse:collapse;font-size:13px;min-width:100%}
th,td{padding:4px 12px 4px 0;text-align:left;border-bottom:1px solid var(--rule);white-space:nowrap}td.n,th.n{text-align:right}
figure{margin:12px 0}figcaption{font-weight:600;font-size:13px}svg{width:100%;height:auto;max-width:640px;display:block}
.grid{stroke:var(--rule)}.mark{stroke:var(--muted);stroke-dasharray:4 3}.tick{fill:var(--muted);font-size:10px}
.line{fill:none;stroke-width:2}.legend{list-style:none;padding:0;margin:4px 0;display:flex;flex-wrap:wrap;gap:4px 16px;font-size:12px}
.swatch{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:6px}${seriesRules()}
`;

function table(header: ReadonlyArray<{ text: string; numeric?: boolean }>, rows: ReadonlyArray<readonly string[]>): string {
  const head = header.map((cell) => `<th scope="col"${cell.numeric ? ' class="n"' : ""}>${esc(cell.text)}</th>`).join("");
  const body = rows.map((row) => `<tr>${row.map((cell, column) => `<td${header[column].numeric ? ' class="n"' : ""}>${esc(cell)}</td>`).join("")}</tr>`).join("");
  return `<div class="scroll"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function stepsTable(line: TrendLine): string {
  const rows = line.steps.map((step, index) => [
    String(index + 1),
    promptLabel(step),
    step.version.judges.length === 0 ? "none recorded" : step.version.judges.join(", "),
    String(step.runs.length),
    dates(step.runs),
    percent(step.passRate),
    step.callsPerRun.toFixed(1),
  ]);
  const header = [{ text: "step", numeric: true }, { text: "prompt" }, { text: "judges" }, { text: "runs", numeric: true }, { text: "dates" }, { text: "pass rate", numeric: true }, { text: "calls per run", numeric: true }];
  return table(header, rows);
}

function medianTable(line: TrendLine): string {
  const rows = line.steps.flatMap((step, index) =>
    step.perRoleModel.map((each) => [String(index + 1), each.role, each.model, String(each.calls), seconds(each.medianDurationMs), dollars(each.medianCostUsd), count(each.medianTokens)]),
  );
  const header = [{ text: "step", numeric: true }, { text: "role" }, { text: "model" }, { text: "calls", numeric: true }, { text: "duration", numeric: true }, { text: "cost", numeric: true }, { text: "tokens", numeric: true }];
  return table(header, rows);
}

function judgeTable(line: TrendLine): string {
  const rows = line.steps.flatMap((step, index) =>
    step.judges.map((each) => [String(index + 1), each.judge, `v${each.version ?? "?"}`, percent(each.pass / (each.pass + each.fail)), `${each.pass}/${each.pass + each.fail}`]),
  );
  if (rows.length === 0) return "<p>No judge passed or failed a verdict in these runs.</p>";
  return table([{ text: "step", numeric: true }, { text: "judge" }, { text: "version" }, { text: "pass rate", numeric: true }, { text: "pass/(pass+fail)", numeric: true }], rows);
}

/** Where each step starts among the line's runs, labelled by its prompt version. */
function marksOf(line: TrendLine): ChartMark[] {
  let index = 0;
  return line.steps.map((step, which) => {
    const mark = { index, label: `step ${which + 1}` };
    index += step.runs.length;
    return mark;
  });
}

function perRunMedians(runs: readonly RunData[], pick: (call: RunData["calls"][number]) => number | null): ChartSeries[] {
  return groupCalls(runs).map((group) => ({
    name: group.key,
    values: runs.map((run) => {
      const own = run.calls.filter((call) => callKey(call) === group.key).map(pick);
      return median(own.filter((value): value is number => value !== null));
    }),
  }));
}

function charts(line: TrendLine): string[] {
  const runs = line.runs;
  const common = { runs: runs.map((run) => `${run.id}, ${run.developer}`), marks: marksOf(line) };
  const rates = runs.map((run) => (run.subjects === 0 ? null : run.passed / run.subjects));
  return [
    renderChart({ ...common, title: "Pass rate per run", series: [{ name: "subjects passed", values: rates }], format: (value) => percent(value), max: 1 }),
    renderChart({ ...common, title: "Calls per run", series: [{ name: "model calls", values: runs.map((run) => run.calls.length) }], format: (value) => (Number.isInteger(value) ? String(value) : value.toFixed(1)) }),
    renderChart({ ...common, title: "Median duration per call, by role and model", series: perRunMedians(runs, (call) => call.durationMs), format: (value) => seconds(value) }),
    renderChart({ ...common, title: "Median cost per call, by role and model", series: perRunMedians(runs, (call) => call.costUsd), format: (value) => dollars(value) }),
    renderChart({ ...common, title: "Median tokens per call, by role and model", series: perRunMedians(runs, (call) => call.tokens), format: (value) => count(value) }),
  ].filter((chart): chart is string => chart !== null);
}

function lineSection(line: TrendLine, number: number): string {
  const held = describeHeld(line.held).map(({ name, text }) => `<dt>${esc(name)}</dt><dd>${esc(text)}</dd>`).join("");
  return [
    `<h3>Line ${number}: ${line.runs.length} run(s), ${esc(dates(line.runs))}</h3>`,
    `<div class="fixed"><p>Held fixed on this line:</p><dl>${held}</dl>`,
    `<p>Not held fixed: ${esc(line.free.length === 0 ? "nothing" : line.free.join(", "))}.</p></div>`,
    "<h4>Steps: a change of prompt or judge version starts the next</h4>",
    stepsTable(line),
    "<h4>Per call by role and model (medians; tokens are input, output and cache added up)</h4>",
    medianTable(line),
    "<h4>Judge pass rates</h4>",
    judgeTable(line),
    ...charts(line),
  ].join("\n");
}

function loopSection(loop: LoopReport, report: Report): string {
  const heading = `<h2>${esc(loop.loop)} loop: ${loop.runCount} run(s)${esc(describeFilter(report.filter))}</h2>`;
  if (loop.runCount === 0) return `${heading}\n<p>No runs.</p>`;
  const parts = [heading, `<p>${loop.lines.length} trend line(s), ${loop.apart.length} run(s) shown apart.</p>`];
  loop.lines.forEach((line, index) => parts.push(lineSection(line, index + 1)));
  if (loop.apart.length > 0) {
    const header = [{ text: "developer" }, { text: "run" }, { text: "command" }, { text: "pass rate", numeric: true }, { text: "why it is on no line" }];
    parts.push("<h3>Shown apart</h3>", table(header, loop.apart.map(apartRow)));
  }
  return parts.join("\n");
}

export function renderHtml(report: Report): string {
  const days = report.loops.flatMap((loop) => [...loop.lines.flatMap((line) => line.runs), ...loop.apart.map((each) => each.run)]).map((run) => day(run.startedAt)).sort();
  const span = days.length === 0 ? "no runs" : `runs from ${days[0]} to ${days[days.length - 1]}`;
  return [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    "<title>Evaluation performance</title>",
    `<style>${STYLE}</style></head><body><main>`,
    `<h1>Evaluation performance</h1><p>Trends per loop from <code>perf.db</code>: ${esc(span)}. Runs whose matched suite attributes are equal share a trend line.</p>`,
    ...report.loops.map((loop) => loopSection(loop, report)),
    "</main></body></html>",
    "",
  ].join("\n");
}
