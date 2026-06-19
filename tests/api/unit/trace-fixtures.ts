// Shared fixtures for the trace-evaluation pipeline unit tests.
//
// A compact blueprint shaped like Blueprint V2 (only the fields the trace
// pipeline reads) plus a small played event log. Not a .test.ts file, so vitest
// imports it without running it as a suite.

export function makeBlueprint() {
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
  };
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
  created_at: string;
};

// A clean, rule-abiding played trace: explore, search, talk, ask, move, search,
// accuse. Returns game_events-shaped rows (unsorted on purpose).
export function makeEvents(): TraceEventRow[] {
  return [
    { id: "e1", sequence: 1, event_type: "start", actor: "narrator", payload: { location_id: "loc_hall" }, narration: "You arrive at the grand hall as the dinner party winds down.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z" },
    { id: "e2", sequence: 2, event_type: "search", actor: "system", payload: { location_id: "loc_hall", revealed_clue_id: "clue_hall_1", diagnostics: { time_after: 19 } }, narration: "You spot a muddy footprint near the trophy case.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:01:00Z" },
    { id: "e3", sequence: 3, event_type: "talk", actor: "system", payload: { character_id: "char_mara", character_name: "Mara", location_id: "loc_hall" }, narration: "Mara wipes her hands and looks up.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:02:00Z" },
    { id: "e4", sequence: 4, event_type: "ask", actor: "char_mara", payload: { character_id: "char_mara", player_input: "Did you see anything?", revealed_clue_ids: ["clue_mara_1"], diagnostics: { time_after: 18 } }, narration: "\"I saw a shadow slip toward the garden,\" Mara says.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:03:00Z" },
    { id: "e5", sequence: 5, event_type: "end_talk", actor: "system", payload: { character_id: "char_mara" }, narration: "You thank Mara.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:04:00Z" },
    { id: "e6", sequence: 6, event_type: "move", actor: "narrator", payload: { location_id: "loc_garden", diagnostics: { time_after: 17 } }, narration: "You step out into the walled garden.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:05:00Z" },
    { id: "e7", sequence: 7, event_type: "search", actor: "system", payload: { location_id: "loc_garden", search_query: "look by the wall", revealed_clue_id: "clue_garden_1", diagnostics: { time_after: 16 } }, narration: "By the wall, the roses are trampled.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:06:00Z" },
    { id: "e8", sequence: 8, event_type: "accuse_start", actor: "narrator", payload: {}, narration: "It is time to name the culprit.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:07:00Z" },
    { id: "e9", sequence: 9, event_type: "accuse_resolved", actor: "narrator", payload: { player_input: "Dorn did it." }, narration: "Dorn slipped into the hall and took the medal while everyone was at dinner. You were right!", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:08:00Z" },
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

export function makeRawTrace(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "trace/0.1",
    extracted_at: "2026-06-02T00:00:00Z",
    source: { kind: "supabase", api_url: "http://localhost:54321" },
    session: makeSession(),
    ai_profile: { id: "default", provider: "mock", model: "mock" },
    blueprint: makeBlueprint(),
    events: makeEvents(),
    ...overrides,
  };
}
