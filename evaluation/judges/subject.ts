// The shared judge subject.
//
// The game-master judges in this directory grade narration against the
// blueprint. That question is the same whether the narration came from a whole
// played session or from one replayed interaction, so both harnesses project
// their own data into ONE shape and the judge briefs are written against that
// shape alone:
//
//   {
//     subject_kind: "trace" | "interaction",
//     turns: [ { sequence, judged, role_name, location_id, character_id,
//                player_input, search_query, revealed_clue_ids,
//                revealed_off_script, prior_revealed_clue_ids, narration } ],
//     judged_sequences: number[],
//   }
//
// (The blueprint travels alongside the subject in the judge's user message
// rather than inside it, so the same blueprint JSON is not duplicated.)
//
// `judged` is the load-bearing field. In a trace every turn is the game
// master's own output and every turn is judged. In a runtime interaction the
// case authors a FIXED prior history as fixture — the model did not write it —
// so those turns are context the judge must read but must never report findings
// against, and exactly one turn (the action under test) is judged. Without the
// flag a single-interaction judge would blame the model for its fixture.

import {
  ACCUSATION_EVENT_TYPES,
  EVENT_ROLE,
  type GameEventLike,
  offScriptClueIdsForEvent,
  readField,
  revealedClueIdsForEvent,
} from "../lib/game-events.ts";

/** One turn of a judge subject, in the shape the judge briefs are written against. */
export interface JudgeTurn {
  sequence: number;
  judged: boolean;
  role_name: string | null;
  location_id: string | null;
  character_id: string | null;
  player_input: string | null;
  search_query: string | null;
  revealed_clue_ids: string[];
  revealed_off_script: string[];
  narration: string;
  is_accusation_phase: boolean;
  /** Clue ids established by every turn before this one, in reveal order. */
  prior_revealed_clue_ids: string[];
}

type TurnBeforePriors = Omit<JudgeTurn, "prior_revealed_clue_ids">;

export interface JudgeSubject {
  subject_kind: "trace" | "interaction";
  turns: JudgeTurn[];
  judged_sequences: number[];
}

/** A reconstructed game turn, as far as the projection reads it. */
export interface TraceTurnLike {
  sequence: number;
  event_type: string;
  role_name: string | null;
  location_id?: string | null;
  character_id?: string | null;
  player_input?: string | null;
  search_query?: string | null;
  revealed_clue_ids?: string[];
  revealed_off_script?: string[];
  narration: string;
}

/** One replayed interaction, as far as the projection reads it. */
export interface InteractionLike {
  given?: { location_id?: string; talk_character_id?: string; history?: GameEventLike[] };
  action?: {
    location_id?: string;
    character_id?: string;
    player_input?: string;
    player_reasoning?: string;
    search_query?: string;
  };
  response?: { raw?: unknown; narration_text?: string };
}

/** Clue ids established by every turn before `index`, in reveal order. */
function priorRevealedClueIds(turns: readonly TurnBeforePriors[], index: number): string[] {
  const seen: string[] = [];
  for (let i = 0; i < index; i += 1) {
    for (const id of turns[i].revealed_clue_ids ?? []) {
      if (!seen.includes(id)) seen.push(id);
    }
  }
  return seen;
}

function finalizeSubject(subjectKind: JudgeSubject["subject_kind"], turns: TurnBeforePriors[]): JudgeSubject {
  const withPriors = turns.map((turn, index) => ({
    ...turn,
    prior_revealed_clue_ids: priorRevealedClueIds(turns, index),
  }));
  return {
    subject_kind: subjectKind,
    turns: withPriors,
    judged_sequences: withPriors.filter((t) => t.judged).map((t) => t.sequence),
  };
}

/**
 * Trace subject: every reconstructed game-master turn, all judged. Turns with
 * no AI role (the opening "start" block) carry no narration the game master
 * wrote, so they are dropped exactly as the trace pipeline always dropped them.
 */
