// Run-time reconstruction of what the game master saw, turn by turn.
//
// The raw trace stores the game master's INPUTS and OUTPUTS at the action level
// (player input, role, revealed clue ids, narration) but NOT the assembled
// context the model actually saw — the runtime builds that fresh each turn from
// (session, blueprint, history) and throws it away. We rebuild it here, at run
// time, by replaying the event log and calling the SAME context builders the
// the server uses (packages/game-engine/src/ai-context.ts). Importing the
// real builders — rather than reimplementing them — is what keeps this faithful
// to current game-master behavior. Node strips the builders' types on import.
//
// This module is pure and synchronous: given a raw trace, it returns the
// folded session states plus a normalized per-turn record list. The mechanical
// checks and the judges consume these records; the reconstructed AIContext is
// attached best-effort (guarded per turn) and is the foundation for turning a
// flagged turn into a replayable fixture later.

import {
  EVENT_ROLE,
  offScriptClueIdsForEvent,
  readField,
  revealedClueIdsForEvent,
} from "../../lib/game-events.mjs";
import {
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildMoveContext,
  buildSearchContext,
  buildTalkConversationContext,
  buildTalkEndContext,
  buildTalkStartContext,
  findLocationById,
  selectLocationConversationHistory,
} from "../../../packages/game-engine/src/ai-context.ts";

// Re-exported so this module stays the trace pipeline's entry point for
// per-event reveal reading (mechanical.mjs imports it from here).
export { revealedClueIdsForEvent };

function readDiagnosticsTimeAfter(payload) {
  if (!payload || typeof payload !== "object") return null;
  const diag = payload.diagnostics;
  if (!diag || typeof diag !== "object") return null;
  const after = diag.time_after;
  return typeof after === "number" && Number.isFinite(after) ? after : null;
}

// Maps a raw event to the ConversationFragment shape the builders expect.
function toFragment(event) {
  return {
    sequence: event.sequence,
    event_type: event.event_type,
    actor: event.actor,
    narration: event.narration,
    payload: event.payload ?? null,
  };
}

// Location-level revealed clue ids for a location, derived from the events that
// preceded this turn. Mirrors the edge runtime: a clue counts as revealed for a
// location when a prior search/ask event in that location revealed it and it is
// one of the location's (or its sub-locations') clue ids.
function revealedLocationClueIds(blueprint, locationId, priorEvents) {
  const location = findLocationById(blueprint, locationId);
  if (!location) return [];
  const valid = new Set();
  for (const clue of location.clues ?? []) valid.add(clue.id);
  for (const sub of location.sub_locations ?? []) {
    for (const clue of sub.clues ?? []) valid.add(clue.id);
  }
  const revealed = [];
  for (const event of priorEvents) {
    if (event.event_type !== "search") continue;
    const scope = readField(event.payload, "location_id") ?? locationId;
    if (scope !== locationId) continue;
    for (const id of revealedClueIdsForEvent(event)) {
      if (valid.has(id) && !revealed.includes(id)) revealed.push(id);
    }
  }
  return revealed;
}

function reconstructContext(roleName, ctx) {
  const { blueprint, session, locationId, characterId, playerInput, history } =
    ctx;
  const common = { game_id: ctx.gameId, session, blueprint, conversation_history: history };
  // The runtime always builds accusation contexts with the session forced into
  // "accuse" mode (forced-endgame.ts, and game-accuse's immediate-judge-on-entry
  // path where the prior mode is still "explore"). Mirror that so context.mode
  // matches what the builder saw, regardless of the folded pre-state.
  const accuseCommon = { ...common, session: { ...session, mode: "accuse" } };

  switch (roleName) {
    case "talk_start":
      return buildTalkStartContext({
        ...common,
        character_id: characterId,
        location_id: locationId,
      });
    case "talk_conversation":
      return buildTalkConversationContext({
        ...common,
        character_id: characterId,
        location_id: locationId,
        player_input: playerInput ?? "",
      });
    case "talk_end":
      return buildTalkEndContext({
        ...common,
        character_id: characterId,
        location_id: locationId,
      });
    case "search": {
      const revealed = revealedLocationClueIds(
        blueprint,
        locationId,
        ctx.priorEvents,
      );
      const location = findLocationById(blueprint, locationId);
      const locationLevel = (location?.clues ?? []).filter((c) =>
        revealed.includes(c.id),
      );
      const nextClue = ctx.searchQuery
        ? null
        : (location?.clues ?? [])[locationLevel.length] ?? null;
      return buildSearchContext({
        ...common,
        location_id: locationId,
        revealed_clue_ids: revealed,
        next_clue: nextClue,
        search_query: ctx.searchQuery ?? null,
      });
    }
    case "move":
      return buildMoveContext({
        ...common,
        destination_id: locationId,
        // Match the runtime: "visited before" iff there is prior location
        // history for the destination (game-move uses
        // selectLocationConversationHistory(...).length > 0), not merely
        // whether we ever stood there.
        has_visited_before:
          selectLocationConversationHistory(history, locationId).length > 0,
      });
    case "accusation_start":
      return buildAccusationStartContext({
        ...accuseCommon,
        forced_by_timeout: ctx.forcedByTimeout ?? false,
        player_input: playerInput ?? null,
      });
    case "accusation_judge":
      return buildAccusationJudgeContext({
        ...accuseCommon,
        player_input: playerInput ?? "",
        round: ctx.round ?? 1,
      });
    default:
      return null;
  }
}

