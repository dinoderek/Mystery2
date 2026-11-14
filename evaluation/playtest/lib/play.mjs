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
// has diverged (./replay.mjs).

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

/** What the store adds to the transcript for a successful game-enter response. */
function responseEntries(body) {
  const parts = narrationEntries(body.narration_parts);
  return parts.length > 0 ? parts : [{ kind: "narration", speaker: "Narrator", text: "Action completed." }];
}

/** The narration of a played turn: every saved event, in order. */
function turnEntries(body) {
  const entries = (body.events ?? []).flatMap((event) => narrationEntries(event.narration_parts));
  return entries.length > 0 ? entries : [{ kind: "narration", speaker: "Narrator", text: "Action completed." }];
}

/**
 * What the investigator is told for a line that played nothing, in the words
 * the browser would answer it with, or a screen it opens: the investigator's
 * view already carries the notebook, so a view is said in a line.
 * `echo` is true only for `help`: the browser opens the notebook for `notebook`
 * and the list commands before it echoes anything into the transcript.
 */
function feedbackFor(body) {
  if (body.kind === "refused") return { echo: true, text: body.hint };
  if (body.view === "help") return { echo: true, text: body.note };
  return {
    echo: false,
    text: body.section
      ? `(The notebook opens at ${body.section}: it is the NOTEBOOK sections of your view.)`
      : "(The notebook opens: it is the NOTEBOOK sections of your view.)",
  };
}

/** The step's record of how the engine answered the line. */
function actionOf(response) {
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
      action: null,
      response: null,
      view,
    };

    const response = await api.post("game-turn", { game_id: gameId, input: decision.input });
    step.response = { ok: response.ok, status: response.status, body: response.body };
    step.action = actionOf(response);
    const played = response.ok && response.body.kind === "turn";
    const feedback = response.ok && (response.body.kind === "refused" || response.body.kind === "view")
      ? feedbackFor(response.body)
      : null;

    // The store echoes what was typed, except the lines that open the notebook.
    if (feedback?.echo ?? true) {
      transcript.push({ kind: "input", text: decision.input, plan: decision.plan });
    }

    if (feedback) {
      step.action.text = feedback.text;
      transcript.push({ kind: "feedback", text: feedback.text });
    } else if (step.action.kind === "quit") {
      stopReason = "quit";
    } else if (played) {
      consecutiveErrors = 0;
      transcript.push(...turnEntries(response.body));
      if (response.body.result) result = response.body.result;
    } else {
      consecutiveErrors += 1;
      transcript.push({ kind: "error", text: `Request failed: ${errorText(response)}` });
    }

    // Only a played turn, or a failed call that may have saved, changes the game.
    if (played || !response.ok) {
      if (!(await refreshState())) stopReason = "errors";
    }

    if (stopReason === "quit") {
      steps.push(step);
      onStep(step);
      break;
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
