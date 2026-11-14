/**
 * Where a run writes. Every command writes under the output root:
 * `--output-root`, else `$MYSTERYEVALS_DIR`, else `~/mysteryevals`.
 *
 *     <output root>/<YYYY-MM-DD>/<HH-MM-SS>-<command>/
 *     ├── run.json              the index: the run, and one line per subject
 *     └── <subject>/
 *         ├── result.json       the subject's result (`result.ts`)
 *         ├── <stored subject>  the blueprint, trace or captured turn
 *         ├── logs/             each model call's prompts and per-attempt logs
 *         └── ...               agent workspaces
 *
 * Dates and times are UTC. A second run in the same second gets `-2`, `-3`.
 * `run.json` repeats from each result only what a reader needs to pick a
 * subject to open: its kind, id, folder, `passed` and counts, and the run error
 * if it broke. The results stay the record.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";

import type { ResolvedBinding } from "./config.ts";
import {
  RESULT_SCHEMA_VERSION,
  RunInfoSchema,
  SubjectSchema,
  SummarySchema,
  RunErrorSchema,
  exitCodeFor,
  readResult,
} from "./result.ts";
import type { Result, RunInfo, Subject } from "./result.ts";

export const RUN_INDEX = "run.json";
export const RESULT_FILE = "result.json";

export const RunIndexSchema = z
  .object({
    schema_version: z.literal(RESULT_SCHEMA_VERSION),
    run: RunInfoSchema,
    subjects: z.array(
      SubjectSchema.omit({ path: true })
        .extend({ dir: z.string().min(1), summary: SummarySchema, run_error: RunErrorSchema.nullable() })
        .strict(),
    ),
    exit_code: z.number().int().min(0).max(2),
  })
  .strict();
export type RunIndex = z.infer<typeof RunIndexSchema>;

/** The output root for this run, absolute. */
export function resolveOutputRoot(
  flag: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  if (flag) return path.resolve(flag);
  if (env.MYSTERYEVALS_DIR) return path.resolve(env.MYSTERYEVALS_DIR);
  return path.join(home, "mysteryevals");
}

/** The checkout's commit and whether its tree is clean; nulls outside git. */
export function readCommit(root: string): { commit: string | null; tree_clean: boolean | null } {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  try {
    return { commit: git("rev-parse", "HEAD"), tree_clean: git("status", "--porcelain") === "" };
  } catch {
    return { commit: null, tree_clean: null };
  }
}

/** A folder name from free text: lower case, `-` between words, never empty. */
export function slugify(text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
  return slug || "subject";
}

function stamp(date: Date): { day: string; time: string } {
  const iso = date.toISOString();
  return { day: iso.slice(0, 10), time: iso.slice(11, 19).replaceAll(":", "-") };
}

/** Makes `base`, or `base-2`, `base-3`... if taken, and returns the one made. */
function makeFreshDir(base: string): string {
  for (let n = 1; ; n += 1) {
    const dir = n === 1 ? base : `${base}-${n}`;
    try {
      fs.mkdirSync(dir);
      return dir;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

export interface RunFolderOptions {
  outputRoot: string;
  /** The command as typed after `./dev eval`, e.g. `judge blueprint`. */
  command: string;
  argv: readonly string[];
  /** The repo root, whose commit the run records. */
  root: string;
  bindings: readonly ResolvedBinding[];
  now?: () => Date;
  commit?: { commit: string | null; tree_clean: boolean | null };
}

export interface SubjectFolder {
  dir: string;
  logDir: string;
  resultFile: string;
}

export interface RunFolder {
  dir: string;
  /** The `run` part of every result in this run, ended now. */
  info(): RunInfo;
  /** Makes the folder for one subject, named after its id. */
  subject(subject: Pick<Subject, "kind" | "id">): SubjectFolder;
  /** Reads back every subject's result, writes `run.json`, and returns it. */
  finish(): Promise<RunIndex>;
}

function bindingsUsed(bindings: readonly ResolvedBinding[]): RunInfo["bindings"] {
  return Object.fromEntries(
    bindings.map((binding) => [
      binding.name,
      {
        cmd: binding.cmd,
        args: [...binding.args],
        extract_path: binding.extract_path,
        model: binding.model,
        timeout_ms: binding.timeout_ms,
        retries: binding.retries,
      },
    ]),
  );
}

/** Makes this run's folder under the output root. */
export function createRunFolder(options: RunFolderOptions): RunFolder {
  const now = options.now ?? (() => new Date());
  const startedAt = now();
  const { day, time } = stamp(startedAt);
  fs.mkdirSync(path.join(options.outputRoot, day), { recursive: true });
  const dir = makeFreshDir(path.join(options.outputRoot, day, `${time}-${slugify(options.command)}`));
  const commit = options.commit ?? readCommit(options.root);
  const base = {
    id: `${day}/${path.basename(dir)}`,
    command: options.command,
    argv: [...options.argv],
    started_at: startedAt.toISOString(),
    ...commit,
    bindings: bindingsUsed(options.bindings),
  };
  const subjects: Array<Pick<Subject, "kind" | "id"> & { dir: string }> = [];

  const info = (): RunInfo => ({ ...base, ended_at: now().toISOString() });

  return {
    dir,
    info,
    subject(subject) {
      const subjectDir = makeFreshDir(path.join(dir, slugify(subject.id)));
      subjects.push({ ...subject, dir: path.basename(subjectDir) });
      return { dir: subjectDir, logDir: path.join(subjectDir, "logs"), resultFile: path.join(subjectDir, RESULT_FILE) };
    },
    async finish() {
      const results: Result[] = [];
      for (const subject of subjects) results.push(await readResult(path.join(dir, subject.dir, RESULT_FILE)));
      const index = RunIndexSchema.parse({
        schema_version: RESULT_SCHEMA_VERSION,
        run: info(),
        subjects: subjects.map((subject, i) => ({
          kind: subject.kind,
          id: subject.id,
          dir: subject.dir,
          summary: results[i].summary,
          run_error: results[i].run_error,
        })),
        exit_code: exitCodeFor(results),
      });
      fs.writeFileSync(path.join(dir, RUN_INDEX), `${JSON.stringify(index, null, 2)}\n`, "utf8");
      return index;
    },
  };
}

/** Reads a run's `run.json` and checks it. */
export function readRunIndex(runDir: string): RunIndex {
  const file = path.join(runDir, RUN_INDEX);
  return RunIndexSchema.parse(JSON.parse(fs.readFileSync(file, "utf8")));
}
