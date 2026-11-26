// One typed line, played. The steps, each written once:
//
// 1. Load the history, the session (scoped to the profile), the blueprint and
//    the profile's reading age.
// 2. Parse the line against the session's mode, place and the people present.
// 3. Answer a line that is not an action at once: a refusal, a view, or quit.
//    A refusal and `help` are saved, as lines that cost no turn.
// 4. Check the action is allowed in this mode.
// 5. Resolve it: load the narrator and call the model.
// 6. Work out the effect: the session change, the events, the turn spent and
//    the accusation forced when the last turn runs out.
// 7. Save once.
// 8. Answer from what was saved.

import type { PlayableCase } from "../../../shared/src/playable-case.ts";
import { markClues, notebookMarks } from "../clue-graph/notebook-view.ts";
import { sessionCase } from "../session-case.ts";
import { requestReadingAge } from "../reading-age.ts";
import type { GameTurnResponse, TurnPlayedResponse } from "../../../shared/src/mystery-api-contracts.ts";
import { AIConfigError } from "../ai-config.ts";
import { createAIProviderFromProfile, type AIProvider } from "../ai-provider.ts";
import { HELP_NOTE, interpretLine, type GrammarState, type Interpretation } from "../command-grammar.ts";
import type { EngineAIProfile, EngineContext, GameSessionRow } from "../context.ts";
import { RequestRejectedError, SaveConflictError } from "../errors.ts";
import { logTimeoutTransition } from "../forced-endgame.ts";
import type { LogWriter } from "../logging.ts";
import { logNarrationEventSaved } from "../narration.ts";
import { spendTurn, turnEffect, type TurnEffect } from "./effect.ts";
import { narrateForcedEndgame } from "./narrator.ts";
import { nextSequenceAfter, noTurnEvent, playedEvents } from "./no-turn.ts";
import { planAction } from "./plan.ts";
import { accusationForced } from "../accusations.ts";
import { resolveAccusation, resolveAccuseBack, resolveAccuseStart } from "./resolve-accuse.ts";
import { resolveMove } from "./resolve-move.ts";
import { resolveGraphLine, resolveGraphSearch, resolveGraphTalk } from "./resolve-clue-graph.ts";
import { resolveEndTalk } from "./resolve-talk.ts";
import type { ActionOutcome, PlannedAction, TurnGame, TurnRuntime } from "./types.ts";

export interface TurnRequest {
  game_id: string;
  input: string;
}

export interface TurnOptions {
  req: Request;
  request_id: string;
  logger: LogWriter;
  /** How the narrator is built from the session's AI profile. */
  createProvider?: (profile: EngineAIProfile) => AIProvider;
}

function defaultProvider(profile: EngineAIProfile): AIProvider {
  return createAIProviderFromProfile(profile, { openrouterApiKey: profile.openrouter_api_key });
}

/** What the line means here: the places, and everyone with where they stand. */
export function grammarStateOf(session: GameSessionRow, blueprint: PlayableCase): GrammarState {
  return {
    mode: session.mode,
    accusation_forced: accusationForced(session),
    location: session.current_location_id,
    locations: blueprint.world.locations.map((location) => ({ id: location.id, name: location.name })),
    characters: blueprint.world.characters.map((character) => ({
      id: character.id,
      first_name: character.first_name,
      // A clue-graph character goes by one name.
      last_name: "",
      location_name: character.location_id,
    })),
  };
}

/** The answer to a line that plays nothing, or null for an action. */
export function answerWithoutPlaying(meaning: Interpretation): GameTurnResponse | null {
  switch (meaning.kind) {
    case "refused":
      return { kind: "refused", reason: meaning.reason, hint: meaning.hint };
    case "view":
      return {
        kind: "view",
        view: meaning.view,
        section: meaning.section,
        note: meaning.view === "help" ? HELP_NOTE : null,
      };
    case "quit":
      return { kind: "quit" };
    case "action":
      return null;
  }
}

/**
 * The history is read before the session. The save expects the sequence after
 * the last event read here, so a turn saved after that read, before or after
 * the session is read, makes this one's save conflict rather than land on a
 * stale session. One saved between the two reads conflicts here, before the
 * clue graph, which checks the session against its history, finds them
 * disagreeing. The narrator is shown the events the game master took part
 * in; the sequence counts every saved one.
 */
async function loadGame(ctx: EngineContext, gameId: string, logger: LogWriter): Promise<TurnGame> {
  const history = await ctx.events.listBySession(gameId);
  const session = await ctx.sessions.getById(gameId);
  if (!session) throw new RequestRejectedError(404, "Game session not found", "session_not_found");
  const nextSequence = nextSequenceAfter(history);
  if ((await ctx.events.nextSequence(gameId)) !== nextSequence) throw new SaveConflictError(gameId, nextSequence);
  const blueprint = await sessionCase(ctx.content, session, logger);
  if (!blueprint) throw new RequestRejectedError(500, "Blueprint missing", "blueprint_missing");
  return {
    game_id: gameId,
    session,
    blueprint,
    reading_age: await requestReadingAge(ctx.profile),
    history: playedEvents(history),
    next_sequence: nextSequence,
  };
}

async function loadProvider(ctx: EngineContext, session: GameSessionRow, options: TurnOptions): Promise<AIProvider> {
  let profile: EngineAIProfile | null;
  try {
    profile = await ctx.aiProfiles.getById(session.ai_profile_id);
  } catch (error) {
    // The AI the game resolves to is missing or broken. Nothing narrates in its place.
    if (error instanceof AIConfigError) throw new RequestRejectedError(500, error.message, "ai_unavailable");
    throw error;
  }
  if (!profile) throw new RequestRejectedError(500, "AI profile not found", "ai_profile_missing");
  return (options.createProvider ?? defaultProvider)(profile);
}

