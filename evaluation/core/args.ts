/**
 * The one argument parser for evaluation commands, on Node's `parseArgs`.
 * Every command takes the common options below as well as its own; an unknown
 * option or a missing value is a `UsageError`.
 */

import { parseArgs } from "node:util";
import type { ParseArgsOptionsConfig } from "node:util";

import { parseModelOverrides } from "./config.ts";
import { UsageError } from "./errors.ts";

export const COMMON_OPTIONS = {
  help: { type: "boolean", short: "h" },
  config: { type: "string" },
  "output-root": { type: "string" },
  "model-override": { type: "string", multiple: true },
  suite: { type: "string" },
  label: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

const COMMON_HELP: ReadonlyArray<[string, string]> = [
  ["--config <file>", "the bindings file (default: evaluation/config.json, else evaluation/config.example.json)"],
  ["--output-root <dir>", "where runs are written (default: $MYSTERYEVALS_DIR, else ~/mysteryevals)"],
  ["--model-override <binding>=<model>", "use another model for one binding in this run; repeatable"],
  ["--suite <name>", "name the suite a run belongs to; run commands record it, null when absent"],
  ["--label <text>", "a free-text label a run records beside its suite, null when absent"],
  ["-h, --help", "print this help"],
];

export interface CommonArgs {
  help: boolean;
  configPath: string | undefined;
  outputRoot: string | undefined;
  modelOverrides: Record<string, string>;
  /** `--suite`: recorded by the run commands; null when not given. */
  suite: string | null;
  /** `--label`: recorded by the run commands; null when not given. */
  label: string | null;
}

export type OptionValue = string | boolean | Array<string | boolean> | undefined;

export interface ParsedArgs {
  common: CommonArgs;
  /** The command's own options, by name, as `parseArgs` returns them. */
  values: Record<string, OptionValue>;
  positionals: string[];
}

export interface CommandSpec {
  options?: ParseArgsOptionsConfig;
  /** How many positionals the command takes, at least and at most. */
  positionals?: { min: number; max: number };
}

function checkPositionals(count: number, { min, max }: { min: number; max: number }): void {
  if (count < min) throw new UsageError(`expected at least ${min} argument(s), got ${count}`);
  if (count > max) throw new UsageError(`expected at most ${max} argument(s), got ${count}`);
}

/** A string option's trimmed value, null when it was not given; given but blank is a usage error. */
function nonBlank(name: string, value: OptionValue): string | null {
  if (typeof value !== "string") return null;
  if (value.trim() === "") throw new UsageError(`--${name} needs a value`);
  return value.trim();
}

/** Parses a command's argv. With `--help`, positional counts are not checked. */
export function parseCommandArgs(argv: readonly string[], spec: CommandSpec = {}): ParsedArgs {
  const own = spec.options ?? {};
  for (const name of Object.keys(own)) {
    if (name in COMMON_OPTIONS) throw new Error(`option --${name} is common to every command`);
  }
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: { ...COMMON_OPTIONS, ...own },
      allowPositionals: (spec.positionals?.max ?? 0) > 0,
      strict: true,
    });
  } catch (error) {
    throw new UsageError((error as Error).message);
  }
  const {
    help,
    config,
    "output-root": outputRoot,
    "model-override": overrides,
    suite,
    label,
    ...values
  } = parsed.values as Record<string, OptionValue>;
  const common: CommonArgs = {
    help: help === true,
    configPath: typeof config === "string" ? config : undefined,
    outputRoot: typeof outputRoot === "string" ? outputRoot : undefined,
    modelOverrides: parseModelOverrides(Array.isArray(overrides) ? overrides.map(String) : []),
    suite: nonBlank("suite", suite),
    label: nonBlank("label", label),
  };
  if (!common.help && spec.positionals) checkPositionals(parsed.positionals.length, spec.positionals);
  return { common, values, positionals: parsed.positionals };
}

export interface HelpSpec {
  /** e.g. `judge blueprint <file>`. */
  usage: string;
  summary: string;
  options?: ReadonlyArray<[string, string]>;
}

function optionLines(options: ReadonlyArray<[string, string]>): string[] {
  const width = Math.max(...options.map(([flag]) => flag.length));
  return options.map(([flag, text]) => `  ${flag.padEnd(width)}  ${text}`);
}

/** A command's `--help` text: usage, summary, its options, then the common ones. */
export function formatHelp({ usage, summary, options = [] }: HelpSpec): string {
  const lines = [`Usage: ./dev eval ${usage} [options]`, "", summary, ""];
  if (options.length > 0) lines.push("Options:", ...optionLines(options), "");
  lines.push("Common options:", ...optionLines(COMMON_HELP));
  return lines.join("\n");
}
