// Searches that earn nothing: the narrator must reveal no clue, however
// pleasantly it narrates the attempt. Hand-written on truth-set bases; each
// comment says why the search finds nothing.

import { searchCase } from "../../lib/search-case.ts";

const glitterwood = "evaluation/truth/bases/glitterwood-forest/blueprint.json";
const greenhouse = "evaluation/truth/bases/greenhouse-prizewinner/blueprint.json";
const foxes = "evaluation/truth/bases/large-snow-foxes/blueprint.json";
const lighthouse = "evaluation/truth/bases/lighthouse-lens/blueprint.json";

export default [
  // The fake stick was found on the shelf already; a clue is never revealed twice.
  searchCase({
    id: "again-treasure-shelf",
    group: "not-already-revealed",
    blueprint: glitterwood,
    location: "dungeon",
    query: "the treasure shelf again, closer this time",
    found: ["clue_fake_stick"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The ladder's tape measure was found already, and the spot holds nothing else.
  searchCase({
    id: "again-ladder-by-fence",
    group: "not-already-revealed",
    blueprint: greenhouse,
    location: "thorne_garden",
    query: "the ladder by the fence",
    found: ["clue_ladder_tape"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // The tea nook sits beside the comfy chair, which holds the cake plate, but
  // the nook itself holds only a kettle and cups.
  searchCase({
    id: "neighbour-tea-nook",
    group: "not-neighbour",
    blueprint: glitterwood,
    location: "dungeon",
    query: "the little tea nook",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The honey bun counter is next to the hat stand with the hat case, and holds only buns.
  searchCase({
    id: "neighbour-bun-counter",
    group: "not-neighbour",
    blueprint: foxes,
    location: "tea_house",
    query: "the honey bun counter",
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The lamp shop's shiny window is scenery in the quay's description, not a
  // spot; the poster on its door is the quay's own clue, already found.
  searchCase({
    id: "scenery-lamp-shop-window",
    group: "not-neighbour",
    blueprint: lighthouse,
    location: "village_quay",
    query: "I press my nose to the shiny window of Roz's lamp shop",
    found: ["c_beacon_poster"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // The woodshed's only hidden spot is locked until the snowshoe prints are
  // found, and the player has none. Nothing here points them to it.
  searchCase({
    id: "hidden-woodshed-all-over",
    group: "not-hidden-vague",
    blueprint: foxes,
    location: "woodshed",
    query: "all over the woodshed for something hidden",
    found: ["clue_wolf_prints"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  // The pile behind the willow is locked until Barnaby mentions his twigs;
  // "by the pond" does not name it.
  searchCase({
    id: "hidden-near-the-pond",
    group: "not-hidden-vague",
    blueprint: glitterwood,
    location: "moonglow_pond",
    query: "round the edge of the pond for anything hidden",
    found: ["clue_ruby_list"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // A targeted search that names no spot at all matches none. The location's
  // own clue is already found, so the only thing to hand over would be a guess.
  searchCase({
    id: "vague-look-around",
    group: "not-vague-search",
    blueprint: greenhouse,
    location: "greenhouse",
    query: "I look around",
    found: ["clue_boot_prints"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),
  searchCase({
    id: "vague-search-for-clues",
    group: "not-vague-search",
    blueprint: lighthouse,
    location: "keepers_cottage",
    query: "for clues",
    found: ["c_round_bundle"],
    expect: { revealed_clue_id: null, input_understood: true },
  }),

  // Gibberish is not understood, finds nothing, and costs no turn (`input_understood: false`).
  searchCase({
    id: "gibberish-keys-mashed",
    group: "not-gibberish",
    blueprint: foxes,
    location: "ticket_hut",
    query: "asdkj qwpoe zzxcv",
    expect: { revealed_clue_id: null, input_understood: false },
  }),
  searchCase({
    id: "gibberish-nonsense-words",
    group: "not-gibberish",
    blueprint: lighthouse,
    location: "lantern_room",
    query: "blorp fnord 12345 ???",
    expect: { revealed_clue_id: null, input_understood: false },
  }),
];
