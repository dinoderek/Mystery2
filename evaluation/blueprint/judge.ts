/**
 * Judging one clue-graph case: the mechanical check, then every case judge in
 * parallel. A dimension is one judge (one model call through the runner) and
 * a verdict of its own. What the judges are sent and how a verdict is reached
 * are the registry's and the composer's (`evaluation/core/`); this file only
 * sequences them and records what happened.
 *
 * Nothing is skipped quietly. A judge is `skipped` only because a flag asked
 * (`--no-judges`, or `--judges` left it out); a judge that could not run, or
 * whose answer never passed the schema, is `error`. A candidate judge runs
 * only when `--judges` names it, and is absent from the result otherwise.
 *
 * A case (`docs/clue-graph.md`) is judged without a brief: each judge is sent
 * the `case`, and the step judge also the `player_view` (`./player-view.ts`).
 * With the brief a case was generated from, its check also holds the case to
 * that brief.
 */

import { ClueGraphCaseSchema, type ClueGraphCase } from "../../packages/shared/src/clue-graph-schema.ts";
import type { ResolvedBinding } from "../core/config.ts";
import { UsageLimitError } from "../core/errors.ts";
import { validateJudgeOutput } from "../core/judge-output.ts";
import { loadCheck, loadJudge } from "../core/judge-loader.ts";
import { composeJudgeSystemPrompt, composeJudgeUserMessage } from "../core/judge-prompt.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { checksFor, judgesFor } from "../core/registry.ts";
import type { JudgeEntry } from "../core/registry.ts";
import type { Status, Verdict } from "../core/result.ts";
import { runModel } from "../core/runner.ts";
import { majorFindingsVerdict } from "../judges/index.ts";
import type { CallMemo } from "../core/runner.ts";
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

interface MechanicalReport {
  id: string;
  status: Status;
  details: unknown;
}

/** Runs the case's mechanical check, with the brief it was generated from when there is one. */
export async function runMechanical(brief: unknown, blueprint: unknown): Promise<Verdict[]> {
  const entries = checksFor("blueprint");
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
}

interface Dimension {
  entry: JudgeEntry;
  context: Record<string, unknown> | null;
  /** The case after schema validation; null when it failed. */
  parsed: unknown;
}

/** What a judge is sent besides its id and context: the case and, when its entry asks, the player's view. */
function subjectParts(dimension: Dimension, input: BlueprintJudgeInput): Record<string, unknown> {
  return {
    case: input.blueprint,
    ...(dimension.entry.playerView ? { player_view: playerView(dimension.parsed as ClueGraphCase) } : {}),
  };
}

function errorVerdict(id: string, tier: Verdict["tier"], reason: string): Verdict {
  return { id, tier, status: "error", reason };
}

function skippedVerdicts(entry: JudgeEntry, reason: string): Verdict[] {
  return [{ id: entry.id, tier: "judge", status: "skipped", reason }];
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
      return [errorVerdict(entry.id, "judge", "Case failed schema validation; judge skipped.")];
    }
    if (input.selection === "none") return skippedVerdicts(entry, skipReason(input.selection));
    return [await judge(dimension, input, timer, input.binding as ResolvedBinding)];
  } finally {
    timer.finalize();
  }
}

/**
 * Runs the mechanical check and the dimensions, and returns every verdict:
 * the check, then each dimension's in registry order.
 */
export async function judgeBlueprint(input: BlueprintJudgeInput): Promise<Verdict[]> {
  const { timer } = input;
  if (input.selection !== "none" && input.binding === null) {
    throw new Error("a judge binding is needed to run the judges");
  }
  input.write("[eval] running mechanical checks");
  const mechanical = await timer.stage("mechanical", () => runMechanical(input.brief, input.blueprint), (checks) => ({ checks: checks.length }));
  input.write(
    `[eval] mechanical: ${mechanical.filter((v) => v.status === "pass").length}/${mechanical.length} passed (${formatDuration(timer.lastStageMs())})`,
  );

  const schema = await timer.stage("blueprint_schema_validate", async () => ClueGraphCaseSchema.safeParse(input.blueprint));
  // A candidate runs only when named, and is otherwise left out of the result.
  const entries = judgesFor("blueprint", { candidates: true }).filter(
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
