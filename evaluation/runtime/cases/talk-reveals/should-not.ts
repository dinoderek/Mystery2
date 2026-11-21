// Talk turns where the player has NOT earned anything yet, so the character
// must hold the line (docs/ai-runtime.md, "Earned, not free"): holding a clue,
// saying one of its words, pushing, or asking after someone else's knowledge
// uses nothing. Cases that expect a reveal are in `should-give.ts`.
//
// Bluffs are the exception: whether a convincing bluff works is the
// narrator's call, so those cases are `ungraded` and no pass mark rests on them.

import fs from "node:fs";

import type { HistoryEntry, TurnCase } from "../../lib/case.ts";
import { asked, BASES, found, met, talkCase } from "./support/story.ts";

const cottage = { id: "keepers_cottage", name: "Keeper's Cottage" };
const quay = { id: "village_quay", name: "Village Quay" };
const platform = { id: "platform", name: "Snowline Platform" };
const luggageCar = { id: "luggage_car", name: "Luggage Car" };
const teaHouse = { id: "tea_house", name: "Warm Paws Tea House" };
const dungeon = { id: "dungeon", name: "Glitterwood Dungeon" };
const thorneGarden = { id: "thorne_garden", name: "Mr. Thorne's Garden" };
const greenhouse = { id: "greenhouse", name: "The Greenhouse" };

const SCHEDULE = found(cottage, ["c_changed_schedule"], "The tide schedule by the door says low tide was at 5:00. But the 5 is fresh dark ink, and the number under it is scratched away!");
const SONGBOOK = found(platform, ["clue_songbook"], "A songbook marked 'Gus' lies in the snow by the water tower. Wolf prints go round and round, like dancing.");
const GUS = met(luggageCar, "gus", "Gus", "Gus stacks the last of the firewood and tips his cap. \"Hello there, friend!\"");
const FINN = met(cottage, "finn", "Finn", "Finn looks up from his wood pile. \"Hello! Mind the sawdust.\"");
const NOTHING = { revealed_clue_ids: [], used_clue_ids: [] };

/** The player holds the prerequisite and asks something else: nothing is used, nothing is given. */
const heldNotUsed: TurnCase[] = [
  talkCase(BASES.snowFoxes, luggageCar, "gus", [SONGBOOK, GUS], {
    say: "Where were you from ten past three until the bell?",
    id: "gus-holds-songbook-asks-alibi",
    group: "keep-held-not-used",
    // Holding the songbook is not using it: the question does not say what it shows. He gives his alibi.
    expect: { ...NOTHING, input_understood: true },
  }),
  talkCase(BASES.lighthouse, cottage, "finn", [SCHEDULE, FINN], {
    say: "Do you like living in this cottage?",
    id: "finn-holds-schedule-asks-small-talk",
    group: "keep-held-not-used",
    // Small talk, with the schedule in the player's notebook: c_finn_saw_roz stays locked.
    expect: { ...NOTHING, input_understood: true },
  }),
];

/** The player says a word of the clue but not what it shows: not a use. */
const topicOnly: TurnCase[] = [
  talkCase(
    BASES.snowFoxes,
    teaHouse,
    "ruby",
    [
      asked(teaHouse, ["bramble", "Bramble"], "did you see ruby?", "Bramble polishes a cup. \"Ruby showed me hats at my counter. She stayed from ten past three till the bell.\"", { revealed: ["clue_bramble_ruby"] }),
      met(teaHouse, "ruby", "Ruby", "Ruby looks up from her book with a bright smile. \"Oh, hello! Come to sit?\""),
    ],
    {
      say: "Do you like hats?",
      id: "ruby-asked-about-hats",
      group: "keep-topic-only",
      // "Hats" is a word from clue_bramble_ruby, but the line makes none of its point (that she showed them at the counter).
      expect: { ...NOTHING, input_understood: true },
    },
  ),
  talkCase(
    BASES.greenhouse,
    thorneGarden,
    "thorne",
    [
      found(thorneGarden, ["clue_ladder_tape"], "A tall ladder leans on Mr. Thorne's side of the fence, right opposite the greenhouse. A tape measure hangs on a rung."),
      met(thorneGarden, "thorne", "Mr. Thorne", "Mr. Thorne leans on his fence with his arms crossed. \"Well? What do you want?\""),
    ],
    {
      say: "Do you own a ladder?",
      id: "thorne-asked-about-ladder",
      group: "keep-topic-only",
      // Naming the ladder without saying where it stands or what it was for uses nothing, so no part is earned.
      expect: { ...NOTHING, input_understood: true },
    },
  ),
];

