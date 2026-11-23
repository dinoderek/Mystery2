/**
 * Judging a turn: the registry's checks and judges for a `turn` subject,
 * run over a captured turn.
 *
 * - `flesch` is a check: code, no model.
 * - `age_appropriate_turn` is a judge whose prompt is built from the age profile
 *   the narrator was prompted with, so narrator and judge share one source of
 *   truth per age.
 * - the `gm_*` judges are the game-master adherence judges shared with the game
 *   harness: the same briefs and the same schemas, pointed at one turn. The
 *   case's history is context the judge reads but never reports against, and
 *   the action under test is the one judged turn, so a failure found in play
 *   can be frozen into a case and judged by the same standard.
 *
 * Each model judge is one call through the core's model runner, so a case
 * running all five costs five calls per narrator. They are opt-in per case, or
 * per run with `--judges`.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { buildClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import { isClueGraphFile } from "../../../packages/shared/src/clue-graph-schema.ts";
import type { ResolvedBinding } from "../../core/config.ts";
import { loadCheck, loadJudge } from "../../core/judge-loader.ts";
import { validateJudgeOutput, validateTurnAgeAnswer } from "../../core/judge-output.ts";
import {
  answerJsonSchema,
  composeJudgeSystemPrompt,
  composeTurnAgeSystemPrompt,
  TURN_AGE_ANSWER_SCHEMA,
} from "../../core/judge-prompt.ts";
import { getEntry } from "../../core/registry.ts";
import type { JudgeEntry } from "../../core/registry.ts";
import type { Verdict } from "../../core/result.ts";
import { UsageLimitError } from "../../core/errors.ts";
import { runModel } from "../../core/runner.ts";
import type { CallMemo } from "../../core/runner.ts";
import { composeGameMasterUserMessage } from "../../judges/clue-graph-guidance.ts";
import { resolveVerdict } from "../../judges/index.ts";
import { projectInteractionSubject } from "../../judges/subject.ts";
import type { BlueprintLike, JudgeOptions } from "./case.ts";
import { parseFencedJson } from "./model-json.ts";
import { CLOSING_SCENE_EVENT_TYPES } from "../../lib/game-events.ts";
import { resolveRoleName } from "./roles.ts";
import type { StoredTurn } from "./turn.ts";

export interface TurnJudging {
  /** The repo root, which a relative blueprint path is against. */
  root: string;
  /** The binding every model judge calls; null when no judge is a model judge. */
  binding: ResolvedBinding | null;
  logDir: string;
  /** The options each judge reads, by id. */
  options?: Record<string, JudgeOptions | undefined>;
  /** Finished judge calls to answer from (`CallMemo` in `core/runner.ts`). */
  memo?: CallMemo;
}

function failed(entry: Pick<JudgeEntry, "id">, reason: string, extra: Partial<Verdict> = {}): Verdict {
  return { id: entry.id, tier: "judge", status: "error", reason, ...extra };
}

async function loadBlueprint(turn: StoredTurn, options: JudgeOptions, root: string): Promise<BlueprintLike> {
  const blueprintPath = options.blueprintPath ?? turn.blueprint_path;
  if (!blueprintPath) {
    throw new Error(
      "no blueprint_path on the turn: these judges grade against the blueprint, so pass " +
        "judgeConfig.blueprintPath or replay the case again",
    );
  }
  const candidate = JSON.parse(await fs.readFile(path.resolve(root, blueprintPath), "utf8"));
  // A clue-graph case file is read as the game reads it: its world view, with the graph in `clue_graph`.
  return (isClueGraphFile(candidate)
    ? buildClueGraphWorld(validateClueGraph(candidate))
    : candidate) as BlueprintLike;
}

/**
 * The judge's user message for one turn. Exported for tests and for anyone
 * wanting to see exactly what a judge is handed.
 */
export function buildJudgeUserMessage(judgeId: string, turn: StoredTurn, blueprint: BlueprintLike): string {
  const actionType = turn.action?.type ?? null;
  // Label the judged turn with the role the model actually ran as, resolved
  // through the harness's own action map. If an action has no local mapping (or
  // its resolver needs a field this capture lacks), fall back to the action
  // type: a slightly coarser label is better than failing the judge.
  let roleName: string | null = actionType === "accuse" ? narratedRole(turn) : null;
  try {
    roleName ??=
      resolveRoleName(actionType as string, turn.given ?? {}, turn.action ?? {}, blueprint, turn.given?.history) ??
      actionType;
  } catch {
    roleName = actionType;
  }
  const subject = projectInteractionSubject(turn, { roleName, isAccusationPhase: isClosingScene(turn, roleName) });
  return composeGameMasterUserMessage(judgeId, null, { blueprint, subject });
}

/**
 * The role an accusation's narration was worded in, as the turn saved it: a
 * clue-graph accusation is reported in one role and worded in another
 * (`graph_accusation_round` or `graph_ending`), and the judge reads the wording.
 * A CLI narrator's raw output names it; a played turn's saved event does.
 */
function narratedRole(turn: StoredTurn): string | null {
  const raw = turn.response?.raw as { role?: unknown; events?: Array<{ payload?: { role?: unknown } }> } | null | undefined;
  const role = Array.isArray(raw?.events) ? raw.events[0]?.payload?.role : raw?.role;
  return typeof role === "string" ? role : null;
}

/**
 * Whether the turn is the closing scene: only that tells the truth. A played
 * turn's raw answer names the event it saved first; a turn replayed on a model
 * CLI holds the role's own output, ended by its resolution or by its role; a
 * turn taken from a stored game names its event as its action.
 */
