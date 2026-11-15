/**
 * What the commands that read stored results (`score`, `compare`) share:
 * turning a results argument into verdicts checked against the truth set, and
 * writing a report as the same JSON every time.
 */

import fs from "node:fs";
import path from "node:path";

import { InputError } from "../../core/errors.ts";
import { readResultsFile } from "./loader.ts";
import type { TruthSet } from "./loader.ts";
import { TRUTH_ID, TruthFileError } from "./schemas.ts";
import type { StoredVerdict } from "./schemas.ts";

/** Runs `read`, turning a truth-set file error into an input error, which exits 1. */
export async function reading<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof TruthFileError) throw new InputError(error.message);
    throw error;
  }
}

/** A results file, else a results name in the set. */
export async function readResults(set: TruthSet, arg: string): Promise<{ file: string; verdicts: StoredVerdict[] }> {
  const file = path.resolve(arg);
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return { file, verdicts: await reading(() => readResultsFile(set, file)) };
  const named = TRUTH_ID.test(arg) ? set.results.find((results) => results.id === arg) : undefined;
  if (named) return { file: named.file, verdicts: named.verdicts };
  throw new InputError(`no results file at ${file}, and no results named "${arg}" in ${path.join(set.root, "results")}`);
}

/** Numbers as a report stores them: fractions to six places, so the file reads and compares cleanly. */
export function rounded(_key: string, value: unknown): unknown {
  return typeof value === "number" && !Number.isInteger(value) ? Number(value.toFixed(6)) : value;
}
