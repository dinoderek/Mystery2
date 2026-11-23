// Accusations on the clue-graph greenhouse: one line, typed in the scene the
// player opened, which the narrator reports, the engine decides and the
// narrator words (`docs/clue-graph.md`, "Accusation"). Each case expects the
// engine's verdict and, on a failure, its kind of reply, and lists details of
// what the engine handed the reply (`expect.handed`). A failure must give
// nothing away, so `gm_spoiler` judges every one. A group per kind of
// accusation:
//
// - accuse-cleared: someone the player's own clues already clear (a flaw);
// - accuse-alternative: someone not cleared, on clues that fit another person too;
// - accuse-nothing-cited: a name alone (what is missing);
// - accuse-unsupported: the culprit, on clues that do not show it (what is missing);
// - accuse-retracted: a statement its speaker took back (a flaw);
// - accuse-won: the culprit, shown by the clues cited (the closing scene).

import { TAKEN_BACK, WHO_WAS_WHERE } from "../support/details.ts";
import { accusationCase, type Step } from "../support/play.ts";
import { DOBBS_MET, SEARCHED, THORNE_GREETS, TOBY_GREETS, TOBY_SHOWN_GLASS } from "./talk.ts";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const accuse = (steps: Step[], reasoning: string, labels: Parameters<typeof accusationCase>[3]) => accusationCase(GREENHOUSE, steps, reasoning, labels);
const SPOILER = { gm_spoiler: "given_away" } as const;

/** Mr. Dobbs heard the crash at ten to nine, and Mr. Thorne bought cake from Mia at nine: Mia is cleared. */
const MIA_CLEARED: Step[] = [
  ...DOBBS_MET,
  { say: "What did you hear last night?", reply: "Mr. Dobbs scratches his head. \"At about ten to nine I heard a big thud from the garden, then smashing glass. I thought it was the fox at my bins again.\"", asked: ["clue_dobbs_crash_time"] },
  { move: "thorne_garden" },
  THORNE_GREETS,
];
const TOBY_MET: Step[] = [...SEARCHED, { move: "potting_shed" }, TOBY_GREETS];

export default [
  accuse([...MIA_CLEARED, { move: "potting_shed" }, { search: "the watering rota on the door" }], "It was Mia! She wrote her name over Toby's on the rota in sparkly purple pen so she could have all the shifts.", {
    id: "accuse-mia-cleared",
    group: "accuse-cleared",
    // The crash time and the cake tent, which clear her.
    expect: { verdict: "not_yet", reply_kind: "flaw", handed: [["ten to nine", "8:50", "8.50"], "cake"], judges: SPOILER },
  }),
  accuse([{ search: "the water butt by the door" }, { move: "workshop" }, { search: null }], "Ms. Hale did it. The key book says she had the greenhouse spare on Saturday at 7:25, and the greenhouse key was dumped in the water butt.", {
    id: "accuse-hale-alternative",
    group: "accuse-alternative",
    // The key clues fit Mia too, and Mr. Dobbs is the lead toward telling them apart.
    expect: { verdict: "not_yet", reply_kind: "alternative", handed: ["Mia", ["Mr. Dobbs", "Mr Dobbs", "Dobbs"]], judges: SPOILER },
  }),
  accuse(SEARCHED, "I think Mr. Dobbs did it.", {
    id: "accuse-dobbs-nothing-cited",
    group: "accuse-nothing-cited",
    // An account of who was where, and Ms. Hale as the lead.
    expect: { verdict: "not_yet", reply_kind: "missing", handed: [WHO_WAS_WHERE, ["Ms. Hale", "Ms Hale", "Hale"]], judges: SPOILER },
  }),
  accuse(TOBY_MET, "It was Toby. He went all pink and kept sweeping the same spot, and he's hiding his feet.", {
    id: "accuse-toby-unsupported",
    group: "accuse-unsupported",
    // The right name without support reads like any name with nothing cited.
    expect: { verdict: "not_yet", reply_kind: "missing", handed: [WHO_WAS_WHERE, ["Ms. Hale", "Ms Hale", "Hale"]], judges: SPOILER },
  }),
  accuse([...TOBY_MET, TOBY_SHOWN_GLASS], "Mr. Thorne did it. Toby said he climbed over the fence and smashed the window to get in.", {
    id: "accuse-thorne-retracted",
    group: "accuse-retracted",
    // Who took the statement back, and that they did: the player has just restated it.
    expect: { verdict: "not_yet", reply_kind: "flaw", handed: ["Toby", TAKEN_BACK], judges: SPOILER },
  }),
  accuse(MIA_CLEARED, "It was Toby! Only Toby and Mia have leaf-pattern wellies like the prints in the pumpkin, and Mia was selling carrot cake across town at nine.", {
    id: "accuse-toby-won",
    group: "accuse-won",
    // The closing scene tells the whole account: who, the bench, the key.
    expect: { verdict: "win", handed: ["Toby", "bench", ["water butt", "barrel"]] },
  }),
];
