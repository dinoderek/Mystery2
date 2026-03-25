/**
 * Worktree-aware Supabase port and project_id allocation.
 *
 * When running inside a git worktree, this module derives a deterministic
 * project_id and port set so that each worktree gets its own fully isolated
 * Supabase stack.  When running in the main repo checkout it returns the
 * base defaults unchanged.
 *
 * Port offset scheme:
 *   slot = hash(worktreeName) % 50 + 1          (range 1..50)
 *   each port = basePort + slot * 100
 *
 * This keeps all ports below 65 535 and avoids collisions between concurrent
 * worktrees (with overwhelming probability — 50 slots for typical workloads).
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
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
  edge_inspector: 8083,
};

const MAX_SLOTS = 50;

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
    ports[key] = base + slot * 100;
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
 * Patch supabase/config.toml in-place with worktree-specific project_id and
 * ports.  Returns true if the file was modified, false if no changes were
 * needed (e.g. main checkout or already patched).
 */
export function patchConfigToml(repoRoot = process.cwd()) {
  const resolved = resolveWorktreePorts(repoRoot);
  if (!resolved.isWorktree) return false;

  const configPath = path.join(repoRoot, "supabase", "config.toml");
  let content = fs.readFileSync(configPath, "utf8");

  const replacements = [
    [/^project_id\s*=\s*"[^"]*"/m, `project_id = "${resolved.projectId}"`],
    // [api]
    [/(^\[api\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.api}`],
    // [db]
    [/(^\[db\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.db}`],
    [/(^shadow_port\s*=\s*)\d+/m, `$1${resolved.ports.shadow_db}`],
    // [db.pooler]
    [/(^\[db\.pooler\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.db_pooler}`],
    // [studio]
    [/(^\[studio\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.studio}`],
    // [inbucket]
    [/(^\[inbucket\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.inbucket}`],
    // [analytics]
    [/(^\[analytics\][\s\S]*?^port\s*=\s*)\d+/m, `$1${resolved.ports.analytics}`],
    // [edge_runtime] inspector_port
    [/(^inspector_port\s*=\s*)\d+/m, `$1${resolved.ports.edge_inspector}`],
  ];

  for (const [pattern, replacement] of replacements) {
    content = content.replace(pattern, replacement);
  }

  fs.writeFileSync(configPath, content, "utf8");
  return true;
}

/**
 * Return the Supabase API URL for the resolved worktree ports.
 */
export function resolveApiUrl(cwd = process.cwd()) {
  const { ports } = resolveWorktreePorts(cwd);
  return `http://127.0.0.1:${ports.api}`;
}

/**
 * List all active git worktrees (as absolute paths).
 */
export function listWorktrees(cwd = process.cwd()) {
  const raw = git("-C", cwd, "worktree", "list", "--porcelain");
  const paths = [];
  for (const line of raw.split(/\r?\n/u)) {
    if (line.startsWith("worktree ")) {
      paths.push(line.slice("worktree ".length));
    }
  }
  return paths;
}
