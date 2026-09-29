/** Small process helpers shared by the scripts. */

import { spawnSync } from "node:child_process";

export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Runs a command with inherited stdio, exiting this process if it fails. With
 * `allowFailure`, returns its exit status instead: `process.exit` skips
 * `finally` blocks, so a caller with something to clean up must exit itself.
 */
export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, { stdio: "inherit", env });

  if (result.error) throw result.error;
  const status = result.status ?? 1;
  if (allowFailure) return status;
  if (status !== 0) {
    process.exit(status);
  }
  return status;
}
