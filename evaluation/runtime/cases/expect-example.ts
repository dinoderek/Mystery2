// Cases that state their expected outcome, graded by code over every sample.
//
// `expect` names what the narrator's structured output must say; a key left
// out is not graded. `group` sums a case's samples with its group's, and
// `ungraded: true` would show a case without counting it in its group. Each
// case is replayed `--samples` times (default 5) per narrator.
//
// On the mock blueprint the mock provider gets both right: it reveals the clue
// in a spot a search names, and the first clue a character can share.

import type { TurnCase } from "../lib/case.ts";

const blueprint = { path: "blueprints/mock-blueprint.json" };

/** Naming the spot that holds an unlocked clue earns it. */
const searchPantryShelf: TurnCase = {
  id: "search-pantry-shelf-reveals-jar",
  blueprint,
  group: "example-should-reveal",
  given: { mode: "explore", location_id: "loc-kitchen", time_remaining: 8, history: [] },
  action: { type: "search", search_query: "the pantry shelf" },
  expect: { revealed_clue_id: "clue-jar", input_understood: true },
};

/** Alice's one clue has no lock, so a question about Bob earns it, and uses no clue. */
const askAliceAboutBob: TurnCase = {
  id: "ask-alice-about-bob-shares-sighting",
  blueprint,
  group: "example-should-give",
  given: {
    mode: "talk",
    location_id: "loc-kitchen",
    talk_character_id: "char-alice",
    time_remaining: 7,
    history: [
      {
        event_type: "talk",
        actor: "system",
        narration: "You step closer to Alice by the kitchen counter.",
        payload: { character_id: "char-alice" },
      },
    ],
  },
  action: { type: "ask", player_input: "Did you see Bob in the kitchen today?" },
  expect: { revealed_clue_ids: ["clue-alice-saw-bob"], used_clue_ids: [], input_understood: true },
};

export default [searchPantryShelf, askAliceAboutBob];
