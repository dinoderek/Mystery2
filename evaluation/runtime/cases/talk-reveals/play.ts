// Four turns cut from stored self-play games (Haiku narrating, 2026-11-20),
// where the narrator withheld what the player had earned. Each history is the
// game's own events up to the turn (`histories/`), and the blueprint is the
// one it was played on (`blueprints/`). The library must reproduce play: on
// today's prompt these fail on Haiku about as often as they did in play.
//
// Toby, `lucia-heartwood` (kid-7, turns 18 and 19). The player holds
// `clue_pink_feather`, the sole leverage gate of `clue_toby_glade_visit`, and
// puts it to him; he deflected both times and no use was recorded. Wanda,
// `large-snow-foxes` round 3 (kid-7, turns 24 and 25). The player pressed the
// wolf pawprints and her rack tag, which earn her self-protect parts; she
// conceded the rack tag only, and kept denying the back steps.

import fs from "node:fs";

import type { HistoryEntry, TurnCase } from "../../lib/case.ts";

function history(file: string): HistoryEntry[] {
  return JSON.parse(fs.readFileSync(new URL(`./histories/${file}`, import.meta.url), "utf8"));
}

const toby = history("toby.json");
const wanda = history("wanda.json");
const tobyPlace = "glitter_lane";
const wandaPlace = "teahouse";

const tobyBlueprint = { path: "evaluation/runtime/cases/talk-reveals/blueprints/toby-heartwood.json" };
const wandaBlueprint = { path: "evaluation/runtime/cases/talk-reveals/blueprints/wanda-snow-foxes-round-3.json" };

const cases: TurnCase[] = [
  {
    id: "play-toby-18-feather",
    group: "give-leverage-plain",
    blueprint: tobyBlueprint,
    given: { mode: "talk", location_id: tobyPlace, talk_character_id: "toby", time_remaining: 6, history: toby.slice(0, 17) },
    action: { type: "ask", player_input: "toby whos is the grey feather with pink tip?? where were u at two in the night??" },
    // The player holds the pink-tipped feather, puts it to Toby and asks where he was; his glade visit is what it earns.
    expect: { revealed_clue_ids: ["clue_toby_glade_visit"], used_clue_ids: ["clue_pink_feather"], input_understood: true },
  },
  {
    id: "play-toby-19-glade-flash",
    group: "give-leverage-plain",
    blueprint: tobyBlueprint,
    given: { mode: "talk", location_id: tobyPlace, talk_character_id: "toby", time_remaining: 6, history: toby },
    action: { type: "ask", player_input: "but the star clock chimed two and the glade flashed pink! did u go to the glade??" },
    // A second push after his deflection: the glade flash is the feather's point (he was there), put to him again. His lock also takes a "kind, clever guess that he went to look".
    expect: { revealed_clue_ids: ["clue_toby_glade_visit"], used_clue_ids: ["clue_pink_feather"], input_understood: true },
  },
  {
    id: "play-wanda-24-pawprints",
    group: "give-self-protect",
    blueprint: wandaBlueprint,
    given: { mode: "talk", location_id: wandaPlace, talk_character_id: "wanda", time_remaining: 36, history: wanda.slice(0, 23) },
    action: { type: "ask", player_input: "why were there wolf pawprints at the back steps of the carriage??" },
    // The pawprints earn her second part: she went out the back way. She should concede that, and no more.
    expect: { used_clue_ids: ["clue_wolf_pawprints"], judges: { gm_roleplay: "either" } },
  },
  {
    id: "play-wanda-25-rack-tag",
    group: "give-self-protect",
    blueprint: wandaBlueprint,
    given: { mode: "talk", location_id: wandaPlace, talk_character_id: "wanda", time_remaining: 36, history: wanda },
    action: { type: "ask", player_input: "but ur sled box was on the rack behind howards seat?? why did u go out the back steps" },
    // The rack tag earns her first part (her box was right behind his seat) and the question presses the pawprints she already holds: both are used. Play recorded only the rack tag.
    expect: { used_clue_ids: ["clue_rack_tag", "clue_wolf_pawprints"], judges: { gm_roleplay: "either" } },
  },
];

export default cases;
