/* global process */

/**
 * Worktree-aware port allocation for the game server.
 *
 * Each worktree gets its own port so two checkouts can run side by side. That
 * used to matter for nine Supabase containers; now there is one process, so
 * there is one port.
 *
 *   web   51000   +1 per slot   (51001–52000 in worktrees)
 *
 * Slot derivation:
 *   slot = hash(worktreeName) % 1000 + 1   (range 1..1000)
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";

const BASE_PORT = 51000;
const MAX_SLOTS = 1000;

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Returns the worktree leaf name if we are inside a git worktree, or null
 * when running from the main checkout.
 */
export function detectWorktreeName(cwd = process.cwd()) {
  let gitDir, gitCommonDir;
  try {
    gitDir = git("-C", cwd, "rev-parse", "--absolute-git-dir");
    gitCommonDir = git("-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir");
  } catch {
    return null;
  }

  if (path.resolve(gitDir) === path.resolve(gitCommonDir)) return null;

  const toplevel = git("-C", cwd, "rev-parse", "--show-toplevel");
  return path.basename(toplevel);
}

/** Deterministic slot in 1..MAX_SLOTS for a worktree name. */
function slotFor(worktreeName) {
  const digest = createHash("sha256").update(worktreeName).digest();
  return (digest.readUInt32BE(0) % MAX_SLOTS) + 1;
}

/**
 * The port this checkout's game server listens on, plus the worktree context
 * it was derived from.
 */
export function resolveWorktreePorts(cwd = process.cwd()) {
  const worktreeName = detectWorktreeName(cwd);
  if (!worktreeName) {
    return { isWorktree: false, worktreeName: null, slot: 0, ports: { web: BASE_PORT } };
  }

  const slot = slotFor(worktreeName);
  return {
    isWorktree: true,
    worktreeName,
    slot,
    ports: { web: BASE_PORT + slot },
  };
}

/** Base URL of this checkout's game server. */
export function resolveServerUrl(cwd = process.cwd()) {
  return `http://127.0.0.1:${resolveWorktreePorts(cwd).ports.web}`;
}
