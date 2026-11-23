// One case per narrator interaction on the clue-graph mock case
// (`blueprints/clue-graph/mock-case.json`): the coverage baseline. Every
// interaction is judged for reading level here, `accusation_verdict` included,
// which carries the largest word budget in the system (`InteractionId` in
// `packages/shared/src/age-profile.ts`).
//
// Each case is deterministic in the usual way: a short play the engine folds
// into history, then exactly ONE action, so the model input is identical every
// run and across models. `start` is the exception to the shape: it creates its
// own session, so its `given` is empty. The mock case targets age 10, so
// `flesch` and `age_appropriate_turn` both grade against age 10.

import { accusationCase, actionCase, lineCase, searchCase, startCase, type Step } from "../support/play.ts";

const MOCK = "blueprints/clue-graph/mock-case.json";
const JUDGES = { judges: ["flesch", "age_appropriate_turn"], judgeConfig: { flesch: { tolerance: 2 } } };

export const ALICE_GREETS: Step = {
  talk: "char-alice",
  narration: "Alice looks up from the counter, flour on her nose. \"Oh, hello! Did you see who took my cookies? It was Bob, I'm sure of it. I saw him sneak in at noon.\"",
};

/** The kitchen and the living room searched: the crumbs, the jar and the score sheet that clears Bob. */
export const WELL_ARGUED_STEPS: Step[] = [{ search: null }, { search: "the pantry shelf" }, { move: "loc-living-room" }, { search: null }];
export const WELL_ARGUED = "It was Alice. The jar lid is covered in her floury fingerprints, and Bob's score sheet shows he was playing a board game all through noon.";

export default [
  // intro: game-start creates the session, so there is no prior state.
  startCase(MOCK, { id: "intro", ...JUDGES }),

  // ambience: arriving somewhere new.
  actionCase(MOCK, [], { type: "move", destination: "loc-living-room" }, { id: "ambience-first-visit", ...JUDGES }),

  // search_empty: a bare search of a room whose evidence is already found, so
  // the narrator has nothing to reveal and gets the lean word budget.
  searchCase(MOCK, [{ search: null }], null, { id: "search-bare-nothing-left", ...JUDGES }),

  // search_find: a bare search that will surface a clue (the roomier budget).
  searchCase(MOCK, [], null, { id: "search-bare-reveals-clue", ...JUDGES }),

  // search_find, targeted: a spot the narrator matches itself.
  searchCase(MOCK, [], "look inside the pantry, behind the jars", { id: "search-targeted-pantry", ...JUDGES }),

  // talk_greeting
  actionCase(MOCK, [], { type: "talk", character_id: "char-alice" }, { id: "talk-greeting-alice", ...JUDGES }),

  // talk_round: an interrogation turn with the conversation already open.
  lineCase(MOCK, [ALICE_GREETS], "Then why are there crumbs on your sleeve?", { id: "talk-round-pressure-alice", ...JUDGES }),

  // talk_farewell
  actionCase(MOCK, [ALICE_GREETS], { type: "end_talk" }, { id: "talk-farewell-alice", ...JUDGES }),

  // accusation_open: accuse with no reasoning yet opens the scene.
  actionCase(MOCK, [{ search: null }, { search: "the pantry shelf" }], { type: "accuse" }, { id: "accusation-open", ...JUDGES }),

  // accusation_verdict: the payoff, and the most generous word budget.
  accusationCase(
    MOCK,
    WELL_ARGUED_STEPS,
    WELL_ARGUED,
    { id: "accusation-verdict-well-argued", ...JUDGES },
  ),
];
