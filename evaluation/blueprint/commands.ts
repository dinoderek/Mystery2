/**
 * `./dev eval judge blueprint <file>` and `./dev eval validate <file>`.
 *
 * `judge blueprint` runs the mechanical check and the judges on a clue-graph
 * case file and writes one `result.json` with the case stored beside it; it
 * needs no brief. `validate` runs the mechanical check only, calls no model
 * and needs no config. Both exit by the core rule
 * (`exitCodeFor`): 0 all passed, 1 the run broke, 2 a check or judge failed.
 */

import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { runIdentity } from "../core/run-identity.ts";
import { judgesFor } from "../core/registry.ts";
import type { Result } from "../core/result.ts";
import { createRunTimer, formatTimingSummary } from "../core/timing.ts";
import { blueprintSubjectId, readJsonFile } from "./inputs.ts";
import type { JudgeSelection } from "./judge.ts";
import { judgeBlueprintSubject, validateBlueprintSubject } from "./subject.ts";

/** The binding the dimension judges run through. */
export const BLUEPRINT_JUDGE_BINDING = "blueprint-judge";

const JUDGE_HELP = formatHelp({
  usage: "judge blueprint <file>",
  summary:
    "Runs the case check and the clue-graph judges on a clue-graph case, and writes result.json with the case stored beside it. Exits 0 when all pass, 2 when a check or judge fails or cannot judge, 1 when the run breaks.",
  options: [
    ["--judges <a,b>", "run only these judges; the rest are skipped"],
    ["--no-judges", "run the check only; the judges are skipped"],
    ["--quiet", "no live progress digest"],
  ],
});

const VALIDATE_HELP = formatHelp({
  usage: "validate <file>",
  summary:
    "Checks a clue-graph case against the case check, calling no model. Exits 0 when it passes, 2 when it fails, 1 when the file cannot be read.",
});

function stringOption(value: OptionValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `--judges` and `--no-judges`, as a selection of the judges a case has. */
export function parseSelection(values: Record<string, OptionValue>): JudgeSelection {
  const named = stringOption(values.judges);
  if (values["no-judges"] === true) {
    if (named !== undefined) throw new UsageError("--judges and --no-judges cannot be used together");
    return "none";
  }
  if (named === undefined) return "all";
  const ids = named.split(",").map((id) => id.trim()).filter(Boolean);
  const known = judgesFor("blueprint", { candidates: true }).map((entry) => entry.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new UsageError(`--judges needs judge ids from: ${known.join(", ")}${unknown.length > 0 ? ` (got ${unknown.join(", ")})` : ""}`);
  }
  return ids;
}

/** The judge binding a selection needs; null when it runs no judge. */
export function judgeBindingFor(
  selection: JudgeSelection,
  context: EvalContext,
  args: { configPath: string | undefined; modelOverrides: Record<string, string> },
): ResolvedBinding | null {
  if (selection === "none") return null;
  const config = loadConfig({ root: context.root, configPath: args.configPath, modelOverrides: args.modelOverrides });
  return resolveBinding(config, BLUEPRINT_JUDGE_BINDING, { root: context.root });
}

function count(result: Result, tier: "mechanical" | "judge") {
  const verdicts = result.verdicts.filter((v) => v.tier === tier);
  return { pass: verdicts.filter((v) => v.status === "pass").length, total: verdicts.length };
}

/** The lines a command prints about one result. */
export function summaryLines(result: Result, resultFile: string): string[] {
  const lines: string[] = [];
  if (result.timing) lines.push("", formatTimingSummary(result.timing));
  for (const verdict of result.verdicts) {
    if (verdict.status === "fail" || verdict.status === "error") {
      lines.push(`[eval] ${verdict.status.toUpperCase()} ${verdict.id}${verdict.reason ? `: ${verdict.reason}` : ""}`);
    }
  }
  const mechanical = count(result, "mechanical");
  const judges = count(result, "judge");
  const { counts } = result.summary;
  lines.push(
    "",
    `[eval] result: ${resultFile}`,
    `[eval] summary: mechanical ${mechanical.pass}/${mechanical.total} pass, judges ${judges.pass}/${judges.total} pass, ${counts.fail} failed, ${counts.error} errored, ${counts.skipped} skipped`,
  );
  if (result.run_error) lines.push(`[eval] run error in ${result.run_error.stage}: ${result.run_error.message}`);
  return lines;
}

async function readInput(file: string) {
  const blueprintFile = path.resolve(file);
  return { blueprintFile, blueprint: await readJsonFile(blueprintFile, "case") };
}

export const judgeBlueprintCommand: EvalCommand = {
  name: "judge blueprint",
  summary: "Judge a clue-graph case: the case check and the clue-graph judges",
  help: JUDGE_HELP,
  async run(argv, context) {
    const parsed = parseCommandArgs(argv, {
      options: {
        judges: { type: "string" },
        "no-judges": { type: "boolean" },
        quiet: { type: "boolean" },
      },
      positionals: { min: 1, max: 1 },
    });
    const { common, values, positionals } = parsed;
    const inputs = await readInput(positionals[0]);
    const selection = parseSelection(values);
    const binding = judgeBindingFor(selection, context, common);

    const run = createRunFolder({
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      command: "judge blueprint",
      argv,
      root: context.root,
      identity: runIdentity(common, context.root),
      bindings: binding ? [binding] : [],
    });
    const id = blueprintSubjectId(inputs.blueprintFile);
    const folder = run.subject({ kind: "blueprint", id });
    context.out(`[eval] run=${run.dir}`);
    const result = await judgeBlueprintSubject(
      { run, folder, id, timer: createRunTimer() },
      { brief: null, blueprint: inputs.blueprint, binding, selection, quiet: values.quiet === true, write: context.out },
    );
    const index = await run.finish();
    for (const line of summaryLines(result, folder.resultFile)) context.out(line);
    return index.exit_code;
  },
};

export const validateCommand: EvalCommand = {
  name: "validate",
  summary: "Check a clue-graph case against the case check, with no model",
  help: VALIDATE_HELP,
  async run(argv, context) {
    const { common, positionals } = parseCommandArgs(argv, {
      options: {},
      positionals: { min: 1, max: 1 },
    });
    const inputs = await readInput(positionals[0]);
    const run = createRunFolder({
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      command: "validate",
      argv,
      root: context.root,
      bindings: [],
    });
    const id = blueprintSubjectId(inputs.blueprintFile);
    const folder = run.subject({ kind: "blueprint", id });
    const result = await validateBlueprintSubject(
      { run, folder, id, timer: createRunTimer() },
      { brief: null, blueprint: inputs.blueprint },
    );
    const index = await run.finish();
    for (const line of summaryLines(result, folder.resultFile)) context.out(line);
    return index.exit_code;
  },
};
