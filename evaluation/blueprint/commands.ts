/**
 * `./dev eval judge blueprint <file>` and `./dev eval validate <file>`.
 *
 * `judge blueprint` runs the mechanical checks, the analyzers and the eight
 * dimension judges on a blueprint file and writes one `result.json` with the
 * blueprint stored beside it. `validate` runs the schema and the mechanical
 * checks only, calls no model and needs no config. Both exit by the core rule
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
import { judgesFor } from "../core/registry.ts";
import type { Result } from "../core/result.ts";
import { createRunTimer, formatTimingSummary } from "../core/timing.ts";
import { blueprintSubjectId, findBrief, readJsonFile, requireBrief } from "./inputs.ts";
import type { JudgeSelection } from "./judge.ts";
import { judgeBlueprintSubject, validateBlueprintSubject } from "./subject.ts";

/** The binding the dimension judges run through. */
export const BLUEPRINT_JUDGE_BINDING = "blueprint-judge";

const BRIEF_OPTION: ReadonlyArray<[string, string]> = [
  ["--brief <path>", "the story brief the blueprint was written for: a file or a spec directory (default: brief.json beside the blueprint)"],
];

const JUDGE_HELP = formatHelp({
  usage: "judge blueprint <file>",
  summary:
    "Runs the mechanical checks, the analyzers and the eight dimension judges on a blueprint, and writes result.json with the blueprint stored beside it. Exits 0 when all pass, 2 when a check or judge fails or cannot judge, 1 when the run breaks.",
  options: [
    ...BRIEF_OPTION,
    ["--judges <a,b>", "run only these dimensions; the rest are skipped"],
    ["--no-judges", "run the checks and analyzers only; the judges are skipped"],
    ["--quiet", "no live progress digest"],
  ],
});

const VALIDATE_HELP = formatHelp({
  usage: "validate <file>",
  summary:
    "Checks a blueprint against the schema and the mechanical checks, calling no model. With --brief it also checks the counts the brief asks for. Exits 0 when all pass, 2 when a check fails, 1 when the file cannot be read.",
  options: BRIEF_OPTION,
});

function stringOption(value: OptionValue): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** `--judges` and `--no-judges`, as a selection. */
export function parseSelection(values: Record<string, OptionValue>): JudgeSelection {
  const named = stringOption(values.judges);
  if (values["no-judges"] === true) {
    if (named !== undefined) throw new UsageError("--judges and --no-judges cannot be used together");
    return "none";
  }
  if (named === undefined) return "all";
  const ids = named.split(",").map((id) => id.trim()).filter(Boolean);
  const known = judgesFor("blueprint").map((entry) => entry.id);
  const unknown = ids.filter((id) => !known.includes(id));
  if (ids.length === 0 || unknown.length > 0) {
    throw new UsageError(`--judges needs dimension ids from: ${known.join(", ")}${unknown.length > 0 ? ` (got ${unknown.join(", ")})` : ""}`);
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

async function readInputs(file: string, briefFlag: string | undefined, briefRequired: boolean) {
  const blueprintFile = path.resolve(file);
  const blueprint = await readJsonFile(blueprintFile, "blueprint");
  const found = await findBrief(blueprintFile, briefFlag);
  const source = briefRequired ? requireBrief(found) : found;
  const brief = source ? await readJsonFile(source.file, "brief") : null;
  return { blueprintFile, blueprint, brief };
}

export const judgeBlueprintCommand: EvalCommand = {
  name: "judge blueprint",
  summary: "Judge a blueprint: mechanical checks, analyzers and the dimension judges",
  help: JUDGE_HELP,
  async run(argv, context) {
    const parsed = parseCommandArgs(argv, {
      options: {
        brief: { type: "string" },
        judges: { type: "string" },
        "no-judges": { type: "boolean" },
        quiet: { type: "boolean" },
      },
      positionals: { min: 1, max: 1 },
    });
    const { common, values, positionals } = parsed;
    const selection = parseSelection(values);
    const inputs = await readInputs(positionals[0], stringOption(values.brief), true);
    const binding = judgeBindingFor(selection, context, common);

    const run = createRunFolder({
      outputRoot: resolveOutputRoot(common.outputRoot, context.env),
      command: "judge blueprint",
      argv,
      root: context.root,
      bindings: binding ? [binding] : [],
    });
    const id = blueprintSubjectId(inputs.blueprintFile);
    const folder = run.subject({ kind: "blueprint", id });
    context.out(`[eval] run=${run.dir}`);
    const result = await judgeBlueprintSubject(
      { run, folder, id, timer: createRunTimer() },
      { brief: inputs.brief, blueprint: inputs.blueprint, binding, selection, quiet: values.quiet === true, write: context.out },
    );
    const index = await run.finish();
    for (const line of summaryLines(result, folder.resultFile)) context.out(line);
    return index.exit_code;
  },
};

export const validateCommand: EvalCommand = {
  name: "validate",
  summary: "Check a blueprint against the schema and the mechanical checks, with no model",
  help: VALIDATE_HELP,
  async run(argv, context) {
    const { common, values, positionals } = parseCommandArgs(argv, {
      options: { brief: { type: "string" } },
      positionals: { min: 1, max: 1 },
    });
    const inputs = await readInputs(positionals[0], stringOption(values.brief), false);
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
      { brief: inputs.brief, blueprint: inputs.blueprint },
    );
    const index = await run.finish();
    for (const line of summaryLines(result, folder.resultFile)) context.out(line);
    return index.exit_code;
  },
};
