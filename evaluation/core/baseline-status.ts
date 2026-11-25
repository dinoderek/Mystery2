/**
 * Whether a stored baseline still describes the code at `HEAD`: `baseline
 * status` asks it of each baseline's `run.commit`.
 *
 * This repo merges by squash, so a run's commit is a branch commit that never
 * joins `main`'s history, and "behind `HEAD`" cannot be ancestry. A baseline is
 * current when what its runs read is the same at its commit and at `HEAD`, and
 * stale otherwise. The commits listed are those on `HEAD`'s first-parent line
 * after the newest one whose read paths match the run's, which are the changes
 * the baseline has not seen. It reads git only and calls no model.
 */

import { spawnSync } from "node:child_process";

/**
 * What a runtime run reads: judge briefs and schemas, the harness, the narrator's prompts and the engine,
 * and the few files outside those folders its `judge turn` imports or loads (the readability metric, the
 * played-events reader, the judge id checks, the run record's builder, and the bindings). A test holds this
 * list to the import closure.
 */
export const READ_PATHS = [
  "evaluation/core",
  "evaluation/judges",
  "evaluation/runtime",
  "evaluation/lib",
  "evaluation/blueprint/player-view.ts",
  "evaluation/perf/record.ts",
  "evaluation/config.example.json",
  "packages/game-engine",
  "packages/shared",
];
/** Under the read paths, what no run reads: the baselines themselves and the docs beside the code. */
const NOT_READ = [":(exclude,glob)evaluation/runtime/**/baselines/*.json", ":(exclude,glob)**/README.md"];
/** The pathspecs every git call below filters by. */
export const READ_PATHSPEC: readonly string[] = [...READ_PATHS, ...NOT_READ];

export interface CommitLine {
  short: string;
  subject: string;
}

export type BaselineStatus =
  | { kind: "current" }
  | { kind: "stale"; commits: CommitLine[] }
  /** The commit cannot be compared: absent from this checkout, or not recorded. */
  | { kind: "unknown"; reason: string };

interface GitResult {
  ok: boolean;
  code: number | null;
  out: string;
  err: string;
}

function git(root: string, args: readonly string[]): GitResult {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: result.status === 0, code: result.status, out: (result.stdout ?? "").trim(), err: (result.stderr ?? "").trim() };
}

const lines = (text: string): string[] => (text === "" ? [] : text.split("\n"));

/** True when the read paths hold the same content at both commits. */
function sameRead(root: string, a: string, b: string): boolean {
  const diff = git(root, ["diff", "--quiet", a, b, "--", ...READ_PATHSPEC]);
  if (diff.code === 0) return true;
  if (diff.code === 1) return false;
  throw new Error(`git diff ${a} ${b} failed (exit ${diff.code}): ${diff.err}`);
}

interface Touch extends CommitLine {
  hash: string;
}

/** `HEAD`'s first-parent commits that change the read paths, newest first, within `range` when given. */
function touching(root: string, range: string | null): Touch[] {
  const log = git(root, ["log", "--first-parent", "--format=%H%x09%h%x09%s", ...(range ? [range] : ["HEAD"]), "--", ...READ_PATHSPEC]);
  return lines(log.out).map((line) => {
    const [hash, short, ...subject] = line.split("\t");
    return { hash, short, subject: subject.join("\t") };
  });
}

/**
 * The commits after the run's state. The read paths only change at the commits
 * that touch them, so the run's state is the one right after the newest of
 * those that matches its commit. With no match (a run on unmerged work), the
 * commits since the merge base.
 */
function changesSince(root: string, commit: string): CommitLine[] {
  const all = touching(root, null);
  const matched = all.findIndex((touch) => sameRead(root, touch.hash, commit));
  if (matched >= 0) return all.slice(0, matched);
  const base = git(root, ["merge-base", commit, "HEAD"]);
  return base.ok && base.out !== "" ? touching(root, `${base.out}..HEAD`) : all;
}

/** The status of one baseline's commit against `HEAD`. A run with no commit, or one this checkout lacks, is `unknown`. */
export function baselineStatus(root: string, commit: string | null): BaselineStatus {
  if (commit === null) return { kind: "unknown", reason: "its run recorded no commit" };
  if (!git(root, ["rev-parse", "--verify", "--quiet", "HEAD"]).ok) return { kind: "unknown", reason: "this is not a git checkout" };
  if (!git(root, ["cat-file", "-e", `${commit}^{commit}`]).ok) {
    return { kind: "unknown", reason: `commit ${commit.slice(0, 7)} is not available here (fetch the branch it was run on)` };
  }
  if (sameRead(root, commit, "HEAD")) return { kind: "current" };
  return { kind: "stale", commits: changesSince(root, commit) };
}
