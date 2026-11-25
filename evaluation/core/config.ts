/**
 * The evaluation config: one file naming every model binding and its model.
 *
 * `evaluation/config.json` (gitignored) is read when it exists, else the
 * committed `evaluation/config.example.json`; `--config <file>` replaces both.
 * Each top-level key is a binding name; keys starting with `_` are comments,
 * and `developer` and `perf` are not bindings. `developer` is the name a run
 * records as who ran it (`configuredDeveloper`), a name and never an email
 * address; null, as in the committed example, leaves it to the OS user name.
 * `perf.remote` is the git URL (or path) of the shared data repository
 * `perf push` sends run records to (`configuredPerfRemote`); null, as in the
 * committed example, means none, and `perf push` stops naming this setting.
 * A binding says how to start the wrapper that makes one model call:
 *
 * - `cmd`, `args`: the wrapper and its arguments. A `cmd` containing a `/` is
 *   relative to the repo root, else it is looked up on `PATH`. `args` may name
 *   `{{system_prompt_file}}` and `{{user_message_file}}`.
 * - `extract_path`: the dotted path to the model's answer inside the JSON the
 *   wrapper prints, or null when the whole of stdout is the answer.
 * - `model`: handed to the wrapper as `EVAL_MODEL`; null when the wrapper
 *   calls no model (the stubs), or the command must be given one.
 * - `timeout_ms`, `retries`: per attempt, and how many more attempts after the
 *   first.
 *
 * A binding that is missing, or whose command does not exist, is an error when
 * a command asks for it: nothing is skipped quietly.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { ConfigError, UsageError } from "./errors.ts";

export const CONFIG_FILE = path.join("evaluation", "config.json");
export const EXAMPLE_CONFIG_FILE = path.join("evaluation", "config.example.json");

/** The top-level key naming who ran: not a binding. */
export const DEVELOPER_KEY = "developer";

/** The top-level key holding the performance settings, `remote` among them: not a binding. */
export const PERF_KEY = "perf";

const BINDING_NAME = /^[a-z][a-z0-9-]*$/;

export const BindingSchema = z
  .object({
    description: z.string().optional(),
    cmd: z.string().min(1),
    args: z.array(z.string()).default([]),
    extract_path: z.string().min(1).nullable().default(null),
    model: z.string().min(1).nullable().default(null),
    timeout_ms: z.number().int().positive(),
    retries: z.number().int().min(0).default(0),
  })
  .strict();

export type Binding = z.infer<typeof BindingSchema>;

/** A binding ready to start: its name, and its command as an absolute path. */
export interface ResolvedBinding extends Binding {
  name: string;
  command: string;
}

export interface EvalConfig {
  /** The file the bindings were read from, absolute. */
  file: string;
  bindings: Record<string, Binding>;
}

export interface LoadConfigOptions {
  /** The repo root, against which the config files and commands resolve. */
  root: string;
  /** `--config`, resolved against the working directory when relative. */
  configPath?: string;
  /** `--model-override`: binding name to model, for this run only. */
  modelOverrides?: Record<string, string>;
}

function chooseConfigFile(root: string, configPath: string | undefined): string {
  if (configPath) return path.resolve(configPath);
  const own = path.join(root, CONFIG_FILE);
  return fs.existsSync(own) ? own : path.join(root, EXAMPLE_CONFIG_FILE);
}

