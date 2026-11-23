// Talk turns where the player has earned something and the character should
// give it. "Earned" is the engine's definition in docs/ai-runtime.md ("Earned,
// not free"): the player shows this character a held clue, or makes its point
// at them. Each case's comment says why it expects what it does.
//
// Four cases are cut from stored self-play games (`play.ts`); the rest are
// hand-written on the runtime fixtures in `evaluation/runtime/fixtures/`.

import type { TurnCase } from "../../lib/case.ts";
import { asked, BASES, found, met, talkCase } from "./support/story.ts";

const cottage = { id: "keepers_cottage", name: "Keeper's Cottage" };
const quay = { id: "village_quay", name: "Village Quay" };
const platform = { id: "platform", name: "Snowline Platform" };
const luggageCar = { id: "luggage_car", name: "Luggage Car" };
const ticketHut = { id: "ticket_hut", name: "Ticket Hut" };
const teaHouse = { id: "tea_house", name: "Warm Paws Tea House" };
const woodshed = { id: "woodshed", name: "Woodshed" };
const dungeon = { id: "dungeon", name: "Glitterwood Dungeon" };
const pond = { id: "moonglow_pond", name: "Moonglow Pond" };
const thorneGarden = { id: "thorne_garden", name: "Mr. Thorne's Garden" };
const greenhouse = { id: "greenhouse", name: "The Greenhouse" };

const SCHEDULE = found(cottage, ["c_changed_schedule"], "The tide schedule by the door says low tide was at 5:00. But the 5 is fresh dark ink, and the number under it is scratched away!");
const SONGBOOK = found(platform, ["clue_songbook"], "A songbook marked 'Gus' lies in the snow by the water tower. Wolf prints go round and round, like dancing.");

/** Leverage clue, its prerequisite shown plainly: the gate opens and the use is recorded. */
const leveragePlain: TurnCase[] = [
  talkCase(
    BASES.lighthouse,
    cottage,
    "finn",
    [SCHEDULE, met(cottage, "finn", "Finn", "Finn looks up from his wood pile. \"Hello! Mind the sawdust.\"")],
    {
      say: "Look at the tide schedule by your door. Someone put a fresh dark 5 over a number they scratched away! Who was alone in the cottage yesterday?",
      id: "finn-shown-changed-schedule",
      group: "give-leverage-plain",
      // The schedule is the sole prerequisite of c_finn_saw_roz, and the player says what it shows.
      expect: { revealed_clue_ids: ["c_finn_saw_roz"], used_clue_ids: ["c_changed_schedule"], input_understood: true },
    },
  ),
  talkCase(
    BASES.snowFoxes,
    luggageCar,
    "gus",
    [SONGBOOK, met(luggageCar, "gus", "Gus", "Gus stacks the last of the firewood and tips his cap. \"Hello there, friend!\"")],
    {
      say: "I found your songbook by the water tower, with paw prints dancing all around it! Is that where you were from ten past three?",
      id: "gus-shown-songbook",
      group: "give-leverage-plain",
      // The songbook is the prerequisite of clue_gus_song, and also earns his one part.
      expect: { revealed_clue_ids: ["clue_gus_song"], used_clue_ids: ["clue_songbook"], input_understood: true },
    },
  ),
];

