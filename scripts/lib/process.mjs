/** Small process helpers shared by the scripts. */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import { stripVTControlCharacters } from "node:util";

export const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";

/** A child's exit as a status: one killed by a signal has none, so report it as a shell would. */
function exitStatus(code, signal) {
  return code ?? 128 + (os.constants.signals[signal] ?? 0);
}

/**
 * Runs a command with inherited stdio, exiting this process if it fails. With
 * `allowFailure`, returns its exit status instead: `process.exit` skips
 * `finally` blocks, so a caller with something to clean up must exit itself.
 */
export function runCommand(command, args, env, allowFailure = false) {
  const result = spawnSync(command, args, { stdio: "inherit", env });

  if (result.error) throw result.error;
  const status = exitStatus(result.status, result.signal);
  if (allowFailure) return status;
  if (status !== 0) {
    process.exit(status);
  }
  return status;
}

/**
 * Starts a long-running server and waits for it without blocking, so this
 * process outlives it and can act once it stops.
 *
 * SIGINT and SIGTERM sent to this process are forwarded to the child, for the
 * rest of this process's life: Ctrl-C stops the server, and this process waits
 * for it rather than dying first, so a second Ctrl-C cannot cut short what it
 * does after the server stops either.
 *
 * With `serverLog`, the child's stdout and stderr are piped: each chunk is
 * still written to this process's own stream, and appended to that file
 * without colour codes. Without it they are inherited.
 *
 * @param {{ command: string, args: string[], cwd?: string, env: Record<string, string | undefined>, stdin?: "inherit" | "ignore", serverLog?: string | null }} options
 * @returns {{ child: import("node:child_process").ChildProcess, exited: () => boolean, exit: Promise<number> }}
 *   `exit` resolves to the child's exit status
 */
export function startServer({ command, args, cwd, env, stdin = "inherit", serverLog = null }) {
  const output = serverLog ? "pipe" : "inherit";
  const child = spawn(command, args, { cwd, env, stdio: [stdin, output, output] });
  const logFd = serverLog ? fs.openSync(serverLog, "a") : null;

  if (logFd !== null) {
    const tee = (target) => (chunk) => {
      target.write(chunk);
      fs.writeSync(logFd, stripVTControlCharacters(chunk.toString("utf8")));
    };
    child.stdout.on("data", tee(process.stdout));
    child.stderr.on("data", tee(process.stderr));
  }

  let exited = false;
  const stopped = () => {
    if (exited) return false;
    exited = true;
    if (logFd !== null) fs.closeSync(logFd);
    return true;
  };
  const exit = new Promise((resolve, reject) => {
    // Only a child that never started ends here; a failed kill leaves it running.
    child.on("error", (error) => {
      if (child.pid === undefined && stopped()) reject(error);
    });
    // `close`, not `exit`: it waits for the piped streams to end, so the log
    // holds the server's last words.
    child.on("close", (code, signal) => {
      if (stopped()) resolve(exitStatus(code, signal));
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      if (!exited) child.kill(signal);
    });
  }

  return { child, exited: () => exited, exit };
}
