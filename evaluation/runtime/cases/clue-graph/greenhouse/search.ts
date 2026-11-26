// Searches on the clue-graph greenhouse, by kind. A search gives one clue: the
// engine names the spot from the words, or lets the narrator judge loose words
// against the visible spots (`docs/clue-graph.md`, "In play"). Groups:
//
// - search-spot: words that mean one spot, exactly, loosely or by what it is;
//   that spot's clue.
// - search-plain: a look around the room gives the room's own clue, or nothing.
// - search-nothing: a spot already searched, words that mean no spot, or a place
//   the room does not have; no clue.
//
// The greenhouse has no hidden spot, so a hidden spot named before its pointer
// waits for a story that has one.

import { searchCase, type Step, type Story } from "../support/play.ts";

const GREENHOUSE: Story = { file: "blueprints/clue-graph/greenhouse-prizewinner.json", reading_age: 10 };
const search = (steps: Step[], query: string | null, labels: Parameters<typeof searchCase>[3]) => searchCase(GREENHOUSE, steps, query, labels);

export default [
  // The spot's own name, and the clue is the only one at the spot.
  search([{ move: "potting_shed" }], "the watering rota on the door", {
    id: "exact-rota-on-door",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_rota_purple_ink", input_understood: true },
  }),
  // Nothing here says "pumpkin" or "prints", but the squashed mess is the smashed pumpkin.
  search([], "I kneel down and study the squashed orange mess to see what has stepped in it", {
    id: "inventive-squashed-mess",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_welly_prints", input_understood: true },
  }),
  // The water butt, called a rain barrel: the stolen key lies at its bottom.
  search([], "the rain barrel by the door", {
    id: "evidence-stolen-key",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_key_in_water_butt", input_understood: true },
  }),
  // What the bench is, not its name.
  search([{ search: null }], "the wooden table that fell over", {
    id: "loose-fallen-bench",
    group: "search-spot",
    expect: { revealed_clue_id: "clue_snapped_bench", input_understood: true },
  }),

  // A look around the greenhouse finds the boot prints, its own clue.
  search([], null, {
    id: "plain-greenhouse",
    group: "search-plain",
    expect: { revealed_clue_id: "clue_boot_prints", input_understood: true },
  }),
  // The potting shed's clues are all at spots: a look around finds nothing.
  search([{ move: "potting_shed" }], null, {
    id: "plain-potting-shed",
    group: "search-plain",
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // The ladder's tape measure was found already, and the spot holds nothing else.
  search([{ move: "thorne_garden" }, { search: "the ladder by the fence" }], "the ladder by the fence", {
    id: "again-ladder-by-fence",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // Words that name no spot. The room's own clue is found, so the only thing to hand over would be a guess.
  search([{ search: null }], "I look around", {
    id: "vague-look-around",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The greenhouse has no floorboards: nothing is there to find.
  search([{ search: null }], "under the floorboards", {
    id: "no-such-floorboards",
    group: "search-nothing",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
];
