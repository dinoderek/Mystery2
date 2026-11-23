/**
 * Judging one blueprint: the mechanical checks, then every blueprint dimension
 * in parallel. A dimension is its analyzer (code, when the registry gives it
 * one) and its judge (one model call through the runner). Each is a verdict of
 * its own: the analyzer's id is `<dimension>.analyzer`, the judge's is the
 * dimension's. What the judges are sent and how a verdict is reached are the
 * registry's and the composer's (`evaluation/core/`); this file only sequences
 * them and records what happened.
 *
 * Nothing is skipped quietly. A judge is `skipped` only because a flag asked
 * (`--no-judges`, or `--judges` left it out); a judge that could not run, or
 * whose answer never passed the schema, is `error`. A candidate judge runs
 * only when `--judges` names it, and is absent from the result otherwise.
 *
 * A clue-graph case (`docs/clue-graph.md`) runs its own check and judges, the
 * registry's `format: "clue_graph"` entries, and needs no brief: each judge is
 * sent the `case`, and the step judge also the `player_view`
 * (`./player-view.ts`).
 */

import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";
import { ClueGraphCaseSchema, isClueGraphFile, type ClueGraphCase } from "../../packages/shared/src/clue-graph-schema.ts";
import type { ResolvedBinding } from "../core/config.ts";
import { UsageLimitError } from "../core/errors.ts";
import { validateJudgeOutput } from "../core/judge-output.ts";
import { loadAnalyzer, loadCheck, loadJudge } from "../core/judge-loader.ts";
import { composeJudgeSystemPrompt, composeJudgeUserMessage } from "../core/judge-prompt.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { checksFor, getJudgeEntry, judgesFor } from "../core/registry.ts";
import type { BlueprintFormat, JudgeEntry } from "../core/registry.ts";
import type { Status, Verdict } from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { majorFindingsVerdict } from "../judges/index.ts";
import type { CallMemo } from "../core/runner.ts";
import { createRunTimer } from "../core/timing.ts";
import type { DimensionTimer, RunTimer } from "../core/timing.ts";
import { playerView } from "./player-view.ts";

/** Which judges run: all, none (`--no-judges`), or the named ones (`--judges a,b`). */
export type JudgeSelection = "all" | "none" | readonly string[];

export function selects(selection: JudgeSelection, id: string): boolean {
  if (selection === "all") return true;
  return selection !== "none" && selection.includes(id);
}

/** Why a judge was left out, for its `skipped` verdict. */
function skipReason(selection: JudgeSelection): string {
  return selection === "none" ? "left out by --no-judges" : "left out by --judges";
}

/** The format a blueprint file is in: a clue-graph case claims one by its `format`, anything else is read as Blueprint V2. */
export function blueprintFormat(blueprint: unknown): BlueprintFormat {
  return isClueGraphFile(blueprint) ? "clue_graph" : "v2";
}

interface MechanicalReport {
  id: string;
  status: Status;
  details: unknown;
}

/**
 * Runs the mechanical checks of the blueprint's format: the one given, which
 * a generator asked for, else the one the file claims. Without a brief, the
 * checks that compare a Blueprint V2 with it are not run: only the schema and
 * the structural ones.
 */
export async function runMechanical(brief: unknown, blueprint: unknown, format: BlueprintFormat = blueprintFormat(blueprint)): Promise<Verdict[]> {
  const entries = checksFor("blueprint", format);
  const run = (await loadCheck(entries[0].id)) as (input: { brief: unknown; blueprintCandidate: unknown }) => MechanicalReport[];
  const known = new Set(entries.map((entry) => entry.id));
  return run({ brief, blueprintCandidate: blueprint }).map((report) => {
    if (!known.has(report.id)) throw new Error(`mechanical check "${report.id}" is not in the registry`);
    const verdict: Verdict = { id: report.id, tier: "mechanical", status: report.status };
    if (report.details !== null && report.details !== undefined) verdict.details = report.details;
    return verdict;
  });
}

export interface BlueprintJudgeInput {
  brief: unknown;
  /** The blueprint as read from its file. */
  blueprint: unknown;
  /** The judge binding; null only when no judge is to run. */
  binding: ResolvedBinding | null;
  selection: JudgeSelection;
  /** Where each judge call's prompts and logs go. */
  logDir: string;
  /** The subject's folder, which the judge wrapper puts its agent workspaces in. */
  runDir: string;
  timer: RunTimer;
  quiet: boolean;
  write: (line: string) => void;
  /** Finished judge calls to answer from (`CallMemo` in `core/runner.ts`). */
  memo?: CallMemo;
  /** The format to judge it as; by default, the one the file claims. */
  format?: BlueprintFormat;
}