function isClosingScene(turn: StoredTurn, roleName: string | null): boolean {
  if (roleName === "graph_ending") return true;
  const raw = turn.response?.raw as { events?: Array<{ event_type?: unknown }>; accusation_resolution?: unknown } | null | undefined;
  if (raw?.accusation_resolution === "win" || raw?.accusation_resolution === "lose") return true;
  const eventType = Array.isArray(raw?.events) ? raw.events[0]?.event_type : turn.response?.action;
  return typeof eventType === "string" && CLOSING_SCENE_EVENT_TYPES.has(eventType);
}

function narrationOf(turn: StoredTurn): string {
  return turn.response?.narration_text ?? "";
}

async function runAdherenceJudge(entry: JudgeEntry, turn: StoredTurn, judging: TurnJudging): Promise<Verdict> {
  const options = judging.options?.[entry.id] ?? {};
  if (narrationOf(turn).trim().length === 0) return failed(entry, "response has no narration text to judge");
  if (!judging.binding) throw new Error(`no judge binding for ${entry.id}`);
  const definition = await loadJudge(entry);
  const blueprint = await loadBlueprint(turn, options, judging.root);

  const result = await runModel({
    binding: judging.binding,
    step: `judge-${entry.id}`,
    systemPrompt: composeJudgeSystemPrompt(definition, null),
    userMessage: buildJudgeUserMessage(entry.id, turn, blueprint),
    logDir: judging.logDir,
    memo: judging.memo,
    answerSchema: answerJsonSchema(definition) ?? undefined,
    // Validated inside the retry loop: a judge that replies with prose instead
    // of its JSON object is a real, retriable model failure, not a dead run.
    parse: (answer) => {
      const shape = validateJudgeOutput(parseFencedJson(answer), definition.schema);
      if (!shape.ok) throw new Error(shape.message);
      return shape.data as Record<string, unknown>;
    },
  });
  if (!result.ok) return failed(entry, result.error, { call: result.call });

  const answer = result.value;
  const verdict = resolveVerdict(answer);
  return {
    id: entry.id,
    tier: "judge",
    status: verdict.status,
    findings: Array.isArray(answer.findings) ? answer.findings : [],
    details: {
      // The headline number: major findings. 0 is a clean turn; lower is better.
      score: verdict.major_count,
      major_count: verdict.major_count,
      minor_count: verdict.minor_count,
      model_verdict: verdict.model_verdict,
      // Surfaced rather than resolved silently: a judge that lists a major
      // finding and then says "pass" is contradicting its own evidence, and
      // that is worth seeing when iterating on a brief.
      verdict_disagreement: verdict.verdict_disagreement,
      reasoning: answer.reasoning ?? "",
    },
    call: result.call,
    answer,
  };
}

async function runAgeJudge(entry: JudgeEntry, turn: StoredTurn, judging: TurnJudging): Promise<Verdict> {
  const options = judging.options?.[entry.id] ?? {};
  const targetAge = options.targetAge ?? turn.target_age;
  if (typeof targetAge !== "number" || !Number.isFinite(targetAge)) {
    return failed(entry, "no target_age available on the turn or in its judge options");
  }
  const narration = narrationOf(turn);
  if (narration.trim().length === 0) {
    return failed(entry, "response has no narration text to judge", { details: { target_age: targetAge } });
  }
  if (!judging.binding) throw new Error(`no judge binding for ${entry.id}`);

  const userMessage = JSON.stringify({
    target_age: targetAge,
    action: { type: turn.action?.type ?? null, player_input: turn.action?.player_input ?? null },
    narration,
    narration_parts: (turn.response.narration_parts ?? []).map((part) => ({
      speaker: part?.speaker?.kind ?? null,
      text: part?.text ?? "",
    })),
  });
  const result = await runModel({
    binding: judging.binding,
    step: `judge-${entry.id}`,
    systemPrompt: composeTurnAgeSystemPrompt(targetAge),
    userMessage,
    logDir: judging.logDir,
    memo: judging.memo,
    answerSchema: TURN_AGE_ANSWER_SCHEMA,
    parse: (answer) => validateTurnAgeAnswer(parseFencedJson(answer)),
  });
  if (!result.ok) return failed(entry, result.error, { call: result.call, details: { target_age: targetAge } });

  const answer = result.value;
  return {
    id: entry.id,
    tier: "judge",
    status: answer.verdict as "pass" | "fail",
    findings: answer.findings as unknown[],
    details: {
      score: answer.estimated_reading_age,
      target_age: targetAge,
      estimated_reading_age: answer.estimated_reading_age,
      reasoning: answer.reasoning,
    },
    call: result.call,
    answer,
  };
}

async function judgeOne(id: string, turn: StoredTurn, judging: TurnJudging): Promise<Verdict> {
  const entry = getEntry(id);
  try {
    if (entry.type === "check") {
      const run = (await loadCheck(id)) as (turn: StoredTurn, options: JudgeOptions) => Verdict;
      return run(turn, judging.options?.[id] ?? {});
    }
    return entry.prompt.kind === "built"
      ? await runAgeJudge(entry, turn, judging)
      : await runAdherenceJudge(entry, turn, judging);
  } catch (error) {
    if (error instanceof UsageLimitError) throw error;
    // One judge that throws is an error verdict and leaves the others alone.
    const reason = error instanceof Error ? error.message : String(error);
    return entry.type === "check"
      ? { id, tier: "mechanical", status: "error", reason }
      : failed(entry, reason);
  }
}

/**
 * Runs the named checks and judges over a turn, returning their verdicts in
 * the order named. They are independent (each reads the same frozen turn), so
 * they run concurrently.
 */
export function judgeTurn(ids: readonly string[], turn: StoredTurn, judging: TurnJudging): Promise<Verdict[]> {
  return Promise.all(ids.map((id) => judgeOne(id, turn, judging)));
}
