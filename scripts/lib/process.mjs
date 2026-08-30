/** Small process helpers shared by the scripts. */

import { spawnSync } from "node:child_process";

export const npxBin = process.platform === "win32" ? "npx.cmd" : "npx";
export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

/** Runs a command with inherited stdio, exiting this process if it fails. */
export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, { stdio: "inherit", env });

  if (result.error) throw result.error;
  if (allowFailure) return;
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}
