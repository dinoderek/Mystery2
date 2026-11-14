/**
 * `./dev eval report <run>`: the HTML report of a self-play run.
 *
 * `play` writes `report.html` into its run folder at the end of every run; this
 * rebuilds it from what is on disk, for a run graded again by hand afterwards.
 * The run is a folder, or a run id (`<date>/<time>-play`) under the output root.
 * It reads the folder's run.json and each game's result.json, events.json,
 * steps.jsonl and, when the games were graded, readability.json. See
 * evaluation/playtest/README.md.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { EvalCommand } from "../core/dispatch.ts";
import { InputError } from "../core/errors.ts";
import { resolveOutputRoot } from "../core/run-folder.ts";
import { writeReport } from "./lib/report-page.ts";

const HELP = formatHelp({
  usage: "report <run folder>",
  summary:
    "Writes report.html into a self-play run folder: every game's transcript on one page, with each judge\n" +
    "finding beside the turn it cites. The run is a folder, or a run id under the output root.",
});

/** The run folder the argument names: a folder, else a run id under the output root. */
function locateRun(arg: string, outputRoot: string): string {
  for (const candidate of [path.resolve(arg), path.join(outputRoot, arg)]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  throw new InputError(`no run folder at ${path.resolve(arg)} or under ${outputRoot}`);
}

export const reportCommand: EvalCommand = {
  name: "report",
  summary: "Write the HTML report of a self-play run",
  help: HELP,
  async run(argv, context) {
    const { common, positionals } = parseCommandArgs(argv, { positionals: { min: 1, max: 1 } });
    const runDir = locateRun(positionals[0], resolveOutputRoot(common.outputRoot, context.env));
    const file = await writeReport(runDir, { repoRoot: context.root });
    context.out(`Wrote ${path.relative(process.cwd(), file)}`);
    return 0;
  },
};
