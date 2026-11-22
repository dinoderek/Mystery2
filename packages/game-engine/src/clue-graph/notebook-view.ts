// What a clue-graph game sends the notebook beyond its clues: each clue's saved
// line, the leads, which clues were taken back, and what kind each clue is. All
// of it is derived from the saved events, so a resumed game shows what the live
// game showed. Nothing here says whether a statement was true, or carries a
// rule or a gate's words.

import type { NotebookLead } from "../../../shared/src/mystery-api-contracts.ts";
import type { ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import { clueGraphEvents } from "./history.ts";
import { currentLeads } from "./leads.ts";
import { lineOf, replay } from "./play.ts";

interface HistoryRow {
  payload?: Record<string, unknown> | null;
}

export interface NotebookMarks {
  leads: NotebookLead[];
  /** Every clue the player holds that was taken back; a statement not yet heard is never named. */
  taken_back: string[];
  /** Each held clue's notebook line, as the narrator wrote it when it came out. */
  lines: Record<string, string>;
}

/**
 * The marks after the last row of a history. A lead is new on the turn it
 * appears: against the play before the last row when that row was a clue-graph
 * turn, none when it was not, and all of them before anything has been played.
 */
export function notebookMarks(graph: ClueGraphCase, history: HistoryRow[]): NotebookMarks {
  const events = clueGraphEvents(history);
  const last = history.at(-1);
  const lastWasTurn = last !== undefined && clueGraphEvents([last]).length > 0;
  const play = replay(graph, events);
  const leads = currentLeads(graph, play);
  const known = new Set(
    events.length === 0
      ? []
      : (lastWasTurn ? currentLeads(graph, replay(graph, events.slice(0, -1))) : leads).map((lead) => lead.key),
  );
  return {
    leads: leads.map((lead) => ({ ...lead, new: !known.has(lead.key) })),
    taken_back: play.retracted.filter((id) => play.held.includes(id)),
    lines: Object.fromEntries(play.held.map((id) => [id, lineOf(graph, play, id)])),
  };
}

/**
 * The notebook's records with what the player is shown of each: its saved
 * line, its kind, and whether it was taken back.
 */
export function markClues<T extends { id: string; text: string }>(
  graph: ClueGraphCase,
  records: T[],
  marks: Pick<NotebookMarks, "taken_back" | "lines">,
): Array<T & { kind: "evidence" | "statement" | "tell"; taken_back: boolean }> {
  return records.map((record) => ({
    ...record,
    text: Object.hasOwn(marks.lines, record.id) ? marks.lines[record.id] : record.text,
    kind: graph.clues[record.id].kind,
    taken_back: marks.taken_back.includes(record.id),
  }));
}
