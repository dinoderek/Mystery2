// Where a clue-graph game's events live: each saved turn that counts carries
// its `ClueGraphEvent` in `payload.clue_graph`, and the play is the fold of
// those, in sequence order (`play.ts`).

import type { ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import { recordedTells } from "./leads.ts";
import { replay, type ClueGraphEvent, type ClueGraphPlay } from "./play.ts";

const EVENT_TYPES = new Set(["move", "search", "talk", "line"]);

interface HistoryRow {
  payload?: Record<string, unknown> | null;
}

/** The clue-graph events a history recorded, in order. */
export function clueGraphEvents(history: HistoryRow[]): ClueGraphEvent[] {
  return history.flatMap((row) => {
    const recorded = row.payload?.clue_graph;
    const type = typeof recorded === "object" && recorded !== null ? (recorded as { type?: unknown }).type : undefined;
    return typeof type === "string" && EVENT_TYPES.has(type) ? [recorded as ClueGraphEvent] : [];
  });
}

/** The play a history has reached. */
export function playOf(graph: ClueGraphCase, history: HistoryRow[]): ClueGraphPlay {
  return replay(graph, clueGraphEvents(history));
}

/** The clues the notebook keeps, in order: every one but a tell no other clue depends on. */
export function notebookClues(graph: ClueGraphCase, ids: string[]): string[] {
  const recorded = recordedTells(graph);
  return ids.filter((id) => graph.clues[id].kind !== "tell" || recorded.has(id));
}

/**
 * What the investigator has said to `character` in the conversation open now,
 * in order: the lines after the latest time they turned to them. A clue used
 * on one of these and dodged still counts (`docs/clue-graph.md`).
 */
export function linesThisConversation(history: HistoryRow[], character: string): string[] {
  const lines: string[] = [];
  for (const row of history) {
    const recorded = row.payload?.clue_graph as { type?: unknown; character?: unknown } | undefined;
    if (recorded?.character !== character) continue;
    if (recorded.type === "talk") lines.length = 0;
    const said = row.payload?.player_input;
    if (recorded.type === "line" && typeof said === "string") lines.push(said);
  }
  return lines;
}
