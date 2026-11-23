/**
 * What the blueprint commands read: a case file, and the brief it was written
 * for, which `generate` reads. A brief is given as a file or as a directory
 * holding `input.brief.json`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { InputError } from "../core/errors.ts";
import { slugify } from "../core/run-folder.ts";

export const STORED_BLUEPRINT = "blueprint.json";
export const STORED_BRIEF = "brief.json";
const SPEC_BRIEF = "input.brief.json";

/** Reads and parses a JSON file; a missing or malformed one is an `InputError` that says which. */
export async function readJsonFile(file: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new InputError(`cannot read ${what} ${file}: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new InputError(`${what} ${file} is not JSON: ${(error as Error).message}`);
  }
}

export interface BriefSource {
  /** The brief file, absolute. */
  file: string;
  /** Names the subject: the spec directory's name, or the brief file's without `.brief.json`. */
  slug: string;
}

/** Resolves `--brief` or `--spec`: a spec directory or a brief file. */
export async function resolveBrief(input: string): Promise<BriefSource> {
  const abs = path.resolve(input);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (error) {
    throw new InputError(`brief path not found: ${abs} (${(error as Error).message})`);
  }
  if (stat.isDirectory()) return { file: path.join(abs, SPEC_BRIEF), slug: path.basename(abs) };
  const base = path.basename(abs);
  const slug =
    base === SPEC_BRIEF ? path.basename(path.dirname(abs)) : base.replace(/\.brief\.json$/i, "").replace(/\.json$/i, "");
  return { file: abs, slug };
}

/** A subject id for a blueprint file: its name, or its folder's when it is the stored `blueprint.json`. */
export function blueprintSubjectId(blueprintFile: string): string {
  const stem = path.basename(blueprintFile).replace(/\.json$/i, "");
  return slugify(stem === "blueprint" ? path.basename(path.dirname(path.resolve(blueprintFile))) : stem);
}
