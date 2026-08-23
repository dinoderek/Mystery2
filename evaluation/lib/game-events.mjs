// Shared reading of the runtime's persisted game_events rows.
//
// Both evaluation subjects are built from the same event shape
// (event_type/actor/narration/payload): the trace pipeline reads rows straight
// out of Supabase, and a runtime-harness case authors the identical shape as
// its fixed `given.history`. The mapping from an event to (a) the AI role that
// produced it and (b) the clue ids it revealed therefore has to be identical on
// both sides, so it lives here rather than in either harness.
//
// Sibling of evaluation/lib/readability.mjs — the other module shared across
// harnesses.

// Maps a persisted event_type to the AI role whose context builder applies.
// Event types with no game-master AI role (e.g. the opening "start" block) map
// to null and get a turn record without a reconstructed context.
//
// Note: "move" is an internal label for selecting buildMoveContext. The real
// runtime stamps move narration with role_name "search" (buildMoveContext in
// ai-context.ts), but a distinct "move" label reads more clearly in turn
// records and judge projections; it never reaches a builder as a role string.
export const EVENT_ROLE = {
  move: "move",
  search: "search",
  talk: "talk_start",
  ask: "talk_conversation",
  end_talk: "talk_end",
  accuse_start: "accusation_start",
  accuse_round: "accusation_judge",
  accuse_resolved: "accusation_judge",
  forced_endgame: "accusation_start",
};

// The accusation phase is where the truth is legitimately revealed, so
// spoiler-sensitive checks stop at its first event.
export const ACCUSATION_EVENT_TYPES = new Set([
  "accuse_start",
  "accuse_round",
  "accuse_resolved",
  "forced_endgame",
]);

export function readField(payload, key) {
  if (!payload || typeof payload !== "object") return null;
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function readStringArray(payload, key) {
  if (!payload || typeof payload !== "object") return [];
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((v) => typeof v === "string" && v.trim().length > 0);
}

// The clue ids revealed by a single event THIS TURN. The runtime persists
// reveals differently per event type, and conflating them double-counts:
//   - `search` stores this turn's single find in payload.revealed_clue_id;
//     its payload.revealed_clue_ids is the CUMULATIVE list of everything
//     revealed in that location so far (game-search/index.ts), NOT a per-turn
//     delta — using it as a delta makes clue-accounting false-fail.
//   - `ask` stores this turn's reveals as the payload.revealed_clue_ids array
//     (game-ask/index.ts).
// The clues_revealed column is never written by the runtime; we honor it only
// as a fallback for legacy/seeded rows on non-search/ask events.
export function revealedClueIdsForEvent(event) {
  const payload = event.payload ?? null;
  if (event.event_type === "search") {
    const single = readField(payload, "revealed_clue_id");
    return single ? [single] : [];
  }
  if (event.event_type === "ask") {
    return readStringArray(payload, "revealed_clue_ids");
  }
  return (event.clues_revealed ?? []).filter(
    (id) => typeof id === "string" && id.length > 0,
  );
}

// Clue ids the narrator granted outside the discovery graph (a brilliance
// bypass), which the runtime records alongside the reveal itself.
export function offScriptClueIdsForEvent(event) {
  return readStringArray(event.payload ?? null, "revealed_off_script");
}
