/**
 * `perf sync`: fetches the data repository and rebuilds the local index,
 * `<output root>/perf.db` (`index-db.ts`), from the run folders under the
 * output root and everyone's records (`sources.ts`). It calls no model.
 */

import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import { configuredDeveloper, configuredPerfRemote } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { resolveOutputRoot } from "../core/run-folder.ts";
import { osUserName } from "../core/run-identity.ts";
import { dataCloneDir, fetchRecords } from "./data-repo.ts";
import { buildIndex, INDEX_FILE, loopOf } from "./index-db.ts";
import type { IndexedRun } from "./index-db.ts";
import type { RunRecord } from "./record.ts";
import { collectLocal, collectShared, runKey } from "./sources.ts";

const HELP = formatHelp({
  usage: "perf sync",
  summary: [
    "Fetches the shared data repository (perf.remote in the eval config) and rebuilds <output root>/perf.db from the",
    "run folders under the output root plus everyone's records. A run in both places is indexed once, by developer and",
    "run id. Only generate, judge blueprint, judge turn, play and judge game runs are indexed. Without perf.remote, or",
    "when the fetch fails, it builds from the run folders and the last fetch and says so. A run folder or record it",
    "cannot read is reported by path and skipped, and the exit code is 1. Deleting perf.db and syncing again gives",
    "the same rows. Calls no model.",
  ].join("\n"),
});

/** Fetches the clone; says why when it cannot, and the index is built from what is there. */
function fetchClone(clone: string, remote: string | null, context: EvalContext): void {
  if (remote === null) {
    context.out("[perf sync] perf.remote is not set: nothing fetched; indexing the run folders and the last fetch");
    return;
  }
  try {
    fetchRecords(clone, remote);
  } catch (error) {
    context.err(`[perf sync] could not fetch ${remote}: ${(error as Error).message}\n[perf sync] indexing the run folders and the last fetch`);
  }
}

/** Each run once: a record found in both places is the local one, marked `both`. */
function merge(local: readonly RunRecord[], shared: readonly RunRecord[]): { runs: IndexedRun[]; other: number } {
  const byKey = new Map<string, IndexedRun>();
  let other = 0;
  for (const record of local) {
    if (loopOf(record.run.command) === null) other += 1;
    else byKey.set(runKey(record), { record, source: "local" });
  }
  for (const record of shared) {
    const found = byKey.get(runKey(record));
    if (found) found.source = "both";
    else if (loopOf(record.run.command) === null) other += 1;
    else byKey.set(runKey(record), { record, source: "shared" });
  }
  return { runs: [...byKey.values()], other };
}

export const perfSyncCommand: EvalCommand = {
  name: "perf sync",
  summary: "Rebuild the local performance index from run folders and fetched records",
  help: HELP,
  async run(argv, context: EvalContext) {
    const { common } = parseCommandArgs(argv, { positionals: { min: 0, max: 0 } });
    if (common.help) {
      context.out(HELP);
      return 0;
    }
    const location = { root: context.root, configPath: common.configPath };
    const outputRoot = resolveOutputRoot(common.outputRoot, context.env);
    const clone = dataCloneDir(outputRoot);
    fetchClone(clone, configuredPerfRemote(location), context);

    const local = await collectLocal(outputRoot, configuredDeveloper(location) ?? osUserName());
    const shared = collectShared(clone);
    const { runs, other } = merge(local.records, shared.records);
    const file = path.join(outputRoot, INDEX_FILE);
    const counts = buildIndex(file, runs);

    const problems = [...local.problems, ...shared.problems];
    for (const problem of problems) context.err(`[perf sync] skipped, unreadable: ${problem.path}: ${problem.message}`);
    const count = (source: IndexedRun["source"]) => runs.filter((run) => run.source === source).length;
    context.out(
      `[perf sync] indexed ${counts.runs} run(s) (${count("local")} local, ${count("shared")} shared, ${count("both")} in both): ${counts.subjects} subject(s), ${counts.calls} call(s), ${counts.verdicts} verdict(s) in ${file}`,
    );
    if (other > 0) context.out(`[perf sync] ${other} run(s) of other commands are not indexed`);
    return problems.length > 0 ? 1 : 0;
  },
};
