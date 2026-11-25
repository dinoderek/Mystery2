/**
 * What `perf sync` indexes: the records of the run folders under an output root
 * (their own `record.json`, else one built from the results, as `finish()`
 * builds it) and the records fetched into the data repository's clone. It reads
 * files and calls no model.
 *
 * A folder that is not a run folder (the old `suites/*` and the older layouts,
 * whose results carry another schema) is skipped silently. A run folder or
 * record that cannot be read is returned as a problem, by path, once.
 */

import fs from "node:fs";
import path from "node:path";

import { RESULT_FILE, RUN_INDEX, recordFromFolder } from "../core/run-folder.ts";
import { RECORD_FILE, RunRecordSchema, readRecord } from "./record.ts";
import type { RunRecord } from "./record.ts";
import { RECORDS_DIR } from "./data-repo.ts";
import { relativeTo, runFolders } from "./run-folders.ts";

export interface Problem {
  path: string;
  message: string;
}

export interface Collected {
  records: RunRecord[];
  problems: Problem[];
}

/** The key a run is told apart by across machines: developer and run id together. */
export function runKey(record: Pick<RunRecord, "run">): string {
  return `${record.run.developer}\n${record.run.id}`;
}

/** True when the folder is a run folder of this format: it has a `run.json` or `record.json`, or a subject whose `result.json` names a result schema (an unparsable one is a run's, and is reported). */
function isRunFolder(folder: string): boolean {
  if (fs.existsSync(path.join(folder, RUN_INDEX)) || fs.existsSync(path.join(folder, RECORD_FILE))) return true;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name, RESULT_FILE);
    if (!entry.isDirectory() || !fs.existsSync(file)) continue;
    try {
      const version = (JSON.parse(fs.readFileSync(file, "utf8")) as { schema_version?: unknown }).schema_version;
      if (typeof version === "string" && version.startsWith("mystery-eval-result/")) return true;
    } catch {
      return true;
    }
  }
  return false;
}

/** The records of the run folders under `outputRoot`, oldest first; `localDeveloper` stands in for a run that recorded none. */
export async function collectLocal(outputRoot: string, localDeveloper: string): Promise<Collected> {
  const collected: Collected = { records: [], problems: [] };
  for (const folder of runFolders(outputRoot)) {
    try {
      if (!isRunFolder(folder)) continue;
      collected.records.push(fs.existsSync(path.join(folder, RECORD_FILE)) ? readRecord(folder) : await recordFromFolder(folder, localDeveloper));
    } catch (error) {
      collected.problems.push({ path: relativeTo(outputRoot, folder), message: (error as Error).message });
    }
  }
  return collected;
}

/** The `.json` files under `dir`, as paths below it, in name order. */
function jsonFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...jsonFiles(full));
    else if (entry.name.endsWith(".json")) found.push(full);
  }
  return found;
}

/** The records in the data repository's clone, as the last fetch left them; none when there is no clone yet. */
export function collectShared(clone: string): Collected {
  const collected: Collected = { records: [], problems: [] };
  const dir = path.join(clone, RECORDS_DIR);
  if (!fs.existsSync(dir)) return collected;
  for (const file of jsonFiles(dir)) {
    try {
      collected.records.push(RunRecordSchema.parse(JSON.parse(fs.readFileSync(file, "utf8"))));
    } catch (error) {
      collected.problems.push({ path: `data repository: ${path.relative(clone, file)}`, message: (error as Error).message });
    }
  }
  return collected;
}
