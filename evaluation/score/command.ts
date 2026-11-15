/**
 * `./dev eval score <results>...`: scores stored results against the truth set
 * and names the smallest set of judges that meets a bar. It reads files only
 * and calls no model, so it reads no binding. The rules are in
 * `lib/truth/score.ts`; the help below repeats the ones a reader needs.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { reading, readResults, rounded } from "../lib/truth/inputs.ts";
import { loadTruthSet, TRUTH_ROOT } from "../lib/truth/loader.ts";
import { describeBar, LOSE_NOTHING, scoreVerdicts } from "../lib/truth/score.ts";
import type { Bar, ScoreReport } from "../lib/truth/score.ts";
import { verdictKey } from "../lib/truth/schemas.ts";
import type { StoredVerdict } from "../lib/truth/schemas.ts";
import { formatScore } from "./table.ts";

export const SCORE_FILE = "score.json";

const HELP = formatHelp({
  usage: "score <results>...",
  summary: [
    "Scores stored results against the truth set, with no model call. Each <results> is a results file, or the",
    "name of one in the truth set's results/. Per judge (one judge on one model) and kind it reports, of the units",
    "it reported, the share that are real faults, and of the real faults, the share it found, each with a 95%",
    "Wilson range; units of unknown truth are in neither share and are counted apart. A finding of either",
    "severity, minor or major, is a report; the same counts for major findings alone are shown beside.",
    "",
    "A judge catches a unit when most of the samples that judged (pass or fail) catch it; a tie is not a catch.",
    "Agreement is the share of units with two or more such samples on which all agree; unmeasured with one.",
    "",
    "On each side (blueprint, game), every subset of the judges present is scored: it catches the union of what",
    "its judges catch. Delay is, per stored game or blueprint, the slowest judge's time (summed over turns,",
    "averaged over samples), summed; usage is the judges' reported costs, averaged over samples the same way and",
    "summed. Either is unknown if any part is. The smallest subset meeting the bar wins; ties go to the shorter",
    "delay, then the lower usage, unknown last.",
    "Above 16 judges on a side the command stops. Prints the tables and writes the same report as JSON.",
  ].join("\n"),
  options: [
    ["--truth <dir>", `the truth set (default: ${TRUTH_ROOT})`],
    ["--out <file>", `where the JSON report is written (default: ${SCORE_FILE} in a new run folder under the output root)`],
    ["--min-found <share>", `the bar: find at least this share, 0 to 1, of the side's real faults (default: ${describeBar(LOSE_NOTHING)})`],
  ],
});

function parseBar(value: unknown): Bar {
  if (typeof value !== "string") return LOSE_NOTHING;
  const share = Number(value);
  if (value.trim() === "" || !Number.isFinite(share) || share < 0 || share > 1) {
    throw new UsageError(`--min-found takes a share from 0 to 1, got "${value}"`);
  }
  return { kind: "min_found", share };
}

/** Every verdict once: the same subject, judge, model and sample in two files is an error. */
function merge(files: readonly { file: string; verdicts: StoredVerdict[] }[], shown: (file: string) => string): StoredVerdict[] {
  const from = new Map<string, string>();
  const verdicts: StoredVerdict[] = [];
  for (const { file, verdicts: own } of files) {
    for (const verdict of own) {
      const key = verdictKey(verdict);
      const earlier = from.get(key);
      if (earlier !== undefined) {
        throw new InputError(`${shown(file)}: ${verdict.judge} with ${verdict.model}, sample ${verdict.sample}, on ${JSON.stringify(verdict.subject)} is also in ${shown(earlier)}`);
      }
      from.set(key, file);
      verdicts.push(verdict);
    }
  }
  return verdicts;
}

/** Writes the JSON report to `out`, naming what was scored. `./dev eval suite` writes the same. */
export function writeScoreFile(out: string, report: ScoreReport, inputs: { truth: string; results: string[] }): void {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const file = { schema_version: report.schema_version, inputs, rules: report.rules, sides: report.sides };
  fs.writeFileSync(out, `${JSON.stringify(file, rounded, 2)}\n`, "utf8");
}

export const scoreCommand: EvalCommand = {
  name: "score",
  summary: "Score stored results against the truth set; every subset of judges, and the smallest",
  help: HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: { truth: { type: "string" }, out: { type: "string" }, "min-found": { type: "string" } },
      positionals: { min: 1, max: Number.POSITIVE_INFINITY },
    });
    const bar = parseBar(values["min-found"]);
    const truthRoot = typeof values.truth === "string" ? path.resolve(values.truth) : path.join(context.root, TRUTH_ROOT);
    const shown = (file: string) => path.relative(context.root, file).split(path.sep).join("/");
    const set = await reading(() => loadTruthSet(truthRoot));
    const files = [];
    for (const arg of positionals) files.push(await readResults(set, arg));
    const report = scoreVerdicts(set, merge(files, shown), bar);
    const inputs = { truth: shown(truthRoot), results: files.map(({ file }) => shown(file)) };

    const out =
      typeof values.out === "string"
        ? path.resolve(values.out)
        : path.join(
            createRunFolder({ outputRoot: resolveOutputRoot(common.outputRoot, context.env), command: "score", argv, root: context.root, bindings: [] }).dir,
            SCORE_FILE,
          );
    writeScoreFile(out, report, inputs);
    context.out(formatScore(report, inputs));
    context.out(`\nWrote ${out}`);
    return 0;
  },
};