function parseBindings(file: string, raw: unknown): Record<string, Binding> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ConfigError(`${file}: expected an object mapping binding names to bindings`);
  }
  const bindings: Record<string, Binding> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (name.startsWith("_") || name === DEVELOPER_KEY || name === PERF_KEY) continue;
    if (!BINDING_NAME.test(name)) {
      throw new ConfigError(`${file}: binding name "${name}" must be lower-case words joined by "-"`);
    }
    const parsed = BindingSchema.safeParse(value);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "(binding)"}: ${issue.message}`)
        .join("; ");
      throw new ConfigError(`${file}: binding "${name}" is invalid: ${issues}`);
    }
    bindings[name] = parsed.data;
  }
  return bindings;
}

/** The config file a run reads, parsed as JSON. */
function readConfigFile({ root, configPath }: Pick<LoadConfigOptions, "root" | "configPath">): { file: string; raw: unknown } {
  const file = chooseConfigFile(root, configPath);
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (error) {
    throw new ConfigError(`cannot read config ${file}: ${(error as Error).message}`);
  }
  try {
    return { file, raw: JSON.parse(text) };
  } catch (error) {
    throw new ConfigError(`config ${file} is not JSON: ${(error as Error).message}`);
  }
}

/** Reads the config file and applies this run's model overrides. */
export function loadConfig({ root, configPath, modelOverrides = {} }: LoadConfigOptions): EvalConfig {
  const { file, raw } = readConfigFile({ root, configPath });
  const bindings = parseBindings(file, raw);
  for (const [name, model] of Object.entries(modelOverrides)) {
    const binding = bindings[name];
    if (!binding) throw unknownBinding(file, bindings, name);
    bindings[name] = { ...binding, model };
  }
  return { file, bindings };
}

/**
 * The config's top-level `developer`, or null when it has none, or when there
 * is no config file at all (a command that calls no model needs none; one that
 * does fails on its own bindings). A name, never an email address: the value is
 * recorded in every run and shared.
 */
export function configuredDeveloper(options: Pick<LoadConfigOptions, "root" | "configPath">): string | null {
  if (!fs.existsSync(chooseConfigFile(options.root, options.configPath))) return null;
  const { file, raw } = readConfigFile(options);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const developer = (raw as Record<string, unknown>)[DEVELOPER_KEY];
  if (developer === undefined || developer === null) return null;
  if (typeof developer !== "string" || developer.trim() === "" || developer.includes("@")) {
    throw new ConfigError(`${file}: "${DEVELOPER_KEY}" must be a name (not blank, not an email address)`);
  }
  return developer.trim();
}

/**
 * The config's `perf.remote`, or null when it has none (or there is no config
 * file): where the shared data repository is, as `git clone` is told it. Never
 * a binding; a value that is not a non-blank string is a config error.
 */
export function configuredPerfRemote(options: Pick<LoadConfigOptions, "root" | "configPath">): string | null {
  if (!fs.existsSync(chooseConfigFile(options.root, options.configPath))) return null;
  const { file, raw } = readConfigFile(options);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const perf = (raw as Record<string, unknown>)[PERF_KEY];
  if (perf === undefined || perf === null) return null;
  if (typeof perf !== "object" || Array.isArray(perf)) throw new ConfigError(`${file}: "${PERF_KEY}" must be an object`);
  const remote = (perf as Record<string, unknown>).remote;
  if (remote === undefined || remote === null) return null;
  if (typeof remote !== "string" || remote.trim() === "") throw new ConfigError(`${file}: "${PERF_KEY}.remote" must be a git URL or path, not blank`);
  return remote.trim();
}

function unknownBinding(file: string, bindings: Record<string, Binding>, name: string): ConfigError {
  const known = Object.keys(bindings).join(", ") || "none";
  return new ConfigError(`${file} has no binding "${name}". Bindings: ${known}`);
}

function isExecutable(file: string): boolean {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** The absolute path `cmd` starts, or null when there is no such command. */
export function findCommand(cmd: string, root: string, envPath = process.env.PATH ?? ""): string | null {
  if (cmd.includes("/")) {
    const file = path.resolve(root, cmd);
    return isExecutable(file) ? file : null;
  }
  for (const dir of envPath.split(path.delimiter)) {
    if (!dir) continue;
    const file = path.join(dir, cmd);
    if (isExecutable(file)) return file;
  }
  return null;
}

/**
 * The named binding, ready to start. Throws when the config has no such
 * binding or its command does not exist.
 */
export function resolveBinding(
  config: EvalConfig,
  name: string,
  { root, envPath }: { root: string; envPath?: string },
): ResolvedBinding {
  const binding = config.bindings[name];
  if (!binding) throw unknownBinding(config.file, config.bindings, name);
  const command = findCommand(binding.cmd, root, envPath);
  if (!command) {
    throw new ConfigError(
      `binding "${name}" in ${config.file} cannot run: command "${binding.cmd}" not found or not executable`,
    );
  }
  return { ...binding, name, command };
}

/** Parses `--model-override <binding>=<model>` values into a map. */
export function parseModelOverrides(values: readonly string[]): Record<string, string> {
  const overrides: Record<string, string> = {};
  for (const value of values) {
    const match = /^([^=]*)=(.*)$/.exec(value);
    const [binding, model] = match ? [match[1].trim(), match[2].trim()] : ["", ""];
    if (!binding || !model) {
      throw new UsageError(`--model-override needs <binding>=<model>, got "${value}"`);
    }
    overrides[binding] = model;
  }
  return overrides;
}
