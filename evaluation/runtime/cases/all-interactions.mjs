// One case per narrator interaction, at more than one target age.
//
// Before this suite, only `talk` and `ask` were ever evaluated: six of the nine
// interactions had never been judged for reading level at all, including
// `accusation_verdict`, which carries the largest word budget in the system.
//
// The nine interactions are defined ONCE as a factory and instantiated per
// blueprint, so a run pivots cleanly on interaction x age — the same nine
// prompts, graded against two different reading levels. Age is the dial the
// narrator is most likely to get wrong, and a single-age suite cannot show it.
//
// Every case is deterministic in the usual way: a fully-specified `given` plus
// exactly ONE action, so the model input is identical every run and across
// models. `start` is the one exception to the shape — it creates its own
// session, so its `given` is empty (see `createsSession` in lib/roles.mjs).

const JUDGES = ["flesch", "age_appropriate"];
const JUDGE_CONFIG = { flesch: { tolerance: 2 } };

/**
 * Build the nine-interaction set for one blueprint.
 *
 * `w` names the blueprint's own world so the shared shapes stay grounded in
 * real ids: the location the player starts in, somewhere to move to, a location
 * whose clue can be found by a bare search, a character to question, and a
 * plausible piece of accusation reasoning.
 */
export function buildInteractionCases(w) {
  const opening = [
    {
      event_type: "start",
      actor: "system",
      narration: w.openingNarration,
      payload: { location_id: w.startLocation },
    },
  ];

  const talkOpened = [
    ...opening,
    {
      event_type: "talk",
      actor: "system",
      narration: w.talkOpenNarration,
      payload: { character_id: w.character, location_id: w.startLocation },
    },
  ];

  const searchDone = [
    ...opening,
    {
      event_type: "search",
      actor: "system",
      narration: w.searchNarration,
      payload: { location_id: w.clueLocation, revealed_clue_ids: [w.clue] },
    },
  ];

  const base = (interaction, given, action) => ({
    id: `${w.slug}-${interaction}`,
    blueprint: { path: w.path },
    given,
    action,
    judges: JUDGES,
    judgeConfig: JUDGE_CONFIG,
  });

  return [
    // intro — game-start creates the session, so there is no prior state.
    base("intro", {}, { type: "start" }),

    // ambience — arriving somewhere new.
    base(
      "ambience",
      { mode: "explore", location_id: w.startLocation, time_remaining: 10, history: opening },
      { type: "move", destination: w.moveTo },
    ),

    // search_empty — the location's clue is already found, so there is nothing
    // to reveal and the narrator gets the lean word budget.
    base(
      "search-empty",
      {
        mode: "explore",
        location_id: w.clueLocation,
        time_remaining: 8,
        discovered_clues: [w.clue],
        history: searchDone,
      },
      { type: "search" },
    ),

    // search_find — a bare search that WILL surface a clue (roomier budget).
    base(
      "search-find",
      { mode: "explore", location_id: w.clueLocation, time_remaining: 9, history: opening },
      { type: "search" },
    ),

    // search_targeted — free text the narrator adjudicates itself.
    base(
      "search-targeted",
      { mode: "explore", location_id: w.clueLocation, time_remaining: 9, history: opening },
      { type: "search", search_query: w.searchQuery },
    ),

    // talk_greeting
    base(
      "talk-greeting",
      { mode: "explore", location_id: w.startLocation, time_remaining: 8, history: opening },
      { type: "talk", character_id: w.character },
    ),

    // talk_round — an interrogation turn with the conversation already open.
    base(
      "talk-round",
      {
        mode: "talk",
        location_id: w.startLocation,
        talk_character_id: w.character,
        time_remaining: 7,
        history: talkOpened,
      },
      { type: "ask", player_input: w.playerQuestion },
    ),

    // talk_farewell
    base(
      "talk-farewell",
      {
        mode: "talk",
        location_id: w.startLocation,
        talk_character_id: w.character,
        time_remaining: 6,
        history: talkOpened,
      },
      { type: "end_talk" },
    ),

    // accusation_open — accuse with no reasoning yet opens the scene.
    base(
      "accusation-open",
      { mode: "explore", location_id: w.startLocation, time_remaining: 2, history: opening },
      { type: "accuse" },
    ),

    // accusation_verdict — the payoff, and the most generous word budget.
    base(
      "accusation-verdict",
      {
        mode: "accuse",
        location_id: w.startLocation,
        time_remaining: 1,
        discovered_clues: [w.clue],
        history: [
          ...searchDone,
          {
            event_type: "accuse_start",
            actor: "system",
            narration: w.accuseOpenNarration,
            payload: { role: "accusation_start" },
          },
        ],
      },
      { type: "accuse", player_reasoning: w.playerReasoning },
    ),
  ];
}

// target_age 10, no authored narration_style.
const MOCK_AGE_10 = {
  slug: "age10",
  path: "supabase/seed/blueprints/mock-blueprint.json",
  startLocation: "loc-kitchen",
  moveTo: "loc-living-room",
  clueLocation: "loc-kitchen",
  clue: "clue-crumb",
  character: "char-alice",
  searchQuery: "look inside the pantry, behind the jars",
  playerQuestion: "Then why are there crumbs on your sleeve?",
  playerReasoning:
    "It was Alice. The crumbs by the counter match the cake, and she was the only one in the kitchen all afternoon.",
  openingNarration: "You step into the kitchen. The cake tin is open and empty.",
  talkOpenNarration: 'Alice looks up from the sink. "Oh — hello."',
  searchNarration: "You find a trail of crumbs by the counter.",
  accuseOpenNarration: "It is time to name who took the cake.",
};

// target_age 7, and it carries an authored metadata.narration_style — so this
// half of the sweep also exercises the style layer against the reading level.
const HEARTWOOD_AGE_7 = {
  slug: "age7",
  path: "supabase/seed/blueprints/the-missing-heartwood.json",
  startLocation: "glimmerbank_landing",
  moveTo: "heartwood_hollow",
  clueLocation: "heartwood_hollow",
  clue: "clue_footprint_trail",
  character: "sophie",
  searchQuery: "look closely at the torn roots by the pit",
  playerQuestion: "Did you see anyone go near the hollow?",
  playerReasoning:
    "It was Eva. The footprints lead from the hollow to her leaf-lab, and her gloves were still glowing.",
  openingNarration: "You arrive at the landing. Everyone is looking for the Heartwood.",
  talkOpenNarration: 'Sophie waves you over. "You came! Good."',
  searchNarration: "You spot a trail of footprints leading away from the pit.",
  accuseOpenNarration: "It is time to say who took the Heartwood.",
};

export default [
  ...buildInteractionCases(MOCK_AGE_10),
  ...buildInteractionCases(HEARTWOOD_AGE_7),
];
