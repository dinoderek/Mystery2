// One game, played through the game API the way the browser plays it.
//
// It opens as the browser does: game-start narrates the premise, then
// game-enter (the player's "press any key") narrates the arrival. Each step
// after that: show the investigator the player's view, take the line it types,
// run it through the UI's parser, and either call the matching endpoint or
// show the parser's hint (no turn spent), as the web store does. The game's
// state is re-read after every call, so the next view is what the server says,
// not what the runner assumes. What the store does not show a player (a
// response's `follow_up_prompt`) stays out of the view, in steps.jsonl only.
//
// Each input is kept with a checkpoint of the game just before it, and the
// game's end with one more, so a replay of the script can tell when the game
// has diverged (./replay.mjs).

import { resolveInput } from "./commands.mjs";
import { checkpointOf } from "./replay.mjs";
import { buildView } from "./view.mjs";

export const DEFAULT_MAX_STEPS = 60;
// Consecutive failed calls before the game is abandoned rather than looping.
const MAX_CONSECUTIVE_ERRORS = 3;

function narrationEntries(parts) {
  return (parts ?? []).map((part) => ({
    kind: "narration",
    speaker: part.speaker?.label ?? "Narrator",
    text: part.text,
  }));
}

function errorText(response) {
  return response.body?.error ?? `status ${response.status}`;
}

/** What the store adds to the transcript for a successful response. */
function responseEntries(body) {
  const parts = narrationEntries(body.narration_parts);
  return parts.length > 0 ? parts : [{ kind: "narration", speaker: "Narrator", text: "Action completed." }];
}

/**
 * Plays until the case ends, the investigator stops, or `maxSteps` runs out.
 *
 * `api` is a signed-in client (./api.mjs); `investigator` answers `next(view)`
 * (./investigator.mjs); `onStep` sees each step as it happens.
 */
export async function playGame({
  api,
  blueprint,
  investigator,
  maxSteps = DEFAULT_MAX_STEPS,
  onStep = () => {},
}) {
  const started = await api.post("game-start", { blueprint_id: blueprint.id });
  if (!started.ok) throw new Error(`game-start failed: ${errorText(started)}`);

  const gameId = started.body.game_id;
  const transcript = (started.body.narration_events ?? []).flatMap((event) =>
    narrationEntries(event.narration_parts)
  );
  const script = [];
  const checkpoints = [];
  const steps = [];
  let state = started.body.state;
  let result = null;
  let stopReason = null;
  let error = null;
  let divergence = null;
  let consecutiveErrors = 0;

  const refreshState = async () => {
    const current = await api.get("game-get", { game_id: gameId });
    if (!current.ok) {
      error = `game-get: ${errorText(current)}`;
      return false;
    }
    state = current.body.state;
    return true;
  };

  const entered = await api.post("game-enter", { game_id: gameId });
  if (entered.ok) {
    transcript.push(...responseEntries(entered.body));
  } else {
    transcript.push({ kind: "error", text: `Request failed: ${errorText(entered)}` });
  }
  if (!(await refreshState())) stopReason = "errors";

  for (let number = 1; number <= maxSteps && stopReason === null; number += 1) {
    if (state.mode === "ended") {
      // A replay whose game ended before its script did has diverged.
      divergence = investigator.finish?.(checkpointOf(state)) ?? null;
      stopReason = divergence ? "diverged" : "ended";
      break;
    }

    const view = buildView({ title: blueprint.title, state, transcript });
    const checkpoint = checkpointOf(state);
    let decision;
    try {
      decision = await investigator.next(view, { checkpoint });
    } catch (failure) {
      // Ends this game, not the run: what was played so far is still written.
      error = `investigator: ${failure instanceof Error ? failure.message : String(failure)}`;
      stopReason = "investigator-error";
      break;
    }
    if (decision === null) {
      stopReason = "no-more-input";
      break;
    }
    if (decision.divergence) {
      divergence = decision.divergence;
      stopReason = "diverged";
      break;
    }

    script.push(decision.input);
    checkpoints.push(checkpoint);
    const action = resolveInput(decision.input, state, gameId);
    // The store echoes what was typed, except the lines that only open a
    // screen (notebook, themes).
    if (action.kind !== "feedback" || action.echo) {
      transcript.push({ kind: "input", text: decision.input, plan: decision.plan });
    }
    const step = {
      step: number,
      mode_before: state.mode,
      time_before: state.time_remaining,
      input: decision.input,
      plan: decision.plan,
      checkpoint,
      investigator: {
        model: decision.model,
        cost_usd: decision.cost_usd,
        attempts: decision.attempts,
      },
      action: action.kind === "call"
        ? { kind: "call", endpoint: action.endpoint, body: action.body }
        : action.kind === "feedback"
        ? { kind: "feedback", text: action.text, parse: action.parsed.type }
        : { kind: "quit" },
      response: null,
      view,
    };

    if (action.kind === "quit") {
      stopReason = "quit";
      steps.push(step);
      onStep(step);
      break;
    }

    if (action.kind === "feedback") {
      transcript.push({ kind: "feedback", text: action.text });
    } else {
      const response = await api.post(action.endpoint, action.body);
      step.response = { ok: response.ok, status: response.status, body: response.body };

      if (response.ok) {
        consecutiveErrors = 0;
        transcript.push(...responseEntries(response.body));
        if (response.body.result) result = response.body.result;
      } else {
        consecutiveErrors += 1;
        transcript.push({ kind: "error", text: `Request failed: ${errorText(response)}` });
      }

      if (!(await refreshState())) stopReason = "errors";
    }

    step.mode_after = state.mode;
    step.time_after = state.time_remaining;
    steps.push(step);
    onStep(step);

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stopReason = "errors";
      error = `${MAX_CONSECUTIVE_ERRORS} calls in a row failed`;
    }
  }

  if (stopReason === null) stopReason = state.mode === "ended" ? "ended" : "step-cap";

  return {
    gameId,
    result,
    stopReason,
    error,
    divergence,
    transcript,
    script,
    checkpoints,
    endCheckpoint: checkpointOf(state),
    steps,
    finalState: state,
  };
}
