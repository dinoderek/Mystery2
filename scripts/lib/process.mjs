/** Small process helpers shared by the scripts. */

import { spawnSync } from "node:child_process";
import os from "node:os";

export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

/**
 * Runs a command with inherited stdio, exiting this process if it fails. With
 * `allowFailure`, returns its exit status instead: `process.exit` skips
 * `finally` blocks, so a caller with something to clean up must exit itself.
 */
export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, { stdio: "inherit", env });

  if (result.error) throw result.error;
  // A child killed by a signal has no status; report it as a shell would.
  const status = result.status ?? 128 + (os.constants.signals[result.signal] ?? 0);
  if (allowFailure) return status;
  if (status !== 0) {
    process.exit(status);
  }
  return status;
}
