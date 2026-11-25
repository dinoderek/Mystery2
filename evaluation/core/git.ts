/**
 * Running the host's own `git`, with its credentials: what the perf commands
 * use to reach the shared data repository. A subprocess starts only in
 * `evaluation/core/`, so the one place that does is here.
 */

import { spawnSync } from "node:child_process";

import { InputError } from "./errors.ts";

/** A `git` command that failed, with what git said; the dispatcher prints its message without a stack. */
export class GitError extends InputError {
  readonly stderr: string;

  constructor(args: readonly string[], stderr: string) {
    super(`git ${args.join(" ")} failed: ${stderr.trim() || "no output"}`);
    this.name = "GitError";
    this.stderr = stderr;
  }
}

/** Runs `git` in `cwd` and returns its stdout; never waits on a terminal prompt. `config` entries are `key=value` settings for this command only. */
export function git(cwd: string, args: readonly string[], config: readonly string[] = []): string {
  const result = spawnSync("git", [...config.flatMap((setting) => ["-c", setting]), ...args], {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (result.error) throw new InputError(`cannot run git: ${result.error.message}`);
  if (result.status !== 0) throw new GitError(args, `${result.stderr}${result.stdout}`);
  return result.stdout;
}

/** True when `git` succeeds, false when it fails. */
export function gitOk(cwd: string, args: readonly string[]): boolean {
  try {
    git(cwd, args);
    return true;
  } catch (error) {
    if (error instanceof GitError) return false;
    throw error;
  }
}
