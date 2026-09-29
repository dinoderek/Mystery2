// One game, played through the game API the way the browser plays it.
//
// Each step: show the investigator the player's view, take the line it types,
// run it through the UI's parser, and either call the matching endpoint or
// show the parser's hint (no turn spent), exactly as the web store does. The
// game's state is re-read after every call, so the next view is what the
// server says, not what the runner assumes.

import { resolveInput } from "./commands.mjs";
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
  const message = response.body?.error ?? "unknown error";
  return `${response.status} ${message}`;
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
  const steps = [];
  let state = started.body.state;
  let result = null;
  let stopReason = null;
  let error = null;
  let consecutiveErrors = 0;

  for (let number = 1; number <= maxSteps; number += 1) {
    if (state.mode === "ended") {
      stopReason = "ended";
      break;
    }

    const view = buildView({ title: blueprint.title, state, transcript });
    let decision;
    try {
      decision = await investigator.next(view);
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

    script.push(decision.input);
    transcript.push({ kind: "input", text: decision.input, plan: decision.plan });

    const action = resolveInput(decision.input, state, gameId);
    const step = {
      step: number,
      mode_before: state.mode,
      time_before: state.time_remaining,
      input: decision.input,
      plan: decision.plan,
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
        transcript.push(...narrationEntries(response.body.narration_parts));
        if (response.body.follow_up_prompt) {
          transcript.push({ kind: "feedback", text: response.body.follow_up_prompt });
        }
        if (response.body.result) result = response.body.result;
      } else {
        consecutiveErrors += 1;
        transcript.push({ kind: "error", text: errorText(response) });
      }

      const current = await api.get("game-get", { game_id: gameId });
      if (!current.ok) throw new Error(`game-get failed: ${errorText(current)}`);
      state = current.body.state;
    }

    step.mode_after = state.mode;
    step.time_after = state.time_remaining;
    steps.push(step);
    onStep(step);

    if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      stopReason = "errors";
      break;
    }
  }

  if (stopReason === null) stopReason = state.mode === "ended" ? "ended" : "step-cap";

  return { gameId, result, stopReason, error, transcript, script, steps, finalState: state };
}