interface Dimension {
  entry: JudgeEntry;
  context: Record<string, unknown> | null;
  /** The blueprint, or the clue-graph case, after schema validation; null when it failed. */
  parsed: unknown;
}

/** What a judge is sent besides its id and context: a V2 blueprint's brief and blueprint, or a case and, when its entry asks, the player's view. */
function subjectParts(dimension: Dimension, input: BlueprintJudgeInput): Record<string, unknown> {
  const { entry } = dimension;
  if (entry.format !== "clue_graph") return { story_brief: input.brief, blueprint: input.blueprint };
  return {
    case: input.blueprint,
    ...(entry.playerView ? { player_view: playerView(dimension.parsed as ClueGraphCase) } : {}),
  };
}

function errorVerdict(id: string, tier: Verdict["tier"], reason: string): Verdict {
  return { id, tier, status: "error", reason };
}

function skippedVerdicts(entry: JudgeEntry, reason: string): Verdict[] {
  const verdicts: Verdict[] = [];
  if (entry.analyzer) verdicts.push({ id: `${entry.id}.analyzer`, tier: "analyzer", status: "skipped", reason });
  verdicts.push({ id: entry.id, tier: "judge", status: "skipped", reason });
  return verdicts;
}

/** The analyzer's verdict; an analyzer that throws is an `error` verdict, not a thrown error. */
async function analyze(dimension: Dimension, input: BlueprintJudgeInput, timer: DimensionTimer): Promise<Verdict | null> {
  const { entry } = dimension;
  if (!entry.analyzer) return null;
  const id = `${entry.id}.analyzer`;
  try {
    const analyzer = await timer.step("load_analyzer", () => loadAnalyzer(entry.id));
    const outcome = (await timer.step("analyzer", async () =>
      analyzer?.analyze({ brief: input.brief, blueprint: dimension.parsed, context: dimension.context }),
    )) as { status?: unknown; details?: unknown } | undefined;
    if (outcome?.status !== "pass" && outcome?.status !== "fail") {
      throw new Error(`analyzer returned status ${JSON.stringify(outcome?.status)}, expected "pass" or "fail"`);
    }
    input.write(`[eval][${entry.id}] analyzer: ${outcome.status} (${formatDuration(timer.lastStepMs())})`);
    return { id, tier: "analyzer", status: outcome.status, details: outcome.details };
  } catch (error) {
    return errorVerdict(id, "analyzer", (error as Error).message);
  }
}

/**
 * The verdict an answer reaches by its entry's rule: the stated one, or, for a
 * judge that fails on a `major` finding, the findings' with their counts.
 */
function reachVerdict(entry: JudgeEntry, answer: Record<string, unknown>): Pick<Verdict, "status" | "findings" | "details"> {
  if (entry.verdict === "stated") return { status: answer.verdict === "pass" ? "pass" : "fail" };
  return majorFindingsVerdict(answer);
}

/** One judge call: compose, send, check the answer's shape, read the verdict. */
async function judge(dimension: Dimension, input: BlueprintJudgeInput, timer: DimensionTimer, binding: ResolvedBinding): Promise<Verdict> {
  const { entry, context } = dimension;
  try {
    const definition = await timer.step("load_definition", () => loadJudge(entry));
    const systemPrompt = await timer.step("compose_prompt", async () => composeJudgeSystemPrompt(definition, context));
    const userMessage = composeJudgeUserMessage(entry.id, context, subjectParts(dimension, input));
    const outcome = await timer.step(
      "judge",
      () =>
        runModel({
          binding,
          step: `judge-${entry.id}`,
          systemPrompt,
          userMessage,
          logDir: input.logDir,
          env: { EVAL_DIMENSION_ID: entry.id, EVAL_RUN_DIR: input.runDir },
          memo: input.memo,
          parse: (answer) => {
            let parsed: unknown = null;
            try {
              parsed = JSON.parse(answer);
            } catch {
              // Not JSON: the shape check below says so.
            }
            const checked = validateJudgeOutput(parsed, definition.schema);
            if (!checked.ok) throw new Error(checked.message);
            return checked.data as Record<string, unknown>;
          },
        }),
      (result) => ({ attempts: result.call.attempts.length }),
    );
    const seconds = formatDuration(timer.lastStepMs());
    if (!outcome.ok) {
      input.write(`[eval][${entry.id}] judge: error (${outcome.call.attempts.length} attempt(s), ${seconds})`);
      return { ...errorVerdict(entry.id, "judge", outcome.error), call: outcome.call };
    }
    const reached = reachVerdict(entry, outcome.value);
    const retries = outcome.call.attempts.length - 1;
    input.write(`[eval][${entry.id}] judge: ${reached.status}${retries > 0 ? ` (after ${retries} retry/retries)` : ""} (${seconds})`);
    return { id: entry.id, tier: "judge", ...reached, call: outcome.call, answer: outcome.value };
  } catch (error) {
    if (error instanceof UsageLimitError) throw error;
    return errorVerdict(entry.id, "judge", (error as Error).message);
  }
}