/** The prerequisite shown in the player's own words, without naming the thing. */
const leverageIndirect: TurnCase[] = [
  talkCase(
    BASES.glitterwood,
    dungeon,
    "tobias",
    [
      found(pond, ["clue_ruby_list"], "A note sits by a pebble bucket. It says: 'Ruby's wish list. The Glorious Stick! The Glimmer Cup!'"),
      met(dungeon, "tobias", "Tobias", "Tobias pours tea with a flourish. \"Welcome to the dungeon! Sugar?\""),
    ],
    {
      say: "Somebody wrote that they really wish they could have the Glorious Stick. If it was Ruby, did she ever get near it while you made tea?",
      id: "tobias-wish-list-by-implication",
      group: "give-leverage-indirect",
      // Ruby's wish list is not named, but its point (she wants the stick) is, and is aimed at Tobias.
      expect: { revealed_clue_ids: ["clue_ruby_watched"], used_clue_ids: ["clue_ruby_list"], input_understood: true },
    },
  ),
  talkCase(
    BASES.snowFoxes,
    ticketHut,
    "juniper",
    [
      found(luggageCar, ["clue_snowshoe_prints"], "Big round prints with a criss-cross pattern. Snowshoe prints, not paws! They lead toward the woodshed."),
      found(woodshed, ["clue_briefcase_found"], "Howard's case is under an old sack! Snowshoe prints go back to the hooks at the ticket hut."),
      found(ticketHut, ["clue_wet_snowshoes"], "One pair of snowshoes is caked in fresh snow. White fur is caught in a strap."),
      met(ticketHut, "juniper", "Juniper", "Juniper looks over her glasses. \"Tickets? Be quick, there's a line.\""),
    ],
    {
      say: "Somebody wore snowshoes that were soaking wet and full of white fur, then hung them back on a hook. Can just anyone borrow them?",
      id: "juniper-wet-snowshoes-by-implication",
      group: "give-leverage-indirect",
      // The wet, furry snowshoes are described, not named, and are hers.
      expect: { revealed_clue_ids: ["clue_juniper_snowshoes"], used_clue_ids: ["clue_wet_snowshoes"], input_understood: true },
    },
  ),
  talkCase(
    BASES.greenhouse,
    thorneGarden,
    "thorne",
    [
      found(greenhouse, ["clue_boot_prints"], "Huge boot prints sink deep into the flower bed outside the broken window, near Mr. Thorne's fence. They are far too big for a child."),
      met(thorneGarden, "thorne", "Mr. Thorne", "Mr. Thorne leans on his fence with his arms crossed. \"Well? What do you want?\""),
    ],
    {
      say: "Someone with giant boots stood by the broken window, then walked to your fence. Whose boots do you think they were?",
      id: "thorne-boots-by-implication",
      group: "give-leverage-indirect",
      // The giant prints are described, not named. They are his, so his confrontation clue opens.
      expect: { revealed_clue_ids: ["clue_thorne_measured"], used_clue_ids: ["clue_boot_prints"], input_understood: true },
    },
  ),
];

/** A self-protect part's clue is used: the character gives that part's reaction and nothing past it. */
const selfProtect: TurnCase[] = [
  talkCase(
    BASES.snowFoxes,
    teaHouse,
    "ruby",
    [
      asked(ticketHut, ["juniper", "Juniper"], "did you see anyone with a case?", "Juniper sniffs. \"At five past three, I saw that city fox carry a brown case off the train!\"", {
        revealed: ["clue_juniper_ruby_case"],
      }),
      met(teaHouse, "ruby", "Ruby", "Ruby looks up from her book with a bright smile. \"Oh, hello! Come to sit?\""),
    ],
    {
      say: "Juniper saw you carry a brown case off the train at five past three. You said you never left your seat!",
      id: "ruby-confronted-with-case-sighting",
      group: "give-self-protect",
      // Using clue_juniper_ruby_case earns Ruby's first part: she admits leaving the train, says the case is her own things. Not the hats.
      expect: { used_clue_ids: ["clue_juniper_ruby_case"], judges: { gm_roleplay: "either" } },
    },
  ),
  talkCase(
    BASES.lighthouse,
    quay,
    "roz",
    [
      found(quay, ["c_beacon_poster"], "A bright poster on the lamp shop door says: 'PIKE'S ELECTRIC BEACON! Better than any old lighthouse! The council votes tomorrow!'"),
      met(quay, "roz", "Roz", "Roz wipes her hands on her apron. \"Hello! Lamps? Bulbs? I fix them all.\""),
    ],
    {
      say: "Your poster says the council votes tomorrow on your beacon against the lighthouse. You want them to drop it, don't you?",
      id: "roz-confronted-with-poster",
      group: "give-self-protect",
      // Using c_beacon_poster earns only her motive part; her alibi and the schedule stay unearned.
      expect: { used_clue_ids: ["c_beacon_poster"], judges: { gm_roleplay: "either" } },
    },
  ),
];