// reconstructTrace(rawTrace) -> { turns, final_state, issues }
//
// turns: one record per event, in sequence order. Game-master turns carry a
// role_name and (best-effort) a reconstructed AIContext; non-AI events (e.g.
// "start") carry role_name=null. pre_state is the folded session snapshot as it
// was BEFORE the action resolved — i.e. what the builder would have seen.
export function reconstructTrace(rawTrace) {
  const blueprint = rawTrace.blueprint;
  const events = [...rawTrace.events].sort((a, b) => a.sequence - b.sequence);

  const state = {
    mode: "explore",
    current_location_id: blueprint?.world?.starting_location_id ?? null,
    current_talk_character_id: null,
    time_remaining: blueprint?.metadata?.time_budget ?? null,
  };

  const turns = [];
  const issues = [];

  events.forEach((event, index) => {
    const priorEvents = events.slice(0, index);
    const roleName = EVENT_ROLE[event.event_type] ?? null;
    const payload = event.payload ?? null;

    const destination =
      readField(payload, "location_id") ?? readField(payload, "destination");
    const eventCharacterId =
      readField(payload, "character_id") ?? readField(payload, "character");
    const searchQuery = readField(payload, "search_query");
    // Accusation events store the player's text in player_reasoning; talk/ask
    // use player_input. No event carries both, so prefer reasoning then input.
    const playerInput =
      readField(payload, "player_reasoning") ?? readField(payload, "player_input");
    const forcedByTimeout = event.event_type === "forced_endgame";
    // Match the runtime: the judge round is the number of accuse_round events
    // that already happened (0 on the first round); the resolving event is not
    // counted (game-accuse/index.ts).
    const accusationRound = priorEvents.filter(
      (e) => e.event_type === "accuse_round",
    ).length;

    // Resolve the scope (location/character) for this turn from the pre-state,
    // falling back to payload hints.
    let locationId = state.current_location_id;
    let characterId = state.current_talk_character_id;
    if (event.event_type === "move") locationId = destination ?? locationId;
    if (event.event_type === "talk") characterId = eventCharacterId ?? characterId;
    if (event.event_type === "ask") characterId = characterId ?? eventCharacterId;

    const preState = { ...state };
    let reconstructedContext = null;
    let contextError = null;

    if (roleName) {
      try {
        reconstructedContext = reconstructContext(roleName, {
          gameId: rawTrace.session.id,
          blueprint,
          session: preState,
          locationId,
          characterId,
          playerInput,
          searchQuery,
          history: priorEvents.map(toFragment),
          priorEvents,
          forcedByTimeout,
          round: accusationRound,
        });
      } catch (err) {
        contextError = String(err?.message ?? err);
        issues.push({ sequence: event.sequence, stage: "reconstruct", message: contextError });
      }
    }

    turns.push({
      sequence: event.sequence,
      event_type: event.event_type,
      actor: event.actor,
      role_name: roleName,
      player_input: playerInput,
      search_query: searchQuery,
      narration: event.narration,
      revealed_clue_ids: revealedClueIdsForEvent(event),
      // Reveals the game master granted outside the discovery graph. The
      // clue-discipline judge needs them to tell a declared brilliance bypass
      // apart from an unearned reveal.
      revealed_off_script: offScriptClueIdsForEvent(event),
      location_id: locationId,
      character_id: roleName && roleName.startsWith("talk") ? characterId : null,
      pre_state: preState,
      reconstructed_context: reconstructedContext,
      context_error: contextError,
    });

    // Fold the event's effect into the running state (post-state).
    const timeAfter = readDiagnosticsTimeAfter(payload);
    if (timeAfter !== null) state.time_remaining = timeAfter;

    switch (event.event_type) {
      case "move":
        if (destination) state.current_location_id = destination;
        state.mode = "explore";
        break;
      case "talk":
        if (characterId) state.current_talk_character_id = characterId;
        state.mode = "talk";
        break;
      case "end_talk":
        state.current_talk_character_id = null;
        state.mode = "explore";
        break;
      case "accuse_start":
      case "forced_endgame":
      case "accuse_round":
        state.mode = "accuse";
        break;
      case "accuse_resolved":
        state.mode = "ended";
        break;
      default:
        break;
    }
  });

  return { turns, final_state: state, issues };
}
