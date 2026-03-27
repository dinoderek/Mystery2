/**
 * Worktree-safe `supabase db reset`.
 *
 * Patches config.toml for the current worktree (if applicable), then runs
 * `npx supabase db reset --local --yes` against the correct project_id and
 * ports.
 */

import { getBaseEnvPath } from "./local-config.mjs";
import {
  injectWorktreeEnv,
  loadEnvFile,
  npxBin,
  runCommand,
} from "./supabase-utils.mjs";
import { patchConfigToml, resolveWorktreePorts } from "./worktree-ports.mjs";

const rootDir = process.cwd();
const baseVars = await loadEnvFile(getBaseEnvPath(rootDir, process.env), false);
const env = injectWorktreeEnv({ ...baseVars, ...process.env });

const resolved = resolveWorktreePorts();
if (resolved.isWorktree) {
  patchConfigToml();
  console.log(
    `Worktree detected (${resolved.worktreeName}): targeting project_id=${resolved.projectId}`,
  );
}

console.log("Resetting local database (all migrations will be reapplied)...");
runCommand(npxBin, ["supabase", "db", "reset", "--local", "--yes"], env);
console.log("Done. Run `npm run seed:all` to restore local app data.");
