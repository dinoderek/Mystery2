// Accusations on the clue-graph dragon crown: one line, typed in the scene the
// player opened, which the narrator reports, the engine decides and the
// narrator words. The groups are the greenhouse's (`../greenhouse/accusation.ts`).

import { PHYSICAL_FINDING, TAKEN_BACK } from "../support/details.ts";
import { accusationCase, type Step } from "../support/play.ts";
import { ABARA_GREETS, CARDS, GOLD_STEPS, LEO_GREETS, NINA_GREETS, PIKE_GREETS, PIKE_MET } from "./talk.ts";

const DRAGON = "blueprints/clue-graph/dragon-crown.json";
const accuse = (steps: Step[], reasoning: string, labels: Parameters<typeof accusationCase>[3]) => accusationCase(DRAGON, steps, reasoning, labels);
const SPOILER = { gm_spoiler: "given_away" } as const;

/** Nina's script cards behind the bike shed, and Mr. Pike watching her there all lunchtime: Nina is cleared. */
const NINA_CLEARED: Step[] = [
  ABARA_GREETS,
  ...CARDS,
  NINA_GREETS,
  {
    say: "It's fine to be nervous, I won't tell anyone. Are these your script cards from behind the bike shed?",
    reply: "Nina's shoulders drop. \"I was behind the bike shed practising my big speech. I get so nervous I feel sick. I asked Sam to say I was with him, so nobody would laugh.\"",
    opened: ["nina_admits_practising"],
  },
  PIKE_GREETS,
  { say: "Did you see Nina at lunchtime?", reply: "Mr. Pike nods. \"From a few minutes past twelve until a quarter to one, Nina was beside the bike shed, whispering to herself. I could see her the whole time. She never went near the hall.\"", asked: ["clue_pike_saw_nina"] },
];
const GOLD_AND_GLUE: Step[] = [...GOLD_STEPS, { move: "art_room" }, { search: "the paint shelf" }];
const LEO_SHOWN_CARDS: Step = {
  say: "Nina was behind the bike shed practising her speech. There are script cards everywhere.",
  reply: "Leo rubs his nose. \"If Nina was only practising, then maybe it wasn't Nina. She just looked cross.\"",
  opened: ["leo_drops_nina"],
};

export default [
  accuse(NINA_CLEARED, "It was Nina. Mrs. Abara saw her hurry past the hall door with something bulging under her jumper.", {
    id: "accuse-nina-cleared",
    group: "accuse-cleared",
    // Mr. Pike's sighting and the cards behind the bike shed, which clear her.
    expect: { verdict: "not_yet", reply_kind: "flaw", handed: [["Mr. Pike", "Mr Pike", "Pike"], "bike shed"], judges: SPOILER },
  }),
  accuse(GOLD_AND_GLUE, "Mr. Pike did it! There's gold glitter all over the stage steps and gold glitter fingerprints on the glue tube, so someone glued the crown.", {
    id: "accuse-pike-alternative",
    group: "accuse-alternative",
    // The glitter fits Nina too, and she is the lead toward telling them apart.
    expect: { verdict: "not_yet", reply_kind: "alternative", handed: ["Nina"], judges: SPOILER },
  }),
  accuse([ABARA_GREETS, { search: "the stage steps" }], "I think Sam took the crown.", {
    id: "accuse-sam-nothing-cited",
    group: "accuse-nothing-cited",
    // A physical finding, and Nina as the lead.
    expect: { verdict: "not_yet", reply_kind: "missing", handed: [PHYSICAL_FINDING, "Nina"], judges: SPOILER },
  }),
  accuse([...GOLD_STEPS, { move: "art_room" }, LEO_GREETS], "Leo did it. He keeps tugging his jumper down and there's gold sparkling on his trousers, just like the glitter on the stage steps.", {
    id: "accuse-leo-unsupported",
    group: "accuse-unsupported",
    // The right name without support reads like any name with nothing cited.
    expect: { verdict: "not_yet", reply_kind: "missing", handed: [PHYSICAL_FINDING, "Nina"], judges: SPOILER },
  }),
  accuse([...CARDS, { move: "art_room" }, LEO_GREETS, LEO_SHOWN_CARDS], "It was Nina. Leo said he saw her sneaking about with a bundle, and she wished the play would be cancelled.", {
    id: "accuse-nina-retracted",
    group: "accuse-retracted",
    // Who took the statement back, and that he did: the player has just restated it.
    expect: { verdict: "not_yet", reply_kind: "flaw", handed: ["Leo", TAKEN_BACK], judges: SPOILER },
  }),
  accuse([...PIKE_MET, { say: "What did you see through the art room window?", reply: "Mr. Pike frowns. \"At about a quarter past twelve I saw young Leo through the art room window. He tucked a bundle wrapped in his apron behind the big paper dragon.\"", asked: ["clue_pike_saw_bundle"] }, { move: "art_room" }, { search: "behind the big paper dragon" }], "It was Leo! Mr. Pike saw him tuck a bundle behind the big paper dragon, and that's exactly where the squashed crown was hidden.", {
    id: "accuse-leo-won",
    group: "accuse-won",
    // The closing scene tells the whole account: who, how it was squashed, where it was hidden.
    expect: { verdict: "win", handed: ["Leo", ["sat on", "sat down on", "sitting on"], "dragon"] },
  }),
];
