import type { BlueprintContext } from "../../../packages/game-engine/src/ai-context.ts";
import fs from "node:fs";
import { buildClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import type { RawTrace } from "../../../evaluation/trace/lib/normalize.ts";

// Shared fixtures for the trace-evaluation pipeline unit tests.
//
// A compact blueprint shaped like Blueprint V2 (only the fields the trace
// pipeline reads) plus a small played event log. Not a .test.ts file, so vitest
// imports it without running it as a suite.

export function makeBlueprint(): BlueprintContext {
  return {
    metadata: { title: "The Missing Medal", one_liner: "A medal vanishes.", target_age: 9, time_budget: 20 },
    narrative: { premise: "A prize medal has gone missing during the dinner party." },
    world: {
      starting_location_id: "loc_hall",
      locations: [
        {
          id: "loc_hall",
          name: "Grand Hall",
          description: "A candlelit hall with a long dinner table.",
          clues: [{ id: "clue_hall_1", text: "A muddy footprint near the trophy case." }],
          sub_locations: [
            { id: "sub_rug", name: "under the rug", hint: "The rug is rumpled.", clues: [{ id: "clue_rug_1", text: "A torn cloakroom ticket." }] },
          ],
        },
        {
          id: "loc_garden",
          name: "Walled Garden",
          description: "A walled garden behind the hall.",
          clues: [{ id: "clue_garden_1", text: "Trampled roses by the wall." }],
          sub_locations: [],
        },
      ],
      characters: [
        {
          id: "char_mara",
          first_name: "Mara",
          last_name: "Vale",
          location_id: "loc_hall",
          sex: "female",
          appearance: "Tall, in a green apron.",
          background: "The household cook.",
          personality: "Warm but nervous.",
          initial_attitude_towards_investigator: "Helpful.",
          stated_alibi: "I was in the kitchen all evening.",
          motive: null,
          is_culprit: false,
          clues: [{ id: "clue_mara_1", text: "Mara saw a shadow slip toward the garden." }],
          flavor_knowledge: ["Knows the dinner menu."],
          actual_actions: [{ sequence: 1, summary: "Mara cooked and served dinner in the kitchen." }],
          agendas: [],
        },
        {
          id: "char_dorn",
          first_name: "Dorn",
          last_name: "Pike",
          location_id: "loc_garden",
          sex: "male",
          appearance: "Wiry, muddy boots.",
          background: "The groundskeeper.",
          personality: "Gruff and evasive.",
          initial_attitude_towards_investigator: "Defensive.",
          stated_alibi: "I was pruning in the garden.",
          motive: "He owed money and the medal was valuable.",
          is_culprit: true,
          clues: [{ id: "clue_dorn_1", text: "Dorn's torn glove was found by the trophy case." }],
          flavor_knowledge: ["Knows every gate in the garden wall."],
          actual_actions: [{ sequence: 1, summary: "Dorn slipped into the hall and took the medal while everyone was at dinner." }],
          agendas: [],
        },
      ],
    },
    ground_truth: {
      what_happened: "Dorn slipped into the hall and took the medal while everyone was at dinner.",
      why_it_happened: "Dorn owed money and meant to sell the medal.",
      timeline: ["Dinner began at six o'clock and every guest was seated together in the long candlelit hall."],
    },
    solution_paths: [
      { id: "sol_1", summary: "Footprint + glove point to Dorn.", location_clue_ids: ["clue_hall_1"], character_clue_ids: ["clue_dorn_1"] },
    ],
    red_herrings: [],
    suspect_elimination_paths: [
      { id: "elim_mara", summary: "Mara was in the kitchen.", location_clue_ids: [], character_clue_ids: ["clue_mara_1"] },
    ],
  } as unknown as BlueprintContext;
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

// A clean, rule-abiding played trace: explore, search, talk, ask, move, search,
// accuse. Returns game_events-shaped rows (unsorted on purpose).
export function makeEvents(): TraceEventRow[] {
  return [
    { id: "e1", sequence: 1, event_type: "start", actor: "narrator", payload: { location_id: "loc_hall" }, narration: "You arrive at the grand hall as the dinner party winds down.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z" },
    // Real search payloads carry BOTH the per-turn find (revealed_clue_id) and
    // the cumulative location list (revealed_clue_ids) — see the search resolver.
    { id: "e2", sequence: 2, event_type: "search", actor: "system", payload: { location_id: "loc_hall", revealed_clue_id: "clue_hall_1", revealed_clue_ids: ["clue_hall_1"], diagnostics: { time_after: 19 } }, narration: "You spot a muddy footprint near the trophy case.", narration_parts: [], clues_revealed: [], model: "anthropic/claude-actual", created_at: "2026-06-01T10:01:00Z" },
    { id: "e3", sequence: 3, event_type: "talk", actor: "system", payload: { character_id: "char_mara", character_name: "Mara", location_id: "loc_hall" }, narration: "Mara wipes her hands and looks up.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:02:00Z" },
    { id: "e4", sequence: 4, event_type: "ask", actor: "char_mara", payload: { character_id: "char_mara", player_input: "Did you see anything?", revealed_clue_ids: ["clue_mara_1"], diagnostics: { time_after: 18 } }, narration: "\"I saw a shadow slip toward the garden,\" Mara says.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:03:00Z" },
    { id: "e5", sequence: 5, event_type: "end_talk", actor: "system", payload: { character_id: "char_mara" }, narration: "You thank Mara.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:04:00Z" },
    { id: "e6", sequence: 6, event_type: "move", actor: "narrator", payload: { location_id: "loc_garden", diagnostics: { time_after: 17 } }, narration: "You step out into the walled garden.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:05:00Z" },
    { id: "e7", sequence: 7, event_type: "search", actor: "system", payload: { location_id: "loc_garden", search_query: "look by the wall", revealed_clue_id: "clue_garden_1", revealed_clue_ids: ["clue_garden_1"], diagnostics: { time_after: 16 } }, narration: "By the wall, the roses are trampled.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:06:00Z" },
    { id: "e8", sequence: 8, event_type: "accuse_start", actor: "player", payload: { role: "accusation_start" }, narration: "It is time to name the culprit.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:07:00Z" },
    // Accusation events store the player's text in player_reasoning (not player_input).
    { id: "e9", sequence: 9, event_type: "accuse_resolved", actor: "system", payload: { role: "accusation_judge", player_reasoning: "Dorn did it.", judge_result: "win" }, narration: "Dorn slipped into the hall and took the medal while everyone was at dinner. You were right!", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:08:00Z" },
  ];
}

// A two-search-in-one-location trace plus a failed accusation and a won one,
// modeling the real persisted payload shapes (cumulative search
// revealed_clue_ids; accusation player_reasoning). Used to guard against the
// per-turn/cumulative and reasoning reconstruction bugs.
export function makeMultiStepEvents(): TraceEventRow[] {
  return [
    { id: "m1", sequence: 1, event_type: "search", actor: "system", payload: { location_id: "loc_hall", revealed_clue_id: "clue_hall_1", revealed_clue_ids: ["clue_hall_1"] }, narration: "A muddy footprint.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z" },
    // Second search in the SAME location: a new sub-location clue, with the
    // cumulative list now holding both. A correct per-turn reading reveals only
    // clue_rug_1 here and must NOT flag clue_hall_1 as re-revealed.
    { id: "m2", sequence: 2, event_type: "search", actor: "system", payload: { location_id: "loc_hall", search_query: "under the rug", revealed_clue_id: "clue_rug_1", revealed_clue_ids: ["clue_hall_1", "clue_rug_1"] }, narration: "A torn cloakroom ticket under the rug.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:01:00Z" },
    { id: "m3", sequence: 3, event_type: "accuse_start", actor: "player", payload: { role: "accusation_start" }, narration: "Name the culprit.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:02:00Z" },
    { id: "m4", sequence: 4, event_type: "accuse_failed", actor: "system", payload: { role: "accusation_judge", player_reasoning: "I think it was Mara.", judge_result: "continue", reply_kind: null }, narration: "Are you sure? What about her alibi?", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:03:00Z" },
    { id: "m5", sequence: 5, event_type: "accuse_resolved", actor: "system", payload: { role: "accusation_judge", player_reasoning: "No — it was Dorn, his glove was by the case.", judge_result: "win" }, narration: "Correct.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:04:00Z" },
  ];
}

export function makeSession() {
  return {
    id: "sess-1",
    blueprint_id: "bp-1",
    ai_profile_id: "default",
    mode: "ended",
    current_location_id: "loc_garden",
    current_talk_character_id: null,
    time_remaining: 16,
    discovered_clues: ["clue_hall_1", "clue_mara_1", "clue_garden_1"],
    outcome: "win",
    created_at: "2026-06-01T10:00:00Z",
    updated_at: "2026-06-01T10:08:00Z",
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
      row(2, "search", { role: "search", location_id: "greenhouse", search_query: "the smashed pumpkin", revealed_clue_id: "clue_welly_prints", revealed_clue_ids: ["clue_welly_prints"], clue_graph: { type: "search", spot: "the smashed pumpkin", notebook: { clue_welly_prints: "Small leaf-pattern welly prints in the pumpkin mush. Only Toby and Mia have leaf wellies." } } }, "In the pulp you see the print of a welly."),
      row(3, "move", { location_id: "workshop", clue_graph: { type: "move", location: "workshop" } }, "You walk to Mr. Dobbs's workshop."),
      row(4, "talk", { role: "graph_talk", character_id: "dobbs", location_id: "workshop", revealed_clue_ids: ["dobbs_rounds", "react_dobbs_slippers"], clue_graph: { type: "talk", character: "dobbs", notebook: { dobbs_rounds: "Mr. Dobbs says Bertha was whole on his 8pm rounds.", react_dobbs_slippers: "Mr. Dobbs rubbed his neck and glanced at the garden window." } } }, "Mr. Dobbs peers over his glasses. \"I saw her whole at eight,\" he says."),
      row(5, "ask", { role: "graph_talk", character_id: "dobbs", location_id: "workshop", player_input: "What about the noise last night?", revealed_clue_ids: ["clue_dobbs_crash_time"], clue_graph: { type: "line", character: "dobbs", opened: [], asked: ["clue_dobbs_crash_time"], seen: [], notebook: { clue_dobbs_crash_time: "Mr. Dobbs says he heard a big thud from the garden at about ten to nine." } } }, "\"A crash near ten,\" says Mr. Dobbs, rubbing his slippers."),
    ],
  });
}
