// Searches that earn a clue: the player describes a spot that holds an unlocked
// clue, and the narrator must reveal exactly that clue. Each case is a
// hand-written situation on a truth-set base; the comment says why it expects
// what it does. The two real failures from play are in `from-play.ts`.

import { searchCase } from "../../lib/search-case.ts";

const glitterwood = "evaluation/truth/bases/glitterwood-forest/blueprint.json";
const greenhouse = "evaluation/truth/bases/greenhouse-prizewinner/blueprint.json";
const foxes = "evaluation/truth/bases/large-snow-foxes/blueprint.json";
const lighthouse = "evaluation/truth/bases/lighthouse-lens/blueprint.json";

export default [
  // The spot's own name, and nothing locks it.
  searchCase({
    id: "exact-dusty-floor",
    group: "reveal-exact",
    blueprint: glitterwood,
    location: "dungeon",
    query: "the dusty floor",
    expect: { revealed_clue_id: "clue_wood_chips", input_understood: true },
  }),
  // The spot's own name; the clue is the only one at the spot.
  searchCase({
    id: "exact-rota-on-door",
    group: "reveal-exact",
    blueprint: greenhouse,
    location: "potting_shed",
    query: "the watering rota on the door",
    expect: { revealed_clue_id: "clue_rota_purple_ink", input_understood: true },
  }),
  // The spot's own name, with a clue from an earlier location already found,
  // so the history is not empty.
  searchCase({
    id: "exact-water-tower",
    group: "reveal-exact",
    blueprint: foxes,
    location: "platform",
    query: "behind the water tower",
    found: ["clue_far_door_open"],
    expect: { revealed_clue_id: "clue_songbook", input_understood: true },
  }),

  // "pots of paint" is "the paint pots" reworded.
  searchCase({
    id: "loose-pots-of-paint",
    group: "reveal-loose",
    blueprint: glitterwood,
    location: "fair_meadow",
    query: "the pots of paint on the bench",
    expect: { revealed_clue_id: "clue_paint_list", input_understood: true },
  }),
  // "timetable on the wall" is "the tide schedule by the door" in other words.
  searchCase({
    id: "loose-tide-timetable",
    group: "reveal-loose",
    blueprint: lighthouse,
    location: "keepers_cottage",
    query: "the tide timetable pinned on the wall",
    expect: { revealed_clue_id: "c_changed_schedule", input_understood: true },
  }),

  // Nothing here says "pumpkin" or "prints", but the squashed mess on the floor
  // is the smashed pumpkin, and a fair GM lets a player who studies it find the prints.
  searchCase({
    id: "inventive-squashed-mess",
    group: "reveal-inventive",
    blueprint: greenhouse,
    location: "greenhouse",
    query: "I kneel down and study the squashed orange mess to see what has stepped in it",
    expect: { revealed_clue_id: "clue_welly_prints", input_understood: true },
  }),
  // The harbour tide board, described by what it is for.
  searchCase({
    id: "inventive-fishermens-board",
    group: "reveal-inventive",
    blueprint: lighthouse,
    location: "village_quay",
    query: "the big painted board where the fishermen chalk up when the water goes out",
    expect: { revealed_clue_id: "c_harbour_tide_board", input_understood: true },
  }),

  // The fake stick is the culprit's evidence: the swap left it on the shelf.
  searchCase({
    id: "evidence-fake-stick",
    group: "reveal-evidence",
    blueprint: glitterwood,
    location: "dungeon",
    query: "the treasure shelf",
    found: ["clue_visitor_book"],
    expect: { revealed_clue_id: "clue_fake_stick", input_understood: true },
  }),
  // The stolen key lies at the bottom of the water butt, which the player names.
  searchCase({
    id: "evidence-stolen-key",
    group: "reveal-evidence",
    blueprint: greenhouse,
    location: "greenhouse",
    query: "the rain barrel by the door",
    expect: { revealed_clue_id: "clue_key_in_water_butt", input_understood: true },
  }),
  // The scrap of the cradle's velvet is the thief's trace on the railing.
  searchCase({
    id: "evidence-velvet-scrap",
    group: "reveal-evidence",
    blueprint: lighthouse,
    location: "village_quay",
    query: "the iron railing at the top of the causeway steps",
    found: ["c_torn_velvet"],
    expect: { revealed_clue_id: "c_velvet_scrap", input_understood: true },
  }),

  // The stolen briefcase is hidden behind the woodpile, locked until the
  // snowshoe prints that lead there are found, and they have been.
  searchCase({
    id: "unlocked-briefcase-behind-woodpile",
    group: "reveal-unlocked",
    blueprint: foxes,
    location: "woodshed",
    query: "behind the big woodpile",
    found: ["clue_far_door_open", "clue_snowshoe_prints"],
    expect: { revealed_clue_id: "clue_briefcase_found", input_understood: true },
  }),
  // Barnaby has said he left spare twigs by the pond, which unlocks the pile
  // behind the willow. The pointer came from a conversation, not a search.
  searchCase({
    id: "unlocked-twig-pile",
    group: "reveal-unlocked",
    blueprint: glitterwood,
    location: "moonglow_pond",
    query: "under the weeping willow",
    found: ["clue_fake_stick", "clue_barnaby_twigs"],
    expect: { revealed_clue_id: "clue_twig_pile", input_understood: true },
  }),
];
