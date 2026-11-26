// Searches on the clue-graph dragon crown, by kind, in the greenhouse library's
// groups (`../greenhouse/search.ts`). A search gives one clue: the engine names
// the spot from the words, or lets the narrator judge loose words against the
// visible spots (`docs/clue-graph.md`, "In play"). This story has a hidden spot:
// behind the big paper dragon is not a spot until Mr. Pike's sighting points to
// it, and naming it first finds nothing.
//
// - search-spot: words that mean one spot, exactly, loosely or by what it is;
//   that spot's clue. Includes the hidden spot, once its pointer is held.
// - search-plain: a look around the room; every clue here is at a spot, so nothing.
// - search-nothing: a spot already searched, the hidden spot before its pointer,
//   words that mean no spot, or a place the room does not have; no clue.

import { searchCase, type Step, type Story } from "../support/play.ts";

const CROWN: Story = { file: "blueprints/clue-graph/dragon-crown.json", reading_age: 8 };
const search = (steps: Step[], query: string | null, labels: Parameters<typeof searchCase>[3]) => searchCase(CROWN, steps, query, labels);

/** Mr. Pike's sighting, which points at the hidden spot, then the art room. */
export const POINTED: Step[] = [
  { move: "playground" },
  {
    talk: "pike",
    narration: "Mr. Pike looks down from the bike-shed roof and rubs his chin. \"I've been up on the bike-shed roof since twelve, mending the felt. Right across from the art room windows, as it happens.\"",
  },
  {
    say: "What could you see through the art room window?",
    reply: "Mr. Pike nods slowly. \"At about quarter past twelve I saw young Leo through the art room window. He tucked a bundle wrapped in his apron behind the big paper dragon, and he looked ever so guilty.\"",
    asked: ["clue_pike_saw_bundle"],
  },
  { move: "art_room" },
];

export default [
  // The spot's own name, and the clue is the only one at the spot.
  search([{ move: "art_room" }], "the paint shelf", {
    id: "exact-paint-shelf",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_glue_out", input_understood: true },
  }),
  // What the steps are, not their name.
  search([{ move: "hall" }], "the wooden steps up to the stage where the cushion sits", {
    id: "loose-wooden-steps",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_gold_on_steps", input_understood: true },
  }),
  // The sign-in sheet, called what it is.
  search([{ move: "library" }], "the clipboard on the desk by the door", {
    id: "loose-clipboard-on-desk",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_signin_sheet", input_understood: true },
  }),
  // The back of the shed, where nobody walks.
  search([{ move: "playground" }], "I crouch at the back of the shed where the grass is flattened", {
    id: "inventive-back-of-shed",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_script_cards", input_understood: true },
  }),
  // The hidden spot, once Mr. Pike has pointed at it.
  search(POINTED, "behind the big paper dragon", {
    id: "exact-behind-dragon",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_crown_behind_dragon", input_understood: true },
  }),
  search(POINTED, "I peek behind the huge cardboard dragon in the corner", {
    id: "loose-behind-dragon",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_crown_behind_dragon", input_understood: true },
  }),

  // Every clue in the hall is at a spot: a look around finds nothing.
  search([{ move: "hall" }], null, {
    id: "plain-hall",
    group: "search-plain",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  search([{ move: "art_room" }], null, {
    id: "plain-art-room",
    group: "search-plain",
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // The dragon is only a spot once someone has said where Leo hid the bundle.
  search([{ move: "art_room" }], "behind the big paper dragon", {
    id: "hidden-before-pointer",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  search([{ move: "art_room" }], "I look behind the dragon scenery", {
    id: "hidden-before-pointer-loose",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The steps were searched already, and the spot holds nothing else.
  search([{ move: "hall" }, { search: "the stage steps" }], "the stage steps", {
    id: "again-stage-steps",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The library has no stage: nothing is there to find.
  search([{ move: "library" }], "under the stage", {
    id: "no-such-stage",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
];
