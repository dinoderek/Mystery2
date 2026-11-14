/**
 * `./dev eval <command>`: finds the registered command the arguments name and
 * calls it in-process with the rest of its argv and its dependencies, so a
 * test can run a whole command on stub bindings.
 *
 * With no command, or `--help`, it lists the commands and exits 0. An unknown
 * command exits 1. `<command> --help` prints that command's help. A command
 * returns its own exit code (`exitCodeFor` in `result.ts`); one that throws
 * broke the run, which is exit code 1.
 */

import { ConfigError, UsageError } from "./errors.ts";
import { EXIT_PASSED, EXIT_RUN_BROKE } from "./result.ts";

export interface EvalContext {
  /** The repo root. */
  root: string;
  out: (text: string) => void;
  err: (text: string) => void;
  env: NodeJS.ProcessEnv;
}

export interface EvalCommand {
  /** One or more words, e.g. `judge blueprint`. */
  name: string;
  summary: string;
  /** The full `--help` text (`formatHelp` in `args.ts`). */
  help: string;
  run(argv: string[], context: EvalContext): Promise<number>;
}

/** The command list `./dev eval` prints. */
export function listCommands(commands: readonly EvalCommand[]): string {
  const lines = ["Usage: ./dev eval <command> [options]", "", "Commands:"];
  if (commands.length === 0) {
    lines.push("  (none registered)");
  } else {
    const width = Math.max(...commands.map((command) => command.name.length));
    for (const command of commands) lines.push(`  ${command.name.padEnd(width)}  ${command.summary}`);
  }
  lines.push("", "Run ./dev eval <command> --help for a command's options.");
  return lines.join("\n");
}

/** The command whose words begin `argv`, the longest such name winning. */
function findCommand(
  argv: readonly string[],
  commands: readonly EvalCommand[],
): { command: EvalCommand; rest: string[] } | null {
  let best: { command: EvalCommand; rest: string[] } | null = null;
  for (const command of commands) {
    const words = command.name.split(" ");
    const matches = words.every((word, i) => argv[i] === word);
    if (matches && (!best || words.length > best.command.name.split(" ").length)) {
      best = { command, rest: argv.slice(words.length) };
    }
  }
  return best;
}

function isHelp(arg: string | undefined): boolean {
  return arg === "--help" || arg === "-h" || arg === "help";
}

export async function runEval(
  argv: readonly string[],
  context: EvalContext,
  commands: readonly EvalCommand[],
): Promise<number> {
  if (argv.length === 0 || isHelp(argv[0])) {
    context.out(listCommands(commands));
    return EXIT_PASSED;
  }
  const found = findCommand(argv, commands);
  if (!found) {
    context.err(`Unknown eval command "${argv.join(" ")}"\n\n${listCommands(commands)}`);
    return EXIT_RUN_BROKE;
  }
  const { command, rest } = found;
  if (rest.includes("--help") || rest.includes("-h")) {
    context.out(command.help);
    return EXIT_PASSED;
  }
  try {
    return await command.run(rest, context);
  } catch (error) {
    if (error instanceof UsageError) {
      context.err(`eval ${command.name}: ${error.message}\n\n${command.help}`);
    } else if (error instanceof ConfigError) {
      context.err(`eval ${command.name}: ${error.message}`);
    } else {
      context.err(`eval ${command.name}: the run broke: ${(error as Error)?.stack ?? String(error)}`);
    }
    return EXIT_RUN_BROKE;
  }
}
