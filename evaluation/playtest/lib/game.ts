// One game, played through the game API the way the browser plays it.
//
// It opens as the browser does: game-start narrates the premise, then
// game-enter (the player's "press any key") narrates the arrival. Each step
// after that: show the investigator the player's view, take the line it types
// and post it, as typed, to game-turn. The engine decides what the line means
// and answers with one of four kinds: a played turn, a refusal with its hint, a
// view to open, or quit. Only a played turn spends one. The game's state is
// re-read after every played turn, so the next view is what the server says,
// not what the runner assumes.
//
// Each input is kept with a checkpoint of the game just before it, and the
// game's end with one more, so a replay of the script can tell when the game
// has diverged (./replay.ts).

import type {
  GameEnterResponse,
  GameGetResponse,
  GameStartResponse,
  GameState,
  GameTurnResponse,
  NarrationPart,
  TurnPlayedResponse,
  TurnRefusedResponse,
  TurnViewResponse,
} from "../../../packages/shared/src/mystery-api-contracts.ts";
import type { ApiResponse, GameApi } from "./api.ts";
import type { Decision, Divergence, Investigator } from "./investigator.ts";
import { checkpointOf } from "./replay.ts";
import type { Checkpoint } from "./replay.ts";
import { buildView } from "./view.ts";
import type { TranscriptEntry } from "./view.ts";

export const DEFAULT_MAX_STEPS = 60;
// Consecutive failed calls before the game is abandoned rather than looping.
const MAX_CONSECUTIVE_ERRORS = 3;

/** How the engine answered a typed line. */
export type StepAction =
  | { kind: "failed"; status: number }
  | { kind: "turn"; event_type: string | null }
  | { kind: "refused"; reason: string; text: string }
  | { kind: "view"; view: string; section: string | null; text?: string }
  | { kind: "quit" };

/** One typed line: what the investigator saw, what it typed, and what came of it. */
export interface Step {
  step: number;
  mode_before: string;
  time_before: number;
  input: string;
  plan: string;
  checkpoint: Checkpoint;
  investigator: { model: string | null; cost_usd: number | null; attempts: number };
  action: StepAction;
  response: { ok: boolean; status: number; body: unknown };
  view: string;
  mode_after?: string;
  time_after?: number;
}

export interface PlayedGame {
  gameId: string;
  result: "win" | "lose" | null;
  stopReason: string;
  error: string | null;
  divergence: Divergence | null;
  transcript: TranscriptEntry[];
  script: string[];
  checkpoints: Checkpoint[];
  endCheckpoint: Checkpoint;
  steps: Step[];
  finalState: GameState;
}

const ACTION_COMPLETED: TranscriptEntry = { kind: "narration", speaker: "Narrator", text: "Action completed." };

function narrationEntries(parts: readonly NarrationPart[] | undefined): TranscriptEntry[] {
  return (parts ?? []).map((part) => ({
    kind: "narration",
    speaker: part.speaker?.label ?? "Narrator",
    text: part.text,
  }));
}

function errorText(response: { status: number; body: { error?: string } }): string {
  return response.body?.error ?? `status ${response.status}`;
}

/** What the store adds to the transcript for a successful game-enter response. */
function responseEntries(body: GameEnterResponse): TranscriptEntry[] {
  const parts = narrationEntries(body.narration_parts);
  return parts.length > 0 ? parts : [ACTION_COMPLETED];
}

/** The narration of a played turn: every saved event, in order. */
function turnEntries(body: TurnPlayedResponse): TranscriptEntry[] {
  const entries = (body.events ?? []).flatMap((event) => narrationEntries(event.narration_parts));
  return entries.length > 0 ? entries : [ACTION_COMPLETED];
}

/**
 * What the investigator is told for a line that played nothing, in the words
 * the browser would answer it with, or a screen it opens: the investigator's
 * view already carries the notebook, so a view is said in a line.
 * `echo` is true only for `help`: the browser opens the notebook for `notebook`
 * and the list commands before it echoes anything into the transcript.
 */
