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

import { ACCUSE_BACK, ACCUSE_FAILED } from "../../../packages/game-engine/src/accusations.ts";
import {
  EVENT_ROLE,
  LEGACY_ACCUSE_ROUND,
  playedEvents,
  notebookLinesForEvent,
  readField,
  readingAgeOf,
  revealedClueIdsForEvent,
} from "../../lib/game-events.ts";
import type {
  AIContext,
  BlueprintContext,
  ConversationFragment,
  SessionSnapshot,
} from "../../../packages/game-engine/src/ai-context.ts";
import {
  buildAccusationStartContext,
  buildGraphSearchAIContext,
  buildGraphTalkAIContext,
  buildGraphVerdictAIContext,
  buildMoveContext,
  buildTalkEndContext,
  selectLocationConversationHistory,
} from "../../../packages/game-engine/src/ai-context.ts";
import type { AccusationVerdict, SavedAccusation } from "../../../packages/game-engine/src/clue-graph/accusation.ts";
import { assertClueGraphBlueprint, type Payload, type RawEvent, type RawTrace } from "./normalize.ts";

// Re-exported so this module stays the trace pipeline's entry point for
// per-event reveal reading (mechanical.ts imports it from here).
export { revealedClueIdsForEvent };

function readDiagnosticsTimeAfter(payload: Payload | null): number | null {
  if (!payload || typeof payload !== "object") return null;
  const diag = payload.diagnostics;
  if (!diag || typeof diag !== "object") return null;
  const after = (diag as Payload).time_after;
  return typeof after === "number" && Number.isFinite(after) ? after : null;
}

// Maps a raw event to the ConversationFragment shape the builders expect.
function toFragment(event: RawEvent): ConversationFragment {
  return {
    sequence: event.sequence,
    event_type: event.event_type,
    actor: event.actor,
    narration: event.narration,
    payload: event.payload ?? null,
  };
}

interface ReconstructInput {
  gameId: string;
  blueprint: BlueprintContext;
  /** The age this turn was narrated at, as its event records it. */
  readingAge: number;
  session: SessionSnapshot;
  locationId: string;
  characterId: string;
  playerInput: string | null;
  searchQuery: string | null;
  history: ConversationFragment[];
  forcedByTimeout: boolean;
  /** A clue-graph accusation's saved decision. */
  verdict: AccusationVerdict | null;
  cited: string[];
}

