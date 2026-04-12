/**
 * Worktree port allocation — re-exports core logic from lib/ and adds
 * operational helpers (config patching, worktree listing) that only
 * scripts need.
 */

import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

// Re-export everything from the shared module so existing script imports
// continue to work unchanged.
export {
  detectWorktreeName,
  resolveWorktreePorts,
  resolveApiUrl,
} from "../lib/worktree-ports.mjs";

import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";

// ---------------------------------------------------------------------------
// Operational helpers (scripts only — not needed by tests or app code)
// ---------------------------------------------------------------------------

function git(...args) {
  const result = spawnSync("git", args, { encoding: "utf8", stdio: "pipe" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || "").trim()}`);
  }
  return result.stdout.trim();
}

/**
 * Generate supabase/config.toml from config.toml.template.
 *
 * In a worktree the generated file gets worktree-specific project_id and
 * ports.  In the main checkout it is an unmodified copy of the template.
 * Either way, config.toml is gitignored so there is never a dirty working
 * tree.
 *
 * Returns true if the file was written, false if the existing config.toml
 * already matched (content-identical).
 */
export function patchConfigToml(repoRoot = process.cwd()) {
  const templatePath = path.join(repoRoot, "supabase", "config.toml.template");
  const configPath = path.join(repoRoot, "supabase", "config.toml");

  let content = fs.readFileSync(templatePath, "utf8");

  const resolved = resolveWorktreePorts(repoRoot);
  if (resolved.isWorktree) {
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
  }

  // Skip write if existing config.toml is already identical.
  try {
    const existing = fs.readFileSync(configPath, "utf8");
    if (existing === content) return false;
  } catch {
    // File doesn't exist yet — will be created below.
  }

  fs.writeFileSync(configPath, content, "utf8");
  return true;
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