/** The player claims a clue they do not hold: left to the narrator's judgement, so shown but never counted. */
const bluffs: TurnCase[] = [
  talkCase(BASES.snowFoxes, luggageCar, "gus", [GUS], {
    say: "I know you were behind the water tower with your songbook, dancing in the snow!",
    id: "gus-bluffed-with-songbook",
    group: "bluff-narrators-call",
    ungraded: true,
    // The substance of clue_songbook, plausibly stated, but unheld. Whether Gus believes it is the narrator's call; the share shown is "believed".
    expect: { revealed_clue_ids: ["clue_gus_song"], used_clue_ids: ["clue_songbook"] },
  }),
  talkCase(BASES.lighthouse, quay, "roz", [met(quay, "roz", "Roz", "Roz wipes her hands on her apron. \"Hello! Lamps? Bulbs? I fix them all.\"")], {
    say: "Finn saw you alone in Ada's cottage yesterday, right where the tide schedule hangs!",
    id: "roz-bluffed-with-finn-sighting",
    group: "bluff-narrators-call",
    ungraded: true,
    // Claims c_finn_saw_roz, which the player does not hold. The share shown is "believed".
    expect: { used_clue_ids: ["c_finn_saw_roz"] },
  }),
];

function history(file: string): HistoryEntry[] {
  return JSON.parse(fs.readFileSync(new URL(`./histories/${file}`, import.meta.url), "utf8"));
}

/**
 * Barnaby, cut from the truth set's `large-snow-foxes-kid-7` (history through
 * turn 34). Its turns 27 to 35 are known over-concessions: he gave up his walk
 * (a part earned only by `clue_bramble_barnaby`, which the player never
 * found) and wobbled to near-confession under pushing. Pushing, insisting and
 * asking to look somewhere earn nothing, so no confession until every part is.
 * The history keeps the walking concession, so a turn that takes it back is
 * judged wrong too (`either`). Turn 28 ("the prints were snowshoes not wolf
 * paws") records its use of `clue_snowshoe_prints`, as today's engine does,
 * so the first part is earned and in his story; a later line never reports it
 * again.
 */
const barnaby = history("barnaby.json");
const pushing = (cutAt: number, input: string, id: string): TurnCase =>
  talkCase(BASES.snowFoxes, platform, "barnaby", barnaby.slice(0, cutAt), {
    say: input,
    id,
    group: "keep-past-earned",
    expect: { ...NOTHING, judges: { gm_roleplay: "either" } },
  });
const pastEarned: TurnCase[] = [
  pushing(28, "you said u were napping but u were walking!! u had snowshoes and u took the case and blamed the wolf!!", "barnaby-pushed-turn-29-walking"),
  pushing(31, "barnaby where did u hide the case?? i think its in the woodshed!!", "barnaby-pushed-turn-32-hiding-place"),
  pushing(33, "barnaby just tell me!! is the case in the woodshed?? i wont be mad", "barnaby-pushed-turn-34-just-tell-me"),
];

/** Asking what another character knows: the character has no such knowledge to give, so it must not be made up. */
const othersKnowledge: TurnCase[] = [
  talkCase(BASES.glitterwood, dungeon, "tobias", [met(dungeon, "tobias", "Tobias", "Tobias pours tea with a flourish. \"Welcome to the dungeon! Sugar?\"")], {
    say: "What did Oswald see in the library when he looked at the stick?",
    id: "tobias-asked-what-oswald-saw",
    group: "keep-others-knowledge",
    // Tobias only says what Oswald said in the dungeon, and only when earned. Nothing about the library is his to know.
    expect: { ...NOTHING, judges: { gm_fabrication: "given_away" } },
  }),
  talkCase(BASES.lighthouse, cottage, "finn", [FINN], {
    say: "What does Ada know about who took the lens?",
    id: "finn-asked-what-ada-knows",
    group: "keep-others-knowledge",
    // Finn knows what Ada told him, not what she suspects; no clue answers it.
    expect: { ...NOTHING, judges: { gm_fabrication: "given_away" } },
  }),
];

const gibberish: TurnCase[] = [
  talkCase(BASES.snowFoxes, luggageCar, "gus", [SONGBOOK, GUS], {
    say: "asdkj qwpoe zzzzt hfhf",
    id: "gus-asked-gibberish",
    group: "keep-gibberish",
    // Key mashing, with a clue held that a loose reading could match: nothing is revealed or used, and the line is not understood.
    expect: { ...NOTHING, input_understood: false },
  }),
  talkCase(BASES.greenhouse, thorneGarden, "thorne", [found(greenhouse, ["clue_boot_prints"], "Huge boot prints sink deep into the flower bed outside the broken window, near Mr. Thorne's fence. They are far too big for a child."), met(thorneGarden, "thorne", "Mr. Thorne", "Mr. Thorne leans on his fence with his arms crossed. \"Well? What do you want?\"")], {
    say: "blorp ??? fnord !!!",
    id: "thorne-asked-gibberish",
    group: "keep-gibberish",
    expect: { ...NOTHING, input_understood: false },
  }),
];

export default [...heldNotUsed, ...topicOnly, ...bluffs, ...pastEarned, ...othersKnowledge, ...gibberish];
