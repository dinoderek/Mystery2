/**
 * `./dev worktree create|release`: the one way a worktree is provisioned and
 * removed, for engine and for people.
 *
 * Worktrees live beside the clone, at `<clone>-worktrees/<branch>` with `/` in
 * the branch replaced by `-`. The directory name is the worktree's identity:
 * its port and its database name both derive from it (`lib/worktree-ports.mjs`,
 * `lib/database-target.mjs`), so nothing else is provisioned.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import {
  MAIN_DATABASE,
  PROD_DATABASE,
  isValidDatabaseName,
  resolveDatabaseDir,
} from "../../lib/database-target.mjs";
import { dependenciesStale, installDependencies } from "./dev-doctor.mjs";

/** A failure with a message meant for the person running the command. */
export class DevError extends Error {}

/** Names no release may touch: the persistent database and the main checkout's. */
const PROTECTED_NAMES = new Set([PROD_DATABASE, MAIN_DATABASE]);

/** @typedef {{ cwd: string, env?: Record<string, string | undefined>, log?: (line: string) => void }} Context */

/**
 * @param {string[]} args @param {string} cwd
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  if (result.error) throw new DevError(`could not run git: ${result.error.message}`);
  return { status: result.status ?? 1, stdout: result.stdout.trim(), stderr: result.stderr.trim() };
}

/** @param {string[]} args @param {string} cwd */
function mustGit(args, cwd) {
  const result = git(args, cwd);
  if (result.status !== 0) {
    throw new DevError(`git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout;
}

/**
 * The clone the worktree belongs to, whichever of its worktrees `cwd` is in.
 *
 * @param {string} cwd
 */
export function resolveCloneRoot(cwd) {
  const commonDir = mustGit(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd);
  if (path.basename(commonDir) !== ".git") {
    throw new DevError(`${cwd} is not in a regular clone (git dir: ${commonDir})`);
  }
  return path.dirname(commonDir);
}

/** The worktree directory name for a branch: `task/Mystery2-76` is `task-Mystery2-76`. */
export function worktreeDirName(branch) {
  return branch.replaceAll("/", "-");
}

/** Where a branch's worktree goes, beside the clone. */
export function worktreePathFor(cloneRoot, branch) {
  return path.join(`${cloneRoot}-worktrees`, worktreeDirName(branch));
}

/** @param {string} branch @param {string} cwd */
function assertBranchName(branch, cwd) {
  if (!branch || branch.startsWith("-") || git(["check-ref-format", "--branch", branch], cwd).status !== 0) {
    throw new DevError(`"${branch ?? ""}" is not a usable branch name`);
  }
}

/**
 * Registered worktrees, as git lists them.
 *
 * @param {string} cwd
 * @returns {Array<{ path: string, branch: string | null }>}
 */
function listWorktrees(cwd) {
  return mustGit(["worktree", "list", "--porcelain"], cwd)
    .split("\n\n")
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const worktree = lines.find((line) => line.startsWith("worktree "));
      const branch = lines.find((line) => line.startsWith("branch "));
      return {
        path: worktree.slice("worktree ".length),
        branch: branch ? branch.slice("branch refs/heads/".length) : null,
      };
    });
}

/** `origin/<default branch>`, from the clone's own record, else from the remote. */
function resolveDefaultBranch(cwd) {
  const local = git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], cwd);
  if (local.status === 0 && local.stdout) return local.stdout;

  const remote = git(["ls-remote", "--symref", "origin", "HEAD"], cwd).stdout;
  const match = /^ref: refs\/heads\/(\S+)\s+HEAD$/m.exec(remote);
  if (!match) throw new DevError("could not tell which branch is origin's default");
  return `origin/${match[1]}`;
}

/**
 * Creates the worktree for a branch and installs its dependencies, then
 * returns its path. An existing local branch is checked out as it is; a branch
 * only origin has is checked out from it; any other is new, from the remote's
 * default branch. A worktree already there for the branch is left alone and
 * only has its dependencies brought up to date, so a resumed task can call this
 * again.
 *
 * @param {string} branch
 * @param {Context & { install?: (worktreePath: string) => number }} context
 */
export function createWorktree(branch, { cwd, log = console.log, install = installDependencies }) {
  assertBranchName(branch, cwd);
  const cloneRoot = resolveCloneRoot(cwd);
  const target = worktreePathFor(cloneRoot, branch);

  git(["worktree", "prune"], cloneRoot);
  const existing = listWorktrees(cloneRoot).find((entry) => entry.path === target);
  if (existing) {
    if (existing.branch !== branch) {
      throw new DevError(`${target} is already a worktree, on ${existing.branch ?? "a detached HEAD"}`);
    }
    log(`Worktree for ${branch} already at ${target}`);
  } else {
    if (fs.existsSync(target)) {
      throw new DevError(`${target} exists but is not a worktree of this clone; move it aside`);
    }
    mustGit(["fetch", "origin"], cloneRoot);
    const hasLocal = git(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cloneRoot).status === 0;
    const hasRemote =
      git(["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], cloneRoot).status === 0;
    if (hasLocal) {
      mustGit(["worktree", "add", target, branch], cloneRoot);
    } else if (hasRemote) {
      mustGit(["worktree", "add", "-b", branch, target, `origin/${branch}`], cloneRoot);
    } else {
      // --no-track: a new branch must not push to, or compare against, the default branch.
      mustGit(["worktree", "add", "--no-track", "-b", branch, target, resolveDefaultBranch(cloneRoot)], cloneRoot);
    }
    log(`Created worktree for ${branch} at ${target}`);
  }

  if (existing && !dependenciesStale(target)) return target;
  if (install(target) !== 0) {
    throw new DevError(`installing dependencies in ${target} failed; fix that, then run this again`);
  }
  return target;
}

/**
 * Removes a branch's worktree and the development database named after it,
 * and nothing else: the branch stays. Safe to run again, and for a branch with
 * no worktree. A worktree with uncommitted changes is refused, as
 * `git worktree remove` refuses it.
 *
 * @param {string} branch
 * @param {Context} context
 */
export function releaseWorktree(branch, { cwd, env = process.env, log = console.log }) {
  const name = worktreeDirName(branch ?? "");
  if (PROTECTED_NAMES.has(branch) || PROTECTED_NAMES.has(name)) {
    throw new DevError(`refusing to release "${branch}": that name is the persistent or main checkout's`);
  }
  assertBranchName(branch, cwd);
  if (!isValidDatabaseName(name)) throw new DevError(`"${branch}" does not make a worktree name`);

  const cloneRoot = resolveCloneRoot(cwd);
  const target = worktreePathFor(cloneRoot, branch);

  git(["worktree", "prune"], cloneRoot);
  if (!listWorktrees(cloneRoot).some((entry) => entry.path === target)) {
    log(`No worktree for ${branch}; nothing to release`);
    return;
  }

  const removed = git(["worktree", "remove", target], cloneRoot);
  if (removed.status !== 0) {
    throw new DevError(
      `not releasing ${target}: ${removed.stderr}\n` +
        "Commit or discard what is there, then run this again.",
    );
  }
  log(`Removed worktree ${target}`);

  const databaseDir = resolveDatabaseDir(name, target, env);
  if (fs.existsSync(databaseDir)) {
    fs.rmSync(databaseDir, { recursive: true, force: true });
    log(`Removed database ${name} (${databaseDir})`);
  }
}
