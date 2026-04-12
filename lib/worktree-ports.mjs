/* global process */

/**
 * Worktree-aware Supabase port and project_id allocation.
 *
 * When running inside a git worktree, this module derives a deterministic
 * project_id and port set so that each worktree gets its own fully isolated
 * Supabase stack.  When running in the main repo checkout it returns the
 * base defaults unchanged.
 *
 * Port layout — three bands:
 *
 *   Band           Base (main)   Stride   Worktree range (slots 1–1000)
 *   vite_dev       51000         +1       51001–52000
 *   edge_inspector 53000         +1       53001–54000
 *   Supabase (7)   54330–54339   +10      54340–64339
 *
 * Slot derivation:
 *   slot = hash(worktreeName) % 1000 + 1   (range 1..1000)
 *
 * All ports stay below 65 535.  With 1000 slots the birthday-problem
 * collision rate for 3 concurrent worktrees is ~0.3%.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Base port map — must match the committed supabase/config.toml
// ---------------------------------------------------------------------------

const BASE_PROJECT_ID = "mystery";

const BASE_PORTS = {
  api: 54331,
  db: 54332,
  shadow_db: 54330,
  studio: 54333,
  inbucket: 54334,
  analytics: 54337,
  db_pooler: 54339,
  edge_inspector: 53000,
  vite_dev: 51000,
};

const MAX_SLOTS = 1000;

// Ports in the Supabase band (54xxx) use stride 10; standalone services use
// stride 1.  This packs 1000 slots into the available port space.
const STRIDE = {
  api: 10,
  db: 10,
  shadow_db: 10,
  studio: 10,
  inbucket: 10,
  analytics: 10,
  db_pooler: 10,
  edge_inspector: 1,
  vite_dev: 1,
};

// ---------------------------------------------------------------------------
// Worktree detection
// ---------------------------------------------------------------------------

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
    gitDir = git("-C", cwd, "rev-parse", "--git-dir");
    gitCommonDir = git("-C", cwd, "rev-parse", "--git-common-dir");
  } catch {
    return null;
  }

  // Normalise so the comparison is reliable on every OS.
  const absGitDir = path.resolve(cwd, gitDir);
  const absCommonDir = path.resolve(cwd, gitCommonDir);

  if (absGitDir === absCommonDir) {
    // Main checkout — not a worktree.
    return null;
  }

  // gitDir for a worktree looks like  <repo>/.git/worktrees/<name>
  return path.basename(absGitDir);
}

// ---------------------------------------------------------------------------
// Deterministic slot from worktree name
// ---------------------------------------------------------------------------

function worktreeSlot(name) {
  const hash = createHash("sha256").update(name).digest();
  // Read the first 4 bytes as an unsigned 32-bit int.
  const num = hash.readUInt32BE(0);
  return (num % MAX_SLOTS) + 1;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve the project_id and port map for the current working directory.
 *
 * Returns { projectId, ports, isWorktree, worktreeName, slot }.
 */
export function resolveWorktreePorts(cwd = process.cwd()) {
  const worktreeName = detectWorktreeName(cwd);

  if (!worktreeName) {
    return {
      projectId: BASE_PROJECT_ID,
      ports: { ...BASE_PORTS },
      isWorktree: false,
      worktreeName: null,
      slot: 0,
    };
  }

  const slot = worktreeSlot(worktreeName);
  const ports = {};
  for (const [key, base] of Object.entries(BASE_PORTS)) {
    ports[key] = base + slot * STRIDE[key];
  }

  return {
    projectId: `${BASE_PROJECT_ID}-wt-${worktreeName.slice(0, 16)}`,
    ports,
    isWorktree: true,
    worktreeName,
    slot,
  };
}

/**
 * Return the Supabase API URL for the resolved worktree ports.
 */
export function resolveApiUrl(cwd = process.cwd()) {
  const { ports } = resolveWorktreePorts(cwd);
  return `http://127.0.0.1:${ports.api}`;
}
