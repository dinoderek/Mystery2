/**
 * `perf report`: prints per-loop performance trends and writes the same as a
 * static page, `<output root>/perf/report.html` (`report-html.ts`). It reads only
 * `<output root>/perf.db` (`perf sync` builds it) and calls no model.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { resolveOutputRoot } from "../core/run-folder.ts";
import { ATTRIBUTE_NAMES, LOOPS, parseLoop, parseMatch, parseSince, readReport } from "./report-data.ts";
import type { ReportFilter } from "./report-data.ts";
import { renderHtml } from "./report-html.ts";
import { renderText } from "./report-text.ts";

export const REPORT_DIR = "perf";
export const REPORT_FILE = "report.html";

const HELP = formatHelp({
  usage: "perf report",
  summary: [
    "Prints per-loop performance trends from <output root>/perf.db (build it with perf sync) and writes the same as one",
    "self-contained page, <output root>/perf/report.html. Runs of a loop whose chosen suite attributes are equal share a",
    "trend line, which says what it holds fixed. A line splits into steps where the prompt or a judge's version changes;",
    "each step gives its pass rate, calls per run, and median duration, cost and tokens per call by role and model.",
    "Runs flagged not comparable, or without suite attributes, are shown apart. Reads only the index; calls no model.",
  ].join("\n"),
  options: [
    ["--loop <name>", `only one loop: ${LOOPS.join(" or ")} (default: both)`],
    ["--suite <name>", "only runs of the suite with this name"],
    ["--match <attributes>", `attributes runs must share to be on one line, comma-separated (default: all of ${ATTRIBUTE_NAMES.join(", ")})`],
    ["--since <date>", "only runs that started on or after this date, YYYY-MM-DD (UTC)"],
  ],
});

export const perfReportCommand: EvalCommand = {
  name: "perf report",
  summary: "Print performance trends per loop and write a static HTML page",
  help: HELP,
  async run(argv, context: EvalContext) {
    const { common, values } = parseCommandArgs(argv, {
      options: { loop: { type: "string" }, match: { type: "string" }, since: { type: "string" } },
      positionals: { min: 0, max: 0 },
    });
    if (common.help) {
      context.out(HELP);
      return 0;
    }
    const filter: ReportFilter = {
      loop: typeof values.loop === "string" ? parseLoop(values.loop) : null,
      suite: common.suite,
      since: typeof values.since === "string" ? parseSince(values.since) : null,
      match: parseMatch(typeof values.match === "string" ? values.match : undefined),
    };
    const outputRoot = resolveOutputRoot(common.outputRoot, context.env);
    const report = readReport(outputRoot, filter);

    const file = path.join(outputRoot, REPORT_DIR, REPORT_FILE);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, renderHtml(report));
    fs.renameSync(temporary, file);

    context.out(renderText(report).trimEnd());
    context.out(`\n[perf report] wrote ${file}`);
    return 0;
  },
};