function feedbackFor(body: TurnRefusedResponse | TurnViewResponse): { echo: boolean; text: string } {
  if (body.kind === "refused") return { echo: true, text: body.hint };
  if (body.view === "help") return { echo: true, text: body.note ?? "" };
  return {
    echo: false,
    text: body.section
      ? `(The notebook opens at ${body.section}: it is the NOTEBOOK sections of your view.)`
      : "(The notebook opens: it is the NOTEBOOK sections of your view.)",
  };
}

/** The step's record of how the engine answered the line. */
function actionOf(response: ApiResponse<GameTurnResponse>): StepAction {
  if (!response.ok) return { kind: "failed", status: response.status };
  const body = response.body;
  switch (body.kind) {
    case "turn":
      return { kind: "turn", event_type: body.events[0]?.event_type ?? null };
    case "refused":
      return { kind: "refused", reason: body.reason, text: body.hint };
    case "view":
      return { kind: "view", view: body.view, section: body.section };
    default:
      return { kind: "quit" };
  }
}

/** Everything one game accumulates while it is played. */
interface Run {
  api: GameApi;
  title: string;
  gameId: string;
  state: GameState;
  transcript: TranscriptEntry[];
  script: string[];
  checkpoints: Checkpoint[];
  steps: Step[];
  result: "win" | "lose" | null;
  stopReason: string | null;
  error: string | null;
  divergence: Divergence | null;
  consecutiveErrors: number;
}

/** Re-reads the game's state; false (and `error` set) when the server will not say. */
async function refreshState(run: Run): Promise<boolean> {
  const current = await run.api.get<GameGetResponse>("game-get", { game_id: run.gameId });
  if (!current.ok) {
    run.error = `game-get: ${errorText(current)}`;
    return false;
  }
  run.state = current.body.state;
  return true;
}

/** Starts the game and enters its first location, as the browser does. */
async function openGame(api: GameApi, blueprint: { id: string; title: string }): Promise<Run> {
  const started = await api.post<GameStartResponse & { game_id: string }>("game-start", { blueprint_id: blueprint.id });
  if (!started.ok) throw new Error(`game-start failed: ${errorText(started)}`);
  const run: Run = {
    api,
    title: blueprint.title,
    gameId: started.body.game_id,
    state: started.body.state,
    transcript: (started.body.narration_events ?? []).flatMap((event) => narrationEntries(event.narration_parts)),
    script: [],
    checkpoints: [],
    steps: [],
    result: null,
    stopReason: null,
    error: null,
    divergence: null,
    consecutiveErrors: 0,
  };
  const entered = await api.post<GameEnterResponse>("game-enter", { game_id: run.gameId });
  if (entered.ok) run.transcript.push(...responseEntries(entered.body));
  else run.transcript.push({ kind: "error", text: `Request failed: ${errorText(entered)}` });
  if (!(await refreshState(run))) run.stopReason = "errors";
  return run;
}

type Choice = { decision: Decision } | { stop: string };

/** Asks the investigator for the next line, or says why the game stops instead. */
async function choose(run: Run, investigator: Investigator, view: string, checkpoint: Checkpoint): Promise<Choice> {
  let decision: Awaited<ReturnType<Investigator["next"]>>;
  try {
    decision = await investigator.next(view, { checkpoint });
  } catch (failure) {
    // Ends this game, not the run: what was played so far is still written.
    run.error = `investigator: ${failure instanceof Error ? failure.message : String(failure)}`;
    return { stop: "investigator-error" };
  }
  if (decision === null) return { stop: "no-more-input" };
  if ("divergence" in decision) {
    run.divergence = decision.divergence;
    return { stop: "diverged" };
  }
  return { decision };
}

