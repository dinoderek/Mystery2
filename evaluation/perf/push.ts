/**
 * `perf push`: sends run records to the shared data repository
 * (`data-repo.ts`). It reads `record.json` files and runs `git`; it calls no
 * model.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import { configuredDeveloper, configuredPerfRemote } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { resolveOutputRoot } from "../core/run-folder.ts";
import { osUserName } from "../core/run-identity.ts";
import { dataCloneDir, measuresNothing, publishRecords, recordPath } from "./data-repo.ts";
import type { RecordFile } from "./data-repo.ts";
import { RECORD_FILE, readRecord } from "./record.ts";

const HELP = formatHelp({
  usage: "perf push [<run>...]",
  summary: [
    "Commits run records not yet in the shared data repository (perf.remote in the eval config) and pushes",
    "them, one file per run at records/<yyyy>/<mm>/<developer>/<run>.json. With no <run> it sends every run under the",
    "output root that has a record.json; a <run> is a run folder, or its id (<date>/<time>-<command>) under the output",
    "root, and sends only it. A run whose model calls all went to stubs measures nothing and is never sent; neither is a",
    "record the repository already holds. The clone is <output root>/.perf/data. Calls no model.",
  ].join("\n"),
});

/** The run folders under `outputRoot` (`<date>/<time>-<command>`), oldest first. */
export function runFolders(outputRoot: string): string[] {
  if (!fs.existsSync(outputRoot)) return [];
  const folders: string[] = [];
  for (const day of fs.readdirSync(outputRoot).sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const dayDir = path.join(outputRoot, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const run of fs.readdirSync(dayDir).sort()) {
      if (fs.statSync(path.join(dayDir, run)).isDirectory()) folders.push(path.join(dayDir, run));
    }
  }
  return folders;
}

/** The folder a named run is: a folder as given, else its id under the output root. */
function namedFolder(name: string, outputRoot: string): string {
  const asGiven = path.resolve(name);
  const folder = fs.existsSync(asGiven) ? asGiven : path.join(outputRoot, name);
  if (!fs.existsSync(path.join(folder, RECORD_FILE))) {
    throw new InputError(`${name} has no ${RECORD_FILE}: runs from before records stay local, and a run still going has none yet`);
  }
  return folder;
}

function relativeTo(root: string, folder: string): string {
  const relative = path.relative(root, folder);
  return relative.startsWith("..") ? folder : relative;
}

/** The data repository's URL from the eval config; a usage error naming the setting when it has none. */
export function requirePerfRemote(options: { root: string; configPath: string | undefined }): string {
  const remote = configuredPerfRemote(options);
  if (!remote) {
    throw new UsageError(
      'perf.remote is not set: give the data repository\'s git URL as "remote" under the top-level "perf" key of the eval config (the committed example shows where)',
    );
  }
  return remote;
}

export interface PushSettings {
  root: string;
  configPath: string | undefined;
  outputRoot: string;
  remote: string;
  context: Pick<EvalContext, "out" | "err">;
}

/**
 * Sends the records of `folders` not yet in the data repository, saying what it
 * sent and skipped. Returns 1 when a record could not be read, else 0; a git
 * failure throws, with what git said.
 */
export function pushFolders(folders: readonly string[], { root, configPath, outputRoot, remote, context }: PushSettings): number {
  const files: RecordFile[] = [];
  const seen = new Set<string>();
  const broken: string[] = [];
  let withoutRecord = 0;
  let stubOnly = 0;
  for (const folder of folders) {
    if (!fs.existsSync(path.join(folder, RECORD_FILE))) {
      withoutRecord += 1;
      continue;
    }
    let record;
    try {
      record = readRecord(folder);
    } catch (error) {
      broken.push(`${relativeTo(outputRoot, folder)}: ${(error as Error).message}`);
      continue;
    }
    if (measuresNothing(record)) {
      stubOnly += 1;
      context.out(`[perf push] skipped ${record.run.id}: ${record.calls.length === 0 ? "it made no model call" : "every model call went to a stub"}`);
      continue;
    }
    const target = recordPath(record);
    if (seen.has(target)) continue;
    seen.add(target);
    files.push({ path: target, content: fs.readFileSync(path.join(folder, RECORD_FILE), "utf8") });
  }

  let exit = 0;
  for (const message of broken) {
    context.err(`[perf push] not sent, unreadable record: ${message}`);
    exit = 1;
  }
  if (withoutRecord > 0) context.out(`[perf push] ${withoutRecord} run folder(s) have no ${RECORD_FILE} and stay local`);

  if (files.length === 0) {
    context.out(`[perf push] nothing to send${stubOnly > 0 ? ` (${stubOnly} stub-only run(s) skipped)` : ""}`);
    return exit;
  }
  const outcome = publishRecords({
    clone: dataCloneDir(outputRoot),
    remote,
    files,
    author: configuredDeveloper({ root, configPath }) ?? osUserName(),
  });
  for (const sent of outcome.sent) context.out(`[perf push] sent ${sent}`);
  context.out(
    `[perf push] ${outcome.sent.length} sent, ${outcome.present.length} already in the data repository${stubOnly > 0 ? `, ${stubOnly} stub-only skipped` : ""}`,
  );
  return exit;
}

export const perfPushCommand: EvalCommand = {
  name: "perf push",
  summary: "Send run records to the shared data repository",
  help: HELP,
  async run(argv, context: EvalContext) {
    const { common, positionals } = parseCommandArgs(argv, { positionals: { min: 0, max: Number.MAX_SAFE_INTEGER } });
    if (common.help) {
      context.out(HELP);
      return 0;
    }
    const remote = requirePerfRemote({ root: context.root, configPath: common.configPath });
    const outputRoot = resolveOutputRoot(common.outputRoot, context.env);
    const folders = positionals.length > 0 ? positionals.map((name) => namedFolder(name, outputRoot)) : runFolders(outputRoot);
    return pushFolders(folders, { root: context.root, configPath: common.configPath, outputRoot, remote, context });
  },
};
