/**
 * What `judge game` needs to judge several games in one run: which games a
 * command line names (`--bundle`, `--since`, or several ids and trace files),
 * and reading back what a child run wrote. The run itself is in `judge-game.ts`.
 *
 * `--bundle` and `--since` pick their games with `listSessions`, the function
 * `./dev sessions` lists with, so both commands agree on which games a date
 * covers, and `--database` is resolved the same way (a name or a file).
 */

import fs from "node:fs";
import path from "node:path";

import {
  SessionsError,
  SessionsUsageError,
  listSessions,
  parseSessionsArgs,
  resolveSessionsDatabase,
} from "../../scripts/lib/dev-sessions.mjs";
import type { OptionValue } from "../core/args.ts";
import { InputError, UsageError } from "../core/errors.ts";
import type { EvalContext } from "../core/dispatch.ts";

/** The bundle's database and call log (`docs/local-infrastructure.md`). */
const BUNDLE_DATABASE = "game.db";
const BUNDLE_CALL_LOG = "ai-calls.jsonl";

/** Games picked by `--bundle` or `--since`. */
export interface PickedGames {
  /** The session ids, in the order `./dev sessions` lists them. */
  ids: string[];
  database: string;
  /** The model-call log the games' events join to; null when there is none. */
  callLog: string | null;
  /** Where the games were looked for, for a message about finding none. */
  where: string;
}

function str(value: OptionValue): string | null {
  return typeof value === "string" ? value : null;
}

/** Where the games are: their database, the call log that goes with it, and how to say so. */
interface Source {
  database: string;
  callLog: string | null;
  where: string;
}

/** `--bundle <folder>`: the folder's `game.db`, and its call log when it has one. */
function bundleSource(bundle: string): Source {
  const folder = path.resolve(bundle);
  const database = path.join(folder, BUNDLE_DATABASE);
  if (!fs.existsSync(database)) throw new InputError(`no ${BUNDLE_DATABASE} in ${folder}: it is not a playtest bundle`);
  const log = path.join(folder, BUNDLE_CALL_LOG);
  return { database, callLog: fs.existsSync(log) ? log : null, where: `in the bundle ${folder}` };
}

/** `--since <date>`: the database `--database` names (a name or a file), else this checkout's. */
function sinceSource(since: string, database: string | null, context: EvalContext): Source {
  try {
    parseSessionsArgs(["--since", since]);
    const file = resolveSessionsDatabase(database, context);
    return { database: file, callLog: null, where: `started on or after ${since} in ${file}` };
  } catch (error) {
    if (error instanceof SessionsUsageError) throw new UsageError((error as Error).message);
    throw error;
  }
}

/** The combinations of `--bundle`, `--since`, `--database` and ids that are misuse. */
function refuseMisuse(values: Record<string, OptionValue>, positionals: readonly string[]): void {
  const picking = values.bundle === undefined ? "since" : "bundle";
  if (values.bundle !== undefined && values.since !== undefined) throw new UsageError("--bundle and --since each pick the games: use one");
  if (positionals.length > 0) throw new UsageError(`--${picking} picks the games; drop the session ids and trace files`);
  if (picking === "bundle" && values.database !== undefined) {
    throw new UsageError("--bundle names its own database, <folder>/game.db; drop --database");
  }
}

/**
 * The games `--bundle` or `--since` name, or null when neither is given.
 * A misuse is a `UsageError`, a database that cannot be read an `InputError`.
 */
export async function pickGames(
  values: Record<string, OptionValue>,
  positionals: readonly string[],
  context: EvalContext,
): Promise<PickedGames | null> {
  if (values.bundle === undefined && values.since === undefined) return null;
  refuseMisuse(values, positionals);
  const bundle = str(values.bundle);
  const since = str(values.since);
  if (bundle === null && since === null) throw new UsageError(`--${values.bundle === undefined ? "since needs a date" : "bundle needs a folder"}`);
  const source = bundle === null ? sinceSource(String(since), str(values.database), context) : bundleSource(bundle);
  try {
    const rows: Array<{ session_id: string }> = await listSessions(source.database, { since });
    return { ...source, ids: rows.map((row) => row.session_id) };
  } catch (error) {
    if (error instanceof SessionsError) throw new InputError((error as Error).message);
    throw error;
  }
}

/** The result.json a child run wrote under its output root, or null when it wrote none. */
export function findChildResult(judgeRoot: string): string | null {
  if (!fs.existsSync(judgeRoot)) return null;
  for (const entry of fs.readdirSync(judgeRoot, { withFileTypes: true })) {
    const full = path.join(judgeRoot, entry.name);
    if (entry.isFile() && entry.name === "result.json") return full;
    if (entry.isDirectory()) {
      const found = findChildResult(full);
      if (found) return found;
    }
  }
  return null;
}