export function projectTraceSubject(reconstructedTurns: readonly TraceTurnLike[]): JudgeSubject {
  const turns: TurnBeforePriors[] = reconstructedTurns
    .filter((t) => t.role_name !== null)
    .map((t) => ({
      sequence: t.sequence,
      judged: true,
      role_name: t.role_name,
      location_id: t.location_id ?? null,
      character_id: t.character_id ?? null,
      player_input: t.player_input ?? null,
      search_query: t.search_query ?? null,
      revealed_clue_ids: t.revealed_clue_ids ?? [],
      revealed_off_script: t.revealed_off_script ?? [],
      narration: t.narration,
      is_accusation_phase: ACCUSATION_EVENT_TYPES.has(t.event_type),
    }));
  return finalizeSubject("trace", turns);
}

// A runtime response carries the model's clue decisions in two different
// shapes, and the judge needs the same list from either:
//   - cli narrator:     response.raw is the role-output JSON itself
//                       (revealed_clue_ids for talk, revealed_clue_id for search)
//   - server narrator:  response.raw is the endpoint body, which returns the
//                       clue OBJECTS the server accepted as `revealed_clues`
// Note the asymmetry this exposes: the endpoint list is post-validation (the
// handler drops ids the model was not entitled to), the CLI list is the model's
// raw claim. A clue-discipline finding therefore reads as "what the model asked
// for" on cli and "what the server let through" on endpoint.
export function revealedClueIdsFromResponse(response: InteractionLike["response"]): string[] {
  const raw = (response?.raw ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return [];
  if (Array.isArray(raw.revealed_clues)) {
    return raw.revealed_clues
      .map((clue: { id?: unknown } | null) => (typeof clue?.id === "string" ? clue.id : null))
      .filter((id): id is string => Boolean(id));
  }
  if (Array.isArray(raw.revealed_clue_ids)) {
    return raw.revealed_clue_ids.filter((id): id is string => typeof id === "string");
  }
  if (typeof raw.revealed_clue_id === "string") return [raw.revealed_clue_id];
  return [];
}

function offScriptClueIdsFromResponse(response: InteractionLike["response"]): string[] {
  const raw = (response?.raw ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") return [];
  return Array.isArray(raw.revealed_off_script)
    ? raw.revealed_off_script.filter((id): id is string => typeof id === "string")
    : [];
}

// The case's `given.history` rows use the persisted game_events shape, so the
// same readers that parse a real trace parse them here.
function historyTurns(history: readonly GameEventLike[] | undefined): TurnBeforePriors[] {
  return (history ?? []).map((event, index) => ({
    sequence: index + 1,
    judged: false,
    role_name: EVENT_ROLE[event.event_type] ?? null,
    location_id: readField(event.payload, "location_id"),
    character_id: readField(event.payload, "character_id"),
    player_input:
      readField(event.payload, "player_reasoning") ??
      readField(event.payload, "player_input"),
    search_query: readField(event.payload, "search_query"),
    revealed_clue_ids: revealedClueIdsForEvent(event),
    revealed_off_script: offScriptClueIdsForEvent(event),
    narration: event.narration ?? "",
    is_accusation_phase: ACCUSATION_EVENT_TYPES.has(event.event_type),
  }));
}

/**
 * Interaction subject: the case's fixed history as unjudged context, then the
 * ONE action under test as the single judged turn.
 *
 * `roleName`/`isAccusationPhase` describe the judged turn; the caller resolves
 * them from the action map (runtime/lib/roles.ts) so this module stays independent of
 * the runtime harness's action registry.
 */
export function projectInteractionSubject(
  interaction: InteractionLike,
  { roleName = null, isAccusationPhase = false }: { roleName?: string | null; isAccusationPhase?: boolean } = {},
): JudgeSubject {
  const given = interaction.given ?? {};
  const context = historyTurns(given.history);
  const action = interaction.action ?? {};
  const response = interaction.response ?? {};

  const judgedTurn: TurnBeforePriors = {
    sequence: context.length + 1,
    judged: true,
    role_name: roleName,
    location_id: action.location_id ?? given.location_id ?? null,
    character_id: action.character_id ?? given.talk_character_id ?? null,
    player_input: action.player_input ?? action.player_reasoning ?? null,
    search_query: action.search_query ?? null,
    revealed_clue_ids: revealedClueIdsFromResponse(response),
    revealed_off_script: offScriptClueIdsFromResponse(response),
    narration: response.narration_text ?? "",
    is_accusation_phase: isAccusationPhase,
  };

  return finalizeSubject("interaction", [...context, judgedTurn]);
}
