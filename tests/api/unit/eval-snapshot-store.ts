// Stored snapshots for the evaluation harnesses: what each judge, the
// generator and the investigator are sent, and the verdicts the harnesses
// reach on stub bindings.
//
// A mismatch is always a failure. Files change only when a run is recorded on
// purpose: `npm run test:snapshots:record` rewrites the whole set.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect } from "vitest";

export const SNAPSHOT_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "snapshots",
  "evaluation",
);

export const RECORDING = process.env.EVAL_SNAPSHOT_RECORD === "1";

/** Snapshot files kept for one prompt. */
export interface PromptParts {
  /** The system prompt as sent. */
  system: string;
  /** The user message as sent. */
  user: string;
  /** The command line, when the prompt travels in it, with the system prompt left out. */
  args?: string[];
}

/** What stands, in a judge's own file, for a field its family's shared file holds. */
export const SHARED = "<shared>";

/** The files that hold every prompt, by path under SNAPSHOT_ROOT. */
export interface PromptSnapshot {
  /** Each prompt's own files, by prompt id. */
  own: Map<string, Record<string, string>>;
  /** Each judge family's shared payload, one file per family. */
  shared: Record<string, string>;
}

/**
 * The files that hold the prompts, by path under SNAPSHOT_ROOT.
 *
 * A user message that is compact JSON is kept indented, one field to a line,
 * so a change reads as a diff; any other message is kept as it is.
 *
 * A judge's message names its `dimension_id`, which must be the last part of
 * its prompt id (`<family>.<dimension>`). The judges of one family are sent
 * the same case, so an object field every one of them is sent unchanged is
 * kept once, in `<family>.shared.json`, and stands as `"<shared>"` in each
 * judge's own file. Putting the shared fields back and reading the result as
 * compact JSON gives the bytes that were sent.
 */
export function promptSnapshot(prompts: ReadonlyMap<string, PromptParts>): PromptSnapshot {
  const families = new Map<string, string[]>();
  for (const [id, parts] of prompts) {
    const message = compactJson(parts.user);
    if (!isObject(message) || !Object.hasOwn(message, "dimension_id")) continue;
    const family = id.slice(0, id.lastIndexOf("."));
    const dimension = id.slice(family.length + 1);
    if (message.dimension_id !== dimension) {
      throw new Error(`${id} was sent dimension_id ${JSON.stringify(message.dimension_id)}, not "${dimension}"`);
    }
    families.set(family, [...(families.get(family) ?? []), id]);
  }

  const sharedKeys = new Map<string, string[]>();
  const shared: Record<string, string> = {};
  for (const [family, ids] of families) {
    if (ids.length < 2) continue;
    const [first, ...rest] = ids.map((id) => compactJson(prompts.get(id)!.user) as Record<string, unknown>);
    const keys = Object.keys(first).filter(
      (key) =>
        isObject(first[key]) &&
        rest.every((message) => Object.hasOwn(message, key) && JSON.stringify(message[key]) === JSON.stringify(first[key])),
    );
    if (keys.length === 0) continue;
    shared[`prompts/${family}.shared.json`] = indented(Object.fromEntries(keys.map((key) => [key, first[key]])));
    for (const id of ids) sharedKeys.set(id, keys);
  }

  const own = new Map<string, Record<string, string>>();
  for (const [id, parts] of prompts) {
    const files: Record<string, string> = { [`prompts/${id}.system.txt`]: parts.system };
    const message = compactJson(parts.user);
    if (message === undefined) {
      files[`prompts/${id}.user.txt`] = parts.user;
    } else {
      const keys = sharedKeys.get(id) ?? [];
      const kept = isObject(message)
        ? Object.fromEntries(Object.entries(message).map(([key, value]) => [key, keys.includes(key) ? SHARED : value]))
        : message;
      files[`prompts/${id}.user.json`] = indented(kept);
    }
    if (parts.args) files[`prompts/${id}.args.json`] = indented(parts.args);
    own.set(id, files);
  }
  return { own, shared };
}

/** The message's value when it is compact JSON, else undefined. */
function compactJson(text: string): unknown {
  try {
    const value = JSON.parse(text);
    return JSON.stringify(value) === text ? value : undefined;
  } catch {
    return undefined;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function indented(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/** Where the verdicts one harness reached are kept. */
export function verdictFile(name: string): string {
  return `verdicts/${name}.json`;
}

/** Starts a recording from nothing, so a file that is no longer produced goes. */
export function clearForRecording(): void {
  if (RECORDING) fs.rmSync(SNAPSHOT_ROOT, { recursive: true, force: true });
}

/** Compares `actual` with the stored file, or stores it while recording. */
export function expectStored(file: string, actual: string): void {
  const target = path.join(SNAPSHOT_ROOT, file);
  if (RECORDING) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, actual);
    return;
  }
  if (!fs.existsSync(target)) {
    expect.fail(
      `No stored snapshot at ${path.relative(process.cwd(), target)}. ` +
        "If this prompt or verdict is meant to exist, record it with npm run test:snapshots:record.",
    );
  }
  expect(actual).toBe(fs.readFileSync(target, "utf8"));
}

/** Every stored file, by path under SNAPSHOT_ROOT. */
export function storedFiles(): string[] {
  if (!fs.existsSync(SNAPSHOT_ROOT)) return [];
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else found.push(path.relative(SNAPSHOT_ROOT, full).split(path.sep).join("/"));
    }
  };
  walk(SNAPSHOT_ROOT);
  return found.sort();
}
