/**
 * The shared data repository, as a local clone: where `perf push` puts run
 * records and where later commands read everyone's. The clone lives at
 * `<output root>/.perf/data`, belongs to the perf commands, and is rewound to
 * the remote's `main` on every use, so nothing is ever edited in it.
 *
 * A record is one file, `records/<yyyy>/<mm>/<developer>/<run>.json`, added and
 * never changed: two developers write different files, and a record already
 * there is left alone. Git runs through the host's own `git` and credentials.
 */

import fs from "node:fs";
import path from "node:path";

import { InputError } from "../core/errors.ts";
import { git, GitError, gitOk } from "../core/git.ts";
import type { RunRecord } from "./record.ts";

export const RECORDS_DIR = "records";
export const DATA_BRANCH = "main";
/** How many times a push is tried against the remote moving under it. */
export const PUSH_ATTEMPTS = 5;

/** The clone of the data repository under an output root. */
export function dataCloneDir(outputRoot: string): string {
  return path.join(outputRoot, ".perf", "data");
}

/**
 * One path segment from free text: every character outside `A-Z a-z 0-9 . _ -`
 * becomes `_`, and a leading `.` too. A run's id, `<date>/<time>-<command>`,
 * becomes `<date>_<time>-<command>`; a developer's name is mapped the same way.
 */
export function pathSafe(text: string): string {
  const safe = text.replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\./, "_");
  return safe === "" ? "_" : safe;
}

/** Where a record goes in the data repository, relative to its root, with `/`: by the month the run started, in UTC. */
export function recordPath(record: Pick<RunRecord, "run">): string {
  const month = /^(\d{4})-(\d{2})-/.exec(record.run.started_at);
  if (!month) throw new InputError(`run ${record.run.id} has no usable start time: "${record.run.started_at}"`);
  return [RECORDS_DIR, month[1], month[2], pathSafe(record.run.developer), `${pathSafe(record.run.id)}.json`].join("/");
}

/** True when every model call of the record went to a stub: no model named, or the game's mock AI. A record with no calls is one too. */
export function measuresNothing(record: Pick<RunRecord, "calls">): boolean {
  return record.calls.every((call) => call.model === null || call.model.startsWith("mock"));
}

/** Makes the clone on first use, and points it at `remote`. */
function ensureClone(clone: string, remote: string): void {
  if (!fs.existsSync(path.join(clone, ".git"))) {
    fs.mkdirSync(path.dirname(clone), { recursive: true });
    git(path.dirname(clone), ["clone", "--quiet", remote, path.basename(clone)]);
  }
  if (git(clone, ["remote", "get-url", "origin"]).trim() !== remote) git(clone, ["remote", "set-url", "origin", remote]);
}

/** The push refusals that mean the remote moved on, as git prints them; a remote's own refusal is `[remote rejected]`, and is not one. */
const LOST_RACE = /!\s+\[rejected\]|stale info/;

/** Rewinds the clone to the remote's `main`; on a remote with none yet, to an empty `main`. */
function syncToRemote(clone: string): void {
  git(clone, ["fetch", "--quiet", "origin"]);
  if (gitOk(clone, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${DATA_BRANCH}`])) {
    git(clone, ["checkout", "--quiet", "--force", "-B", DATA_BRANCH, `origin/${DATA_BRANCH}`]);
    git(clone, ["clean", "--quiet", "-fd"]);
  } else {
    // No `main` on the remote yet: drop any commit an earlier push left here, so a record is "present" only if the remote has it.
    git(clone, ["symbolic-ref", "HEAD", `refs/heads/${DATA_BRANCH}`]);
    git(clone, ["update-ref", "-d", `refs/heads/${DATA_BRANCH}`]);
    git(clone, ["read-tree", "--empty"]);
    git(clone, ["clean", "--quiet", "-fdx"]);
  }
}

/** The settings that give a commit an author when the host has configured none; a name, never an email address of a person. */
function identityFallback(clone: string, author: string): string[] {
  const settings: string[] = [];
  if (!gitOk(clone, ["config", "user.name"])) settings.push(`user.name=${author}`);
  if (!gitOk(clone, ["config", "user.email"])) settings.push("user.email=mystery-eval@localhost");
  return settings;
}

/** Brings the clone to the remote's `main`, making it on first use; what `perf sync` reads from. Throws a `GitError` when the remote cannot be reached. */
export function fetchRecords(clone: string, remote: string): void {
  ensureClone(clone, remote);
  syncToRemote(clone);
}

/** A record to send: where it goes and the exact bytes of its `record.json`. */
export interface RecordFile {
  path: string;
  content: string;
}

export interface PublishOptions {
  clone: string;
  remote: string;
  files: readonly RecordFile[];
  /** Named in commits made on a host with no git identity. */
  author: string;
  attempts?: number;
  /** Called after each commit and before its push: a test's way of letting another clone win the race. */
  beforePush?: (attempt: number) => void;
}

export interface PublishOutcome {
  /** The paths this call added to the repository. */
  sent: string[];
  /** The paths already in the repository, left alone. */
  present: string[];
}

function commitMessage(sent: readonly string[]): string {
  const subject = `Add ${sent.length} run record${sent.length === 1 ? "" : "s"}`;
  return `${subject}\n\n${sent.join("\n")}\n`;
}

/**
 * Adds `files` to the data repository and pushes them. Each attempt rewinds the
 * clone to the remote's `main`, adds the files it does not hold, commits and
 * pushes: a lost race is the same commit made again on the new tip, so it never
 * conflicts. A record already in the repository is not rewritten. Only a push
 * the remote rejected is tried again, up to `attempts` times; any other git
 * failure stops at once with what git said.
 */
export function publishRecords(options: PublishOptions): PublishOutcome {
  const { clone, remote, files, author } = options;
  const attempts = options.attempts ?? PUSH_ATTEMPTS;
  ensureClone(clone, remote);
  const identity = identityFallback(clone, author);
  let lastSaid = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    syncToRemote(clone);
    const present = files.filter((file) => fs.existsSync(path.join(clone, file.path))).map((file) => file.path);
    const fresh = files.filter((file) => !present.includes(file.path));
    if (fresh.length === 0) return { sent: [], present };
    for (const file of fresh) {
      const target = path.join(clone, file.path);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, file.content, { encoding: "utf8", flag: "wx" });
    }
    const sent = fresh.map((file) => file.path);
    git(clone, ["add", "--", ...sent]);
    git(clone, ["commit", "--quiet", "-m", commitMessage(sent)], identity);
    options.beforePush?.(attempt);
    try {
      git(clone, ["push", "--quiet", "origin", `HEAD:refs/heads/${DATA_BRANCH}`]);
      return { sent, present };
    } catch (error) {
      if (!(error instanceof GitError) || !LOST_RACE.test(error.stderr)) throw error;
      lastSaid = error.stderr.trim();
    }
  }
  throw new InputError(
    `could not push to ${remote}: the remote moved under ${attempts} attempts in a row. Nothing was lost; run perf push again. Git said: ${lastSaid}`,
  );
}
