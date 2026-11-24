import type { BlueprintContext } from "../../../packages/game-engine/src/ai-context.ts";
import fs from "node:fs";
import { buildClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import type { RawTrace } from "../../../evaluation/trace/lib/normalize.ts";
import { played, type Step } from "../../../evaluation/runtime/cases/clue-graph/support/play.ts";
import { readMockCase, readMockCaseGraph } from "../../testkit/src/mock-case.ts";

// Shared fixtures for the trace-evaluation pipeline unit tests: the clue-graph
// mock case, and a small game played on it as the engine saves one. Not a
// .test.ts file, so vitest imports it without running it as a suite.

/** The mock case's world view, as a trace carries it. */
export function makeBlueprint(): BlueprintContext {
  return readMockCase() as unknown as BlueprintContext;
}

export type TraceEventRow = {
  id: string;
  sequence: number;
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  narration: string;
  narration_parts: unknown[];
  clues_revealed: string[];
  model?: string | null;
  created_at: string;
};

const row = (
  sequence: number,
  event_type: string,
  actor: string,
  payload: Record<string, unknown>,
  narration: string,
  model: string | null = "mock",
): TraceEventRow => ({
  id: `e${sequence}`,
  sequence,
  event_type,
  actor,
  payload,
  narration,
  narration_parts: [],
  clues_revealed: [],
  model,
  created_at: `2026-06-01T10:0${sequence}:00Z`,
});

/** The saved rows of a short play, as the engine folds and stores them, from sequence 2 on. */
export function playedRows(steps: Step[], narrate: Record<number, string> = {}): TraceEventRow[] {
  return played(readMockCaseGraph(), steps).history.map((entry, index) =>
    row(
      entry.sequence ?? index + 2,
      entry.event_type,
      entry.event_type === "ask" ? "char-alice" : "system",
      { ...entry.payload, diagnostics: { time_after: 9 - index } },
      narrate[index] ?? entry.narration ?? "",
    ),
  );
}

const ALICE_HELLO = "Alice looks up from the counter, flour on her nose. \"I saw Bob sneak in at noon,\" she says.";

// A clean, rule-abiding game on the mock case: search, talk, ask, move,
// search, accuse. Returns game_events-shaped rows (unsorted on purpose).
export function makeEvents(): TraceEventRow[] {
  const [search, talk, ask, move, hidden] = playedRows(
    [
      { search: null, narration: "You spot a trail of cookie crumbs on the floor." },
      { talk: "char-alice", narration: ALICE_HELLO },
      { say: "Where were you at noon?", reply: "\"In the pantry,\" Alice says quickly.", asked: ["alice_noon"] },
      { move: "loc-living-room" },
      { search: "behind the bookshelf", narration: "Behind the bookshelf you find a dusty toy mouse." },
    ],
  );
  return [
    row(1, "start", "narrator", { location_id: "loc-kitchen" }, "You arrive in the warm kitchen as the cookies go missing.", null),
    search,
    talk,
    ask,
    row(5, "end_talk", "system", { character_id: "char-alice" }, "You thank Alice."),
    { ...move, sequence: 6 },
    { ...hidden, sequence: 7 },
    row(8, "accuse_start", "player", { role: "accusation_start" }, "It is time to name the culprit."),
    // Accusation events store the player's text in player_reasoning (not player_input).
    row(
      9,
      "accuse_resolved",
      "system",
      {
        role: "graph_ending",
        player_reasoning: "Alice did it.",
        judge_result: "win",
        clue_graph_accusation: { accused: "char-alice", cited: ["clue_crumbs"], verdict: "win" },
      },
      "Alice ate all the cookies herself. You were right!",
    ),
  ];
}

// Two searches in one place, then a failed accusation and a won one.
export function makeMultiStepEvents(): TraceEventRow[] {
  const [first, second] = playedRows([{ search: null }, { search: "the pantry shelf" }]);
  return [
    first,
    second,
    row(4, "accuse_start", "player", { role: "accusation_start" }, "Name the culprit."),
    row(
      5,
      "accuse_failed",
      "system",
      {
        role: "graph_accusation_round",
        player_reasoning: "I think it was Bob.",
        judge_result: "continue",
        reply_kind: "flaw",
        clue_graph_accusation: { accused: "char-bob", cited: [], verdict: "not_yet" },
      },
      "Are you sure? What about the crumbs?",
    ),
    row(
      6,
      "accuse_resolved",
      "system",
      {
        role: "graph_ending",
        player_reasoning: "No, it was Alice. Her fingerprints are on the jar.",
        judge_result: "win",
        clue_graph_accusation: { accused: "char-alice", cited: ["clue_jar"], verdict: "win" },
      },
      "Correct.",
    ),
  ];
}

export function makeSession() {
  return {
    id: "sess-1",
    blueprint_id: "bp-1",
    ai_profile_id: "default",
    mode: "ended",
    current_location_id: "loc-living-room",
    current_talk_character_id: null,
    time_remaining: 5,
    discovered_clues: ["clue_crumbs", "alice_blames_bob", "alice_noon", "clue_bookshelf_toy"],
    outcome: "win",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:09:00Z",
  };
}

export function makeRawTrace(overrides: Record<string, unknown> = {}): RawTrace {
  return {
    schema_version: "trace/0.1",
    extracted_at: "2026-06-02T00:00:00Z",
    source: { kind: "local", database: "/tmp/mystery/game.db" },
    session: makeSession(),
    ai_profile: { id: "default", model: "mock" },
    blueprint: makeBlueprint(),
    clue_graph: { format: "clue-graph/2", revision: 1, progress: { supported_conclusions: [], culprit_supported: false, taken_back: [] } },
    events: makeEvents(),
    ...overrides,
  } as unknown as RawTrace;
}

/**
 * A short clue-graph game on the greenhouse case, shaped as the engine saves it:
 * each turn's event in `payload.clue_graph`, a greeting carrying the first
 * words, a conversation line and a search. The case is the committed file.
 */
export function makeClueGraphRawTrace(): RawTrace {
  const graph = validateClueGraph(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));
  const row = (sequence: number, event_type: string, payload: Record<string, unknown>, narration: string, model: string | null = "mock") => ({
    id: `g${sequence}`,
    sequence,
    event_type,
    actor: "system",
    payload,
    narration,
    narration_parts: [],
    clues_revealed: [],
    model,
    created_at: `2026-06-01T10:0${sequence}:00Z`,
  });
  return makeRawTrace({
    blueprint: buildClueGraphWorld(graph),
    clue_graph: { format: "clue-graph/2", revision: 1, progress: { supported_conclusions: [], culprit_supported: false, taken_back: [] } },
    events: [
      row(1, "start", { location_id: "greenhouse" }, "You arrive at the greenhouse.", null),
      row(2, "search", { role: "search", location_id: "greenhouse", search_query: "the smashed pumpkin", revealed_clue_id: "clue_welly_prints", revealed_clue_ids: ["clue_welly_prints"], revealed_off_script: [], clue_graph: { type: "search", spot: "the smashed pumpkin", notebook: { clue_welly_prints: "Small leaf-pattern welly prints in the pumpkin mush. Only Toby and Mia have leaf wellies." } } }, "In the pulp you see the print of a welly."),
      row(3, "move", { location_id: "workshop", clue_graph: { type: "move", location: "workshop" } }, "You walk to Mr. Dobbs's workshop."),
      row(4, "talk", { role: "graph_talk", character_id: "dobbs", location_id: "workshop", revealed_clue_ids: ["dobbs_rounds", "react_dobbs_slippers"], clue_graph: { type: "talk", character: "dobbs", notebook: { dobbs_rounds: "Mr. Dobbs says Bertha was whole on his 8pm rounds.", react_dobbs_slippers: "Mr. Dobbs rubbed his neck and glanced at the garden window." } } }, "Mr. Dobbs peers over his glasses. \"I saw her whole at eight,\" he says."),
      row(5, "ask", { role: "graph_talk", character_id: "dobbs", location_id: "workshop", player_input: "What about the noise last night?", revealed_clue_ids: ["clue_dobbs_crash_time"], clue_graph: { type: "line", character: "dobbs", opened: [], asked: ["clue_dobbs_crash_time"], seen: [], notebook: { clue_dobbs_crash_time: "Mr. Dobbs says he heard a big thud from the garden at about ten to nine." } } }, "\"A crash near ten,\" says Mr. Dobbs, rubbing his slippers."),
    ],
  });
}
