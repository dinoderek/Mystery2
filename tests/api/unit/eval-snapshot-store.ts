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

/**
 * The files that hold one prompt, by path under SNAPSHOT_ROOT.
 *
 * A user message that is compact JSON is kept indented, one field to a line,
 * so a change reads as a diff; reading it back as compact JSON gives the bytes
 * that were sent. Any other message is kept as it is.
 */
export function promptFiles(id: string, parts: PromptParts): Record<string, string> {
  const files: Record<string, string> = {
    [`prompts/${id}.system.txt`]: parts.system,
  };
  if (isCompactJson(parts.user)) {
    files[`prompts/${id}.user.json`] = `${JSON.stringify(JSON.parse(parts.user), null, 2)}\n`;
  } else {
    files[`prompts/${id}.user.txt`] = parts.user;
  }
  if (parts.args) files[`prompts/${id}.args.json`] = `${JSON.stringify(parts.args, null, 2)}\n`;
  return files;
}

function isCompactJson(text: string): boolean {
  try {
    return JSON.stringify(JSON.parse(text)) === text;
  } catch {
    return false;
  }
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
