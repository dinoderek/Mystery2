/**
 * Patch supabase/config.toml for worktree isolation.
 *
 * Safe to run in both worktrees and the main checkout (no-op in the latter).
 * Use this before running raw `npx supabase` commands in a worktree.
 */

import { patchConfigToml, resolveWorktreePorts } from "./worktree-ports.mjs";

const resolved = resolveWorktreePorts();

if (!resolved.isWorktree) {
  console.log("Main checkout detected — config.toml already correct, nothing to patch.");
  process.exit(0);
}

const patched = patchConfigToml();
if (patched) {
  console.log(
    `Patched config.toml → project_id=${resolved.projectId}, API port=${resolved.ports.api}`,
  );
} else {
  console.log("config.toml already patched for this worktree.");
}
