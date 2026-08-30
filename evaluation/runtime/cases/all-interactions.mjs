// One case per narrator interaction — the coverage baseline.
//
// Before this file, only `talk` and `ask` were ever evaluated: six of the nine
// interactions had never been judged for reading level at all, including
// `accusation_verdict`, which carries the largest word budget in the system.
//
// Every case is deterministic in the usual way: a fully-specified `given` plus
// exactly ONE action, so the model input is identical every run and across
// models. `start` is the one exception to the shape — it creates its own
// session, so its `given` is empty (see `createsSession` in lib/roles.mjs).
//
// The blueprint is the seeded mock (target_age 10), so `flesch` and
// `age_appropriate` both grade against age 10.

const BLUEPRINT = { path: "blueprints/mock-blueprint.json" };
const JUDGES = ["flesch", "age_appropriate"];
const JUDGE_CONFIG = { flesch: { tolerance: 2 } };

/** Prior events shared by the mid-session cases, so history is never empty. */
const OPENING_HISTORY = [
  {
    event_type: "start",
    actor: "system",
    narration: "You step into the kitchen. The cake tin is open and empty.",
    payload: { location_id: "loc-kitchen" },
  },
];

const base = (id, given, action) => ({
  id,
  blueprint: BLUEPRINT,
  given,
  action,
  judges: JUDGES,
  judgeConfig: JUDGE_CONFIG,
});

export default [
  // intro — game-start creates the session, so there is no prior state.
  base("intro", {}, { type: "start" }),

  // ambience — arriving somewhere new.
  base(
    "ambience-first-visit",
    { mode: "explore", location_id: "loc-kitchen", time_remaining: 10, history: OPENING_HISTORY },
    { type: "move", destination: "loc-living-room" },
  ),

  // search_empty — a bare search of a location whose clue is already found, so
  // the narrator has nothing to reveal and gets the lean word budget.
  base(
    "search-bare-nothing-left",
    {
      mode: "explore",
      location_id: "loc-kitchen",
      time_remaining: 8,
      discovered_clues: ["clue-crumb"],
      history: [
        ...OPENING_HISTORY,
        {
          event_type: "search",
          actor: "system",
          narration: "You find a trail of crumbs by the counter.",
          payload: { location_id: "loc-kitchen", revealed_clue_ids: ["clue-crumb"] },
        },
      ],
    },
    { type: "search" },
  ),

  // search_find — a bare search that WILL surface a clue (the roomier budget).
  base(
    "search-bare-reveals-clue",
    { mode: "explore", location_id: "loc-kitchen", time_remaining: 9, history: OPENING_HISTORY },
    { type: "search" },
  ),

  // search_targeted — free text the narrator adjudicates itself.
  base(
    "search-targeted-pantry",
    { mode: "explore", location_id: "loc-kitchen", time_remaining: 9, history: OPENING_HISTORY },
    { type: "search", search_query: "look inside the pantry, behind the jars" },
  ),

  // talk_greeting
  base(
    "talk-greeting-alice",
    { mode: "explore", location_id: "loc-kitchen", time_remaining: 8, history: OPENING_HISTORY },
    { type: "talk", character_id: "char-alice" },
  ),

  // talk_round — an interrogation turn with the conversation already open.
  base(
    "talk-round-pressure-alice",
    {
      mode: "talk",
      location_id: "loc-kitchen",
      talk_character_id: "char-alice",
      time_remaining: 7,
      history: [
        ...OPENING_HISTORY,
        {
          event_type: "talk",
          actor: "system",
          narration: "Alice looks up from the sink. \"Oh — hello.\"",
          payload: { character_id: "char-alice", location_id: "loc-kitchen" },
        },
      ],
    },
    { type: "ask", player_input: "Then why are there crumbs on your sleeve?" },
  ),

  // talk_farewell
  base(
    "talk-farewell-alice",
    {
      mode: "talk",
      location_id: "loc-kitchen",
      talk_character_id: "char-alice",
      time_remaining: 6,
      history: [
        ...OPENING_HISTORY,
        {
          event_type: "talk",
          actor: "system",
          narration: "Alice looks up from the sink. \"Oh — hello.\"",
          payload: { character_id: "char-alice", location_id: "loc-kitchen" },
        },
      ],
    },
    { type: "end_talk" },
  ),

  // accusation_open — accuse with no reasoning yet opens the scene.
  base(
    "accusation-open",
    { mode: "explore", location_id: "loc-kitchen", time_remaining: 2, history: OPENING_HISTORY },
    { type: "accuse" },
  ),

  // accusation_verdict — the payoff, and the most generous word budget.
  base(
    "accusation-verdict-well-argued",
    {
      mode: "accuse",
      location_id: "loc-kitchen",
      time_remaining: 1,
      discovered_clues: ["clue-crumb", "clue-jar"],
      history: [
        ...OPENING_HISTORY,
        {
          event_type: "search",
          actor: "system",
          narration: "You find a trail of crumbs by the counter.",
          payload: { location_id: "loc-kitchen", revealed_clue_ids: ["clue-crumb"] },
        },
        {
          event_type: "accuse_start",
          actor: "system",
          narration: "It is time to name who took the cake.",
          payload: { role: "accusation_start" },
        },
      ],
    },
    {
      type: "accuse",
      player_reasoning:
        "It was Alice. The crumbs by the counter match the cake, and she was the only one in the kitchen all afternoon.",
    },
  ),
];
