/**
 * Generate supabase/config.toml from config.toml.template.
 *
 * Safe to run in both worktrees and the main checkout.  In a worktree the
 * generated file gets worktree-specific ports; in the main checkout it is an
 * unmodified copy of the template.
 */

import { patchConfigToml, resolveWorktreePorts } from "./worktree-ports.mjs";

const resolved = resolveWorktreePorts();
const written = patchConfigToml();

if (written) {
  if (resolved.isWorktree) {
    console.log(
      `Generated config.toml → project_id=${resolved.projectId}, API port=${resolved.ports.api}`,
    );
  } else {
    console.log("Generated config.toml from template (main checkout defaults).");
  }
} else {
  console.log("config.toml is already up to date.");
}