function reconstructContext(roleName: string, ctx: ReconstructInput): AIContext | null {
  const { blueprint, session, locationId, characterId, playerInput, history } =
    ctx;
  const common = { game_id: ctx.gameId, session, blueprint, reading_age: ctx.readingAge, conversation_history: history };
  // The runtime always builds accusation contexts with the session forced into
  // "accuse" mode (forced-endgame.ts, and the accuse action's immediate-judge-on-entry
  // path where the prior mode is still "explore"). Mirror that so context.mode
  // matches what the builder saw, regardless of the folded pre-state.
  const accuseCommon = { ...common, session: { ...session, mode: "accuse" as const } };

  // A clue-graph case's talk and search turns are built from the graph and the
  // events (`docs/clue-graph.md`); every other role reads the world view as usual.
  switch (roleName) {
    case "talk_start":
    case "talk_conversation":
      return buildGraphTalkAIContext({
        ...common,
        character_id: characterId,
        location_id: locationId,
        player_input: roleName === "talk_start" ? null : (playerInput ?? ""),
      });
    case "search":
      return buildGraphSearchAIContext({ ...common, location_id: locationId, search_query: ctx.searchQuery ?? null });
    case "talk_end":
      return buildTalkEndContext({
        ...common,
        character_id: characterId,
        location_id: locationId,
      });
    case "move":
      return buildMoveContext({
        ...common,
        destination_id: locationId,
        // Match the runtime: "visited before" iff there is prior location
        // history for the destination (the move action uses
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
    // An accusation is worded from the engine's saved decision. One saved before the
    // engine decided was judged on the full blueprint, which is not rebuilt.
    case "accusation_judge":
      if (!ctx.verdict) return null;
      return buildGraphVerdictAIContext({ ...accuseCommon, player_input: playerInput ?? "", verdict: ctx.verdict, cited: ctx.cited });
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
export interface TurnRecord {
  sequence: number;
  event_type: string;
  actor: string;
  role_name: string | null;
  player_input: string | null;
  search_query: string | null;
  narration: string;
  revealed_clue_ids: string[];
  // A clue-graph turn's saved notebook lines, by clue id; absent elsewhere.
  notebook?: Record<string, string>;
  location_id: string | null;
  character_id: string | null;
  /** The age the turn was narrated at, from its event; null for a turn with no game-master role. */
  reading_age: number | null;
  pre_state: SessionState;
  reconstructed_context: AIContext | null;
  context_error: string | null;
}

function notebookOf(event: RawEvent): { notebook?: Record<string, string> } {
  const lines = notebookLinesForEvent(event);
  return lines ? { notebook: lines } : {};
}

/** The roles a clue-graph turn saves under its own name. */
const GRAPH_ROLES = new Set(["graph_talk", "graph_accusation_round", "graph_ending"]);

export interface ReconstructionIssue {
  sequence: number;
  stage: "reconstruct";
  message: string;
}

/** The session as folded from the events, which may name no location yet. */
export interface SessionState {
  mode: SessionSnapshot["mode"];
  current_location_id: string | null;
  current_talk_character_id: string | null;
  time_remaining: number | null;
}

export interface Reconstruction {
  turns: TurnRecord[];
  final_state: SessionState;
  issues: ReconstructionIssue[];
}

export function reconstructTrace(rawTrace: RawTrace): Reconstruction {
  assertClueGraphBlueprint(rawTrace.blueprint, "reconstructTrace");
  const blueprint = rawTrace.blueprint;
  const events = (playedEvents(rawTrace.events) as RawEvent[]).sort((a, b) => a.sequence - b.sequence);

  const state: SessionState = {
    mode: "explore",
    current_location_id: blueprint?.world?.starting_location_id ?? null,
    current_talk_character_id: null,
    time_remaining: blueprint?.metadata?.time_budget ?? null,
  };

  const turns: TurnRecord[] = [];
  const issues: ReconstructionIssue[] = [];

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
    // A game-master turn is judged at the age its own event records; an old
    // trace without one is refused whole, never judged at a guessed age.
    const readingAge = roleName ? readingAgeOf(event) : null;

    if (roleName) {
      try {
        reconstructedContext = reconstructContext(roleName, {
          gameId: rawTrace.session.id,
          blueprint,
          readingAge: readingAge as number,
          // A trace whose blueprint names no starting location folds to null
          // here; the builders then fail and the turn records a context error.
          session: preState as SessionSnapshot,
          locationId: locationId as string,
          characterId: characterId as string,
          playerInput,
          searchQuery,
          history: priorEvents.map(toFragment),
          forcedByTimeout,
          verdict: (payload?.clue_graph_accusation as SavedAccusation | undefined)?.verdict ?? null,
          cited: (payload?.clue_graph_accusation as SavedAccusation | undefined)?.cited ?? [],
        });
      } catch (err) {
        contextError = String((err as Error)?.message ?? err);
        issues.push({ sequence: event.sequence, stage: "reconstruct", message: contextError });
      }
    }

    turns.push({
      sequence: event.sequence,
      event_type: event.event_type,
      actor: event.actor,
      // A clue-graph conversation or accusation turn names its own role.
      role_name: roleName && typeof payload?.role === "string" && GRAPH_ROLES.has(payload.role) ? payload.role : roleName,
      player_input: playerInput,
      search_query: searchQuery,
      narration: event.narration,
      revealed_clue_ids: revealedClueIdsForEvent(event),
      ...notebookOf(event),
      location_id: locationId,
      character_id: roleName && roleName.startsWith("talk") ? characterId : null,
      reading_age: readingAge,
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
      case LEGACY_ACCUSE_ROUND:
        state.mode = "accuse";
        break;
      case ACCUSE_FAILED:
        // A failed accusation returns to exploring, unless the turns are spent.
        state.mode = state.time_remaining === 0 ? "accuse" : "explore";
        break;
      case ACCUSE_BACK:
        state.mode = "explore";
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