function resolveAction(game: TurnGame, runtime: TurnRuntime, action: PlannedAction): Promise<ActionOutcome> {
  // Talk and search play from the case's graph (`resolve-clue-graph.ts`).
  switch (action.kind) {
    case "move":
      return resolveMove(game, runtime, action.destination);
    case "search":
      return resolveGraphSearch(game, runtime, action.query);
    case "talk":
      return resolveGraphTalk(game, runtime, action.character_id);
    case "ask":
      return resolveGraphLine(game, runtime, action);
    case "end_talk":
      return resolveEndTalk(game, runtime, action.character_id);
    case "accuse_start":
      return resolveAccuseStart(game, runtime);
    case "accuse_back":
      return Promise.resolve(resolveAccuseBack());
    case "accusation":
      return resolveAccusation(game, runtime, action.reasoning);
  }
}

function logSaved(runtime: TurnRuntime, game: TurnGame, outcome: ActionOutcome, effect: TurnEffect): void {
  for (const planned of effect.events) {
    logNarrationEventSaved({ ...planned.record, logger: runtime.logger }, planned.sequence);
  }
  const [action, forced] = effect.events;
  if (forced) {
    logTimeoutTransition(runtime.logger, {
      game_id: game.game_id,
      action: outcome.event.action,
      time_before: game.session.time_remaining,
      time_after: effect.state.time_remaining,
      resulting_mode: effect.resulting_mode,
      action_sequence: action.sequence,
      forced_endgame_sequence: forced.sequence,
    });
  }
}

/**
 * Answers a line that plays nothing. A refusal and `help` are saved first, with
 * the session left as it was, so a game opened later shows them.
 */
async function answerAndKeep(
  ctx: EngineContext,
  game: TurnGame,
  input: string,
  answer: GameTurnResponse,
  options: TurnOptions,
): Promise<GameTurnResponse> {
  const event = noTurnEvent(input, answer);
  if (!event) return answer;

  await ctx.sessions.saveTurn({
    game_id: game.game_id,
    expected_sequence: game.next_sequence,
    request_id: options.request_id,
    events: [event],
  });
  logNarrationEventSaved(
    {
      session_id: game.game_id,
      event_type: event.event_type,
      actor: event.actor,
      narration_parts: event.narration_parts,
      logger: options.logger,
    },
    game.next_sequence,
  );
  return answer;
}

function answerFromSave(game: TurnGame, outcome: ActionOutcome, effect: TurnEffect): TurnPlayedResponse {
  // The leads and every clue taken back; the clues the turn found say what they are.
  const graph = game.blueprint.clue_graph;
  const marks = notebookMarks(graph, [...game.history, ...effect.events.map(({ event }) => ({ payload: event.payload }))]);
  return {
    kind: "turn",
    events: effect.events.map(({ sequence, event }) => ({
      sequence,
      event_type: event.event_type,
      payload: event.payload,
      narration_parts: event.narration_parts,
    })),
    state: effect.state,
    revealed_clues: markClues(graph, outcome.revealed_clues, marks),
    leads: marks.leads,
    taken_back: marks.taken_back,
    result: outcome.result,
  };
}

/**
 * Plays one typed line. Throws `RequestRejectedError` for a game it cannot
 * play, `BadRequestError` for an action the mode does not allow,
 * `RetriableAIError` when the narrator fails, and `SaveConflictError` when
 * another turn for the game was saved first. Nothing is written unless it
 * returns a `turn`, a `refused` or a `view` of `help`; the last two leave the
 * session as it was.
 */
export async function playTurn(
  ctx: EngineContext,
  request: TurnRequest,
  options: TurnOptions,
): Promise<GameTurnResponse> {
  const game = await loadGame(ctx, request.game_id, options.logger);
  const { session } = game;

  const input = request.input.trim();
  const meaning = interpretLine(input, grammarStateOf(session, game.blueprint));
  if (meaning.kind !== "action") return answerAndKeep(ctx, game, input, answerWithoutPlaying(meaning)!, options);

  const action = planAction(meaning.action, session);
  const runtime: TurnRuntime = {
    req: options.req,
    request_id: options.request_id,
    game_id: request.game_id,
    provider: await loadProvider(ctx, session, options),
    logger: options.logger,
  };

  const outcome = await resolveAction(game, runtime, action);
  const cost = spendTurn(session.time_remaining, outcome.costs_turn);
  const forced =
    cost.forced_endgame && outcome.endgame
      ? await narrateForcedEndgame(runtime, game, outcome.endgame, cost.time_after)
      : null;

  const expectedSequence = game.next_sequence;
  const effect = turnEffect({
    game_id: request.game_id,
    session,
    history: game.history,
    outcome,
    cost,
    forced,
    input,
    reading_age: game.reading_age,
    expected_sequence: expectedSequence,
    now: new Date().toISOString(),
  });

  await ctx.sessions.saveTurn({
    game_id: request.game_id,
    expected_sequence: expectedSequence,
    request_id: options.request_id,
    patch: effect.patch,
    events: effect.events.map((planned) => planned.event),
  });
  logSaved(runtime, game, outcome, effect);

  return answerFromSave(game, outcome, effect);
}
