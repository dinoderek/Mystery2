/**
 * Judge versions: which version of each judge a verdict was reached by, so a
 * stored verdict is compared only with verdicts of the same judge.
 *
 * `judge-versions.json` lists, for every judge in the registry, the hash of
 * each of its versions in order: version 1 is the first hash, version N the
 * Nth. A judge's hash covers what its registry entry names: the brief, schema
 * and preamble (or the file its prompt is built in), the analyzer, the
 * context, the id checks and the verdict rule.
 *
 * A change to any of those is a new version: append the judge's new hash. The
 * gate fails while a judge's files hash to anything but its latest version.
 * A change elsewhere that alters what a judge reads or decides (the subject
 * projection, the prompt composer) is not hashed; append a version by hand.
 *
 * A judge whose files match no recorded version (an edit not yet recorded)
 * has version null: a run records it, and nothing stores its verdicts.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { REGISTRY } from "./registry.ts";
import type { JudgeEntry } from "./registry.ts";

const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");

/** The versions file, relative to the repository root. */
export const JUDGE_VERSIONS_FILE = "evaluation/core/judge-versions.json";

/** How many hex digits of SHA-256 a version's hash keeps. */
const HASH_LENGTH = 16;

function judges(): JudgeEntry[] {
  return REGISTRY.filter((entry): entry is JudgeEntry => entry.type === "judge");
}

function read(file: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, file), "utf8");
}

/** The hash of what a judge's registry entry names, as of the files on disk now. */
export function judgeHash(entry: JudgeEntry): string {
  const prompt =
    entry.prompt.kind === "files"
      ? { brief: read(entry.prompt.brief), schema: read(entry.prompt.schema), preamble: read(entry.prompt.preamble) }
      : { built: read(entry.prompt.source) };
  const identity = {
    prompt,
    analyzer: entry.analyzer ? read(entry.analyzer.module) : null,
    context: entry.context ?? null,
    id_checks: entry.idChecks ?? null,
    verdict: entry.verdict,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, HASH_LENGTH);
}

/** The versions file: by judge id, the hash of each version in order. */
export function readJudgeVersionsFile(): Record<string, string[]> {
  return JSON.parse(read(JUDGE_VERSIONS_FILE)) as Record<string, string[]>;
}

let cached: Record<string, number | null> | null = null;

/**
 * Every judge's version as its files stand: the latest recorded version its
 * hash matches, or null when it matches none. Read once per process.
 */
export function judgeVersions(): Readonly<Record<string, number | null>> {
  if (cached) return cached;
  const recorded = readJudgeVersionsFile();
  cached = Object.fromEntries(
    judges().map((entry) => {
      const index = (recorded[entry.id] ?? []).lastIndexOf(judgeHash(entry));
      return [entry.id, index === -1 ? null : index + 1];
    }),
  );
  return cached;
}

/** One judge's version as its files stand, or null when its files match no recorded version. */
export function judgeVersion(id: string): number | null {
  const versions = judgeVersions();
  if (!(id in versions)) throw new Error(`"${id}" is not a judge in the registry`);
  return versions[id];
}

/**
 * What the gate holds the versions file to: an entry for every judge and for
 * nothing else, no hash repeated in a row, and every judge's files at its
 * latest version. Each problem names the judge and, for a changed one, the
 * line to append. `recorded` and `entries` default to the file and the
 * registry.
 */
export function checkJudgeVersions(
  recorded: Readonly<Record<string, readonly string[]>> = readJudgeVersionsFile(),
  entries: readonly JudgeEntry[] = judges(),
): string[] {
  const ids = new Set(entries.map((entry) => entry.id));
  const problems: string[] = [];
  for (const id of Object.keys(recorded)) {
    if (!ids.has(id)) problems.push(`${JUDGE_VERSIONS_FILE} lists "${id}", which is not a judge in the registry`);
  }
  for (const entry of entries) {
    const hashes = recorded[entry.id];
    const hash = judgeHash(entry);
    if (!hashes || hashes.length === 0) {
      problems.push(`${entry.id} has no version: add "${entry.id}": ["${hash}"] to ${JUDGE_VERSIONS_FILE}`);
      continue;
    }
    hashes.forEach((value, index) => {
      if (index > 0 && value === hashes[index - 1]) problems.push(`${entry.id}: versions ${index} and ${index + 1} have the same hash`);
    });
    const latest = hashes.length;
    if (hashes[latest - 1] !== hash) {
      problems.push(
        `${entry.id} changed since version ${latest}: append "${hash}" to its list in ${JUDGE_VERSIONS_FILE}, making version ${latest + 1}`,
      );
    }
  }
  return problems;
}
