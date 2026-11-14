/**
 * The logic behind `./dev`, the one entry point for provisioning a worktree,
 * checking a host, running the game and running the gate. `dev` itself only
 * calls `main`.
 *
 * `run` and `test` build a command for the game starter (`scripts/dev.mjs`) and
 * the gate runner (`scripts/run-test-gate.mjs`) and hand over to it; `eval`
 * calls the evaluation dispatcher in-process. This file implements none of them.
 *
 * Only Node builtins and `scripts/lib` load at the top: `./dev doctor` must run
 * on a fresh clone with no dependencies installed, so the evaluation code (which
 * needs them) loads only for `eval`.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";

import { runDoctor } from "./lib/dev-doctor.mjs";
import { DevError, createWorktree, releaseWorktree } from "./lib/dev-worktree.mjs";

/**
 * Engine reads this text to learn that the repo can provision worktrees: it
 * looks for `worktree create` and `worktree release`.
 */
export const USAGE = `Usage: ./dev <verb> [args]

  doctor                           check this host; install what is missing
  run [free|paid|claude] [--db <name>]
                                   start the game (what \`npm run dev\` does)
  test [step ...]                  run the gate (what \`npm test\` does), or only the named steps
  eval [command] [args]            run an evaluation command; with none, list them
  worktree create <branch>         add a worktree beside the clone, with dependencies installed
  worktree release <branch>        remove that worktree and its development database
`;

/** @typedef {{ command: string, args: string[], cwd: string }} Command */

/** The game starter, with the arguments `./dev run` was given. @returns {Command} */
export function buildRunCommand(root, args) {
  return { command: process.execPath, args: [path.join(root, "scripts", "dev.mjs"), ...args], cwd: root };
}

/** The gate runner, with the steps `./dev test` was given. @returns {Command} */
export function buildTestCommand(root, steps) {
  return { command: process.execPath, args: [path.join(root, "scripts", "run-test-gate.mjs"), ...steps], cwd: root };
}

/** @param {Command} command @returns {number} */
function execute({ command, args, cwd }) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

/**
 * Runs one `./dev` invocation and returns its exit status.
 *
 * @param {string[]} argv arguments after `./dev`
 * @param {{ root: string, out?: (text: string) => void, err?: (text: string) => void, execute?: (command: Command) => number, evalCommands?: readonly object[] }} context
 *   `root` is the checkout `dev` lives in
 * @returns {Promise<number>}
 */
export async function main(
  argv,
  { root, out = console.log, err = console.error, execute: exec = execute, evalCommands },
) {
  const [verb, ...rest] = argv;

  try {
    switch (verb) {
      case undefined:
        out(USAGE.trimEnd());
        return 0;
      case "doctor":
        return await runDoctor(root, { log: out });
      case "run":
        return exec(buildRunCommand(root, rest));
      case "test":
        return exec(buildTestCommand(root, rest));
      case "eval": {
        const { runEval } = await import("../evaluation/core/dispatch.ts");
        const commands = evalCommands ?? (await import("../evaluation/commands.ts")).COMMANDS;
        return await runEval(rest, { root, out, err, env: process.env }, commands);
      }
      case "worktree": {
        const [action, branch, ...extra] = rest;
        if ((action === "create" || action === "release") && branch && extra.length === 0) {
          const run = action === "create" ? createWorktree : releaseWorktree;
          run(branch, { cwd: root, log: out });
          return 0;
        }
        err(`./dev worktree needs "create <branch>" or "release <branch>"\n\n${USAGE}`);
        return 2;
      }
      default:
        err(`Unknown verb "${verb}"\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    if (error instanceof DevError) {
      err(`dev: ${error.message}`);
      return 1;
    }
    throw error;
  }
}