async function evaluateDimension(dimension: Dimension, input: BlueprintJudgeInput): Promise<Verdict[]> {
  const { entry } = dimension;
  const timer = input.timer.dimension(entry.id);
  try {
    if (input.selection !== "none" && !selects(input.selection, entry.id)) {
      return skippedVerdicts(entry, skipReason(input.selection));
    }
    if (dimension.parsed === null) {
      const what = entry.format === "clue_graph" ? "Case" : "Blueprint";
      return [errorVerdict(entry.id, "judge", `${what} failed schema validation; analyzers and judge skipped.`)];
    }
    const verdicts: Verdict[] = [];
    const analysis = await analyze(dimension, input, timer);
    if (analysis) verdicts.push(analysis);
    if (analysis?.status === "error") {
      verdicts.push(errorVerdict(entry.id, "judge", "not run: its analyzer failed"));
    } else if (input.selection === "none") {
      verdicts.push({ id: entry.id, tier: "judge", status: "skipped", reason: skipReason(input.selection) });
    } else {
      verdicts.push(await judge(dimension, input, timer, input.binding as ResolvedBinding));
    }
    return verdicts;
  } finally {
    timer.finalize();
  }
}

/**
 * Runs the mechanical checks and the dimensions, and returns every verdict:
 * the checks in registry order, then each dimension's in registry order.
 */
export async function judgeBlueprint(input: BlueprintJudgeInput): Promise<Verdict[]> {
  const { timer } = input;
  if (input.selection !== "none" && input.binding === null) {
    throw new Error("a judge binding is needed to run the judges");
  }
  input.write("[eval] running mechanical checks");
  const format = input.format ?? blueprintFormat(input.blueprint);
  const mechanical = await timer.stage("mechanical", () => runMechanical(input.brief, input.blueprint, format), (checks) => ({ checks: checks.length }));
  input.write(
    `[eval] mechanical: ${mechanical.filter((v) => v.status === "pass").length}/${mechanical.length} passed (${formatDuration(timer.lastStageMs())})`,
  );

  const schema = await timer.stage("blueprint_schema_validate", async () =>
    format === "clue_graph" ? ClueGraphCaseSchema.safeParse(input.blueprint) : BlueprintV2Schema.safeParse(input.blueprint),
  );
  // A candidate runs only when named, and is otherwise left out of the result.
  const entries = judgesFor("blueprint", { candidates: true, format }).filter(
    (entry) => entry.candidate !== true || (typeof input.selection !== "string" && input.selection.includes(entry.id)),
  );
  const dimensions: Dimension[] = entries.map((entry) => ({
    entry,
    context: entry.context ? structuredClone(entry.context) as Record<string, unknown> : null,
    parsed: schema.success ? schema.data : null,
  }));

  input.write(`[eval] dimensions: ${dimensions.length} started in parallel`);
  const running = input.selection !== "none" && input.binding !== null;
  const digest = running
    ? startDigest("judges", dimensions.map((d) => `judge-${d.entry.id}`), { logDir: input.logDir, quiet: input.quiet, write: input.write })
    : { markDone() {}, stop() {} };
  try {
    const perDimension = await timer.stage(
      "dimensions",
      () =>
        mapPool(dimensions, dimensions.length, (dimension) =>
          evaluateDimension(dimension, input).finally(() => digest.markDone(`judge-${dimension.entry.id}`)),
        ),
      (results) => ({ count: results.length, parallel: true }),
    );
    return [...mechanical, ...perDimension.flat()];
  } finally {
    digest.stop();
  }
}

/** What judging one dimension on its own needs: the blueprint's input, less the selection, the timer and the progress digest. */
export type OneJudgeInput = Pick<BlueprintJudgeInput, "brief" | "blueprint" | "logDir" | "runDir" | "write" | "memo"> & { binding: ResolvedBinding };

/**
 * One judge on a blueprint that passes Blueprint V2, by registry id, whether
 * or not the battery runs it, with no checks and no analyzer: the verdict a
 * caller that picks its own judges needs.
 */
export async function judgeOneDimension(id: string, input: OneJudgeInput): Promise<Verdict> {
  const entry = getJudgeEntry(id);
  const parsed = BlueprintV2Schema.parse(input.blueprint);
  const dimension: Dimension = { entry, context: entry.context ? (structuredClone(entry.context) as Record<string, unknown>) : null, parsed };
  const timer = createRunTimer().dimension(entry.id);
  try {
    return await judge(dimension, { ...input, selection: [id], timer: createRunTimer(), quiet: true }, timer, input.binding);
  } finally {
    timer.finalize();
  }
}