/** Posts the line as typed, and records what the game answered in the transcript. */
async function playLine(run: Run, step: Step): Promise<void> {
  const response = await run.api.post<GameTurnResponse>("game-turn", { game_id: run.gameId, input: step.input });
  step.response = { ok: response.ok, status: response.status, body: response.body };
  step.action = actionOf(response);
  const body = response.ok ? response.body : null;
  const played = body?.kind === "turn";
  const feedback = body && (body.kind === "refused" || body.kind === "view") ? feedbackFor(body) : null;

  // The store echoes what was typed, except the lines that open the notebook.
  if (feedback?.echo ?? true) run.transcript.push({ kind: "input", text: step.input, plan: step.plan });

  if (feedback) {
    (step.action as { text?: string }).text = feedback.text;
    run.transcript.push({ kind: "feedback", text: feedback.text });
  } else if (step.action.kind === "quit") {
    run.stopReason = "quit";
  } else if (played) {
    run.consecutiveErrors = 0;
    run.transcript.push(...turnEntries(body));
    if (body.result) run.result = body.result;
  } else {
    run.consecutiveErrors += 1;
    run.transcript.push({ kind: "error", text: `Request failed: ${errorText(response as { status: number; body: { error?: string } })}` });
  }

  // Only a played turn, or a failed call that may have saved, changes the game.
  if ((played || !response.ok) && !(await refreshState(run))) run.stopReason = "errors";
}

/**
 * Plays until the case ends, the investigator stops, or `maxSteps` runs out.
 *
 * `api` is a signed-in client (./api.ts); `investigator` answers `next(view)`
 * (./investigator.ts); `onStep` sees each step as it happens.
 */
export async function playGame({
  api,
  blueprint,
  investigator,
  maxSteps = DEFAULT_MAX_STEPS,
  onStep = () => {},
}: {
  api: GameApi;
  blueprint: { id: string; title: string };
  investigator: Investigator;
  maxSteps?: number;
  onStep?: (step: Step) => void;
}): Promise<PlayedGame> {
  const run = await openGame(api, blueprint);

  for (let number = 1; number <= maxSteps && run.stopReason === null; number += 1) {
    if (run.state.mode === "ended") {
      // A replay whose game ended before its script did has diverged.
      run.divergence = investigator.finish?.(checkpointOf(run.state)) ?? null;
      run.stopReason = run.divergence ? "diverged" : "ended";
      break;
    }

    const view = buildView({ title: run.title, state: run.state, transcript: run.transcript });
    const checkpoint = checkpointOf(run.state);
    const choice = await choose(run, investigator, view, checkpoint);
    if ("stop" in choice) {
      run.stopReason = choice.stop;
      break;
    }

    const { decision } = choice;
    run.script.push(decision.input);
    run.checkpoints.push(checkpoint);
    const step: Step = {
      step: number,
      mode_before: run.state.mode,
      time_before: run.state.time_remaining,
      input: decision.input,
      plan: decision.plan,
      checkpoint,
      investigator: { model: decision.model, cost_usd: decision.cost_usd, attempts: decision.attempts },
      action: { kind: "quit" },
      response: { ok: false, status: 0, body: null },
      view,
    };
    await playLine(run, step);

    if (run.stopReason !== "quit") {
      step.mode_after = run.state.mode;
      step.time_after = run.state.time_remaining;
    }
    run.steps.push(step);
    onStep(step);
    if (run.stopReason === "quit") break;

    if (run.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      run.stopReason = "errors";
      run.error = `${MAX_CONSECUTIVE_ERRORS} calls in a row failed`;
    }
  }

  return {
    gameId: run.gameId,
    result: run.result,
    stopReason: run.stopReason ?? (run.state.mode === "ended" ? "ended" : "step-cap"),
    error: run.error,
    divergence: run.divergence,
    transcript: run.transcript,
    script: run.script,
    checkpoints: run.checkpoints,
    endCheckpoint: checkpointOf(run.state),
    steps: run.steps,
    finalState: run.state,
  };
}