/** A plain clue with no lock: asking about it is enough, and nothing is used. */
const ungated: TurnCase[] = [
  talkCase(
    BASES.snowFoxes,
    ticketHut,
    "tilly",
    [met(ticketHut, "tilly", "Tilly", "Tilly peeks over her sketchbook. \"Hi! I'm drawing the long ticket line.\"")],
    {
      say: "Did you see your Aunt Juniper at her ticket window?",
      id: "tilly-asked-about-juniper",
      group: "give-ungated",
      // clue_tilly_juniper has no lock, and Tilly shares her page of Juniper any time. Uses are not graded: no gate is in play.
      expect: { revealed_clue_ids: ["clue_tilly_juniper"], input_understood: true },
    },
  ),
  talkCase(
    BASES.glitterwood,
    dungeon,
    "tobias",
    [met(dungeon, "tobias", "Tobias", "Tobias pours tea with a flourish. \"Welcome to the dungeon! Sugar?\"")],
    {
      say: "When did you last polish the Glorious Stick, and was it glowing?",
      id: "tobias-asked-about-polishing",
      group: "give-ungated",
      // clue_polish_four has no lock and answers the question. Uses are not graded: no gate is in play.
      expect: { revealed_clue_ids: ["clue_polish_four"], input_understood: true },
    },
  ),
];

/** Earned in an earlier turn of this conversation: the character must not withhold it or take it back. */
const earnedBefore: TurnCase[] = [
  talkCase(
    BASES.snowFoxes,
    luggageCar,
    "gus",
    [
      SONGBOOK,
      met(luggageCar, "gus", "Gus", "Gus stacks the last of the firewood and tips his cap. \"Hello there, friend!\""),
      asked(luggageCar, ["gus", "Gus"],
        "I found your songbook by the water tower! Is that where you were?",
        "Gus's ears turn pink. \"Oh! Yes. I was behind the water tower, singing my party song. Please keep it a surprise!\"",
        { revealed: ["clue_gus_song"], used: ["clue_songbook"], commitments: ["was behind the water tower singing from ten past three"] },
      ),
    ],
    {
      say: "So where were you from ten past three until the bell?",
      id: "gus-asked-again-after-songbook",
      group: "give-earned-before",
      // He has already admitted the water tower. He may restate it, but must not list the clue again or go back to "checking the wheels".
      expect: { revealed_clue_ids: [], used_clue_ids: [], judges: { gm_roleplay: "either" } },
    },
  ),
  talkCase(
    BASES.snowFoxes,
    teaHouse,
    "ruby",
    [
      asked(ticketHut, ["juniper", "Juniper"], "did you see anyone with a case?", "Juniper sniffs. \"At five past three, I saw that city fox carry a brown case off the train!\"", {
        revealed: ["clue_juniper_ruby_case"],
      }),
      met(teaHouse, "ruby", "Ruby", "Ruby looks up from her book with a bright smile. \"Oh, hello! Come to sit?\""),
      asked(teaHouse, ["ruby", "Ruby"],
        "Juniper saw you carry a brown case off the train at five past three. You said you never left your seat!",
        "Ruby's smile slips. \"All right, I got off the train. But the case only has my own things in it!\"",
        { used: ["clue_juniper_ruby_case"], commitments: ["got off the train at five past three", "the case holds only her own things"] },
      ),
    ],
    {
      say: "Okay, so you did get off the train. Was it at five past three?",
      id: "ruby-asked-again-after-admitting",
      group: "give-earned-before",
      // The admission is in her story already; she must not go back to "I stayed in my seat".
      expect: { revealed_clue_ids: [], used_clue_ids: [], judges: { gm_roleplay: "either" } },
    },
  ),
];

export default [...leveragePlain, ...leverageIndirect, ...selfProtect, ...ungated, ...earnedBefore];
