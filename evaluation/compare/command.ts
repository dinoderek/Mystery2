/**
 * `./dev eval compare <results A> <results B>`: a paired comparison of two
 * stored runs over the same subjects. It reads files only and calls no model,
 * so it reads no binding. The rules are in `lib/truth/compare.ts`; the help
 * below repeats the ones a reader needs.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { compareRuns, SIGNIFICANCE, TEST_NAME } from "../lib/truth/compare.ts";
import { reading, readResults, rounded } from "../lib/truth/inputs.ts";
import { loadTruthSet, TRUTH_ROOT } from "../lib/truth/loader.ts";
import { formatCompare } from "./table.ts";

export const COMPARE_FILE = "compare.json";

const HELP = formatHelp({
  usage: "compare <results A> <results B>",
  summary: [
    "Compares two stored runs over the same subjects, with no model call. Each <results> is a results file, or the",
    "name of one in the truth set's results/. Per judge (one judge on one model, the same in both runs) and kind it",
    "pairs the units both runs judged and reports whether the runs differ by more than their own samples vary.",
    "Units, and judges, only one run judged are listed and left out. Each run's delay and usage are beside each judge,",
    "over the stored games or blueprints both runs judged it on.",
    "",
    "A run catches a unit when most of its judging samples do; a tie is not a catch. A difference is a unit one run",
    "catches and the other does not. It is firm only when each run's own samples are unanimous on that unit; when a",
    "run's samples disagree on it, the difference is within variation. A unit is compared on the first n samples both",
    "runs have, so a run with more samples is not favoured; with one judging sample in either run, its difference is",
    "unmeasured.",
    "",
    `The paired test: ${TEST_NAME}. It takes the firm differences, units only A catches against units only B catches,`,
    `and gives the chance of a split at least as uneven if each were equally likely to go either way; ${SIGNIFICANCE}`,
    "or less is \"differs\". When either run has one sample on every paired unit of a kind, the variation is unmeasured:",
    "the differences are listed and none is ever called. Each judge and kind is tested alone, so with many a false",
    "\"differs\" is to be expected. Prints the tables and writes the same report as JSON.",
  ].join("\n"),
  options: [
    ["--truth <dir>", `the truth set (default: ${TRUTH_ROOT})`],
    ["--out <file>", `where the JSON report is written (default: ${COMPARE_FILE} in a new run folder under the output root)`],
  ],
});

export const compareCommand: EvalCommand = {
  name: "compare",
  summary: "Compare two stored runs, paired on the units both judged, against their own variation",
  help: HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: { truth: { type: "string" }, out: { type: "string" } },
      positionals: { min: 2, max: 2 },
    });
    const truthRoot = typeof values.truth === "string" ? path.resolve(values.truth) : path.join(context.root, TRUTH_ROOT);
    const shown = (file: string) => path.relative(context.root, file).split(path.sep).join("/");
    const set = await reading(() => loadTruthSet(truthRoot));
    const a = await readResults(set, positionals[0]);
    const b = await readResults(set, positionals[1]);
    const report = compareRuns(set, a.verdicts, b.verdicts);
    const inputs = { truth: shown(truthRoot), a: shown(a.file), b: shown(b.file) };

    const out =
      typeof values.out === "string"
        ? path.resolve(values.out)
        : path.join(
            createRunFolder({ outputRoot: resolveOutputRoot(common.outputRoot, context.env), command: "compare", argv, root: context.root, bindings: [] }).dir,
            COMPARE_FILE,
          );
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const file = { schema_version: report.schema_version, inputs, rules: report.rules, sides: report.sides };
    fs.writeFileSync(out, `${JSON.stringify(file, rounded, 2)}\n`, "utf8");
    context.out(formatCompare(report, inputs));
    context.out(`\nWrote ${out}`);
    return 0;
  },
};
