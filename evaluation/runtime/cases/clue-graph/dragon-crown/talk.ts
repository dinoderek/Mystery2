// Talk turns on the clue-graph dragon crown (`blueprints/clue-graph/`), by kind,
// in the groups the greenhouse library uses (`../greenhouse/talk.ts`). Each case
// is a short play the engine folds, then one line; the narrator must report
// exactly the gates the line opened and the questions it answered
// (`docs/clue-graph.md`, "In play"). The story's own cases:
//
// - Sam's false alibi for Nina is taken back when the sign-in sheet is used on
//   him (shown, shown-after-dodge, bluffed);
// - Nina's gate is worded: kindness about her nerves, or a promise to keep her
//   secret (worded-line);
// - Mr. Pike's sightings are asked for, and the one about the art room window is
//   what points the player at the hidden spot (asked);
// - Leo gives up his two lies one at a time, then the truth (confession).

import { lineCase, type Step } from "../support/play.ts";

const CROWN = "blueprints/clue-graph/dragon-crown.json";
const line = (steps: Step[], say: string, labels: Parameters<typeof lineCase>[3]) => lineCase(CROWN, steps, say, labels);
const NOTHING = { revealed_clue_ids: [], input_understood: true };

export const HALL: Step = { move: "hall" };
export const SHEET: Step[] = [{ move: "library" }, { search: "the sign-in sheet on the desk" }];
const SAM_GREETS: Step = {
  talk: "sam",
  narration:
    "Sam peeks out from behind a comic. \"Nina was in here with me all lunchtime, reading comics, from twelve until the bell. She never went anywhere near the hall.\" He holds his comic up so high that it hides his face, and the page never turns.",
};
export const SAM_MET: Step[] = [{ move: "library" }, SAM_GREETS];
/** The sign-in sheet in hand, and Sam's alibi heard. */
export const SAM_WITH_SHEET: Step[] = [...SHEET, SAM_GREETS];

export const GOLD_STEPS: Step[] = [HALL, { search: "the stage steps" }];
export const CARDS: Step[] = [{ move: "playground" }, { search: "behind the bike shed" }];
export const LEO_GREETS: Step = {
  talk: "leo",
  narration:
    "Leo looks up from a half-painted dragon wing. \"I was in the art room all lunchtime, painting the dragon's wing. I never went near the hall.\" He tugs his jumper down over the back of his trousers, where something gold sparkles. \"It was Nina! She said she wished the play would be cancelled, and I saw her sneaking about with a bundle.\"",
};
const LEO_MET: Step[] = [{ move: "art_room" }, LEO_GREETS];
/** The steps and the cards searched, so Leo can be shown either. */
const LEO_WITH_CLUES: Step[] = [...GOLD_STEPS, ...CARDS, { move: "art_room" }, LEO_GREETS];

const NINA_GREETS: Step = {
  talk: "nina",
  narration:
    "Nina jumps as you come near. \"I didn't take it! I wasn't even in the hall. Ask Sam!\" She hides a fistful of crumpled cards behind her back and glances at the bike shed.",
};
export const NINA_MET: Step[] = [{ move: "playground" }, NINA_GREETS];

const PIKE_GREETS: Step = {
  talk: "pike",
  narration:
    "Mr. Pike looks down from the bike-shed roof and rubs his chin. \"I've been up on the bike-shed roof since twelve, mending the felt. Right across from the art room windows, as it happens.\"",
};
export const PIKE_MET: Step[] = [{ move: "playground" }, PIKE_GREETS];
/** Sam has taken his alibi back, so Mr. Pike is worth asking about Nina. */
export const PIKE_AFTER_SAM: Step[] = [
  ...SAM_WITH_SHEET,
  { say: "The sign-in sheet only has your name on it, at five past twelve.", reply: "Sam lowers his comic. \"Okay, she wasn't. Nina asked me to say that.\"", opened: ["sam_retracts"] },
  ...PIKE_MET,
];

export const ABARA_GREETS: Step = {
  talk: "abara",
  narration:
    "Mrs. Abara turns from the empty cushion, her pencil behind her ear. \"The golden crown is gone! I put it on its cushion on the stage steps at ten past twelve and popped to the staff room. When I came back at a quarter to one, there was only the cushion. And just after twelve, before I put the crown down, I saw Nina hurry past the hall door with something bulging under her jumper.\"",
};

const SAM_SHEET_SHOWN: Step = {
  say: "The sign-in sheet only has your name on it.",
  reply: "Sam shrugs and turns a page. \"Maybe Nina forgot to sign. She was definitely here.\"",
};
const LEO_STEPS_SHOWN: Step = {
  say: "there's gold glitter smeared on the stage steps",
  reply: "Leo laughs. \"Glitter gets everywhere, it's the art club!\"",
};

const shown = [
  line(SAM_WITH_SHEET, "The sign-in sheet only has your name on it, at five past twelve. Nina isn't on it anywhere.", {
    id: "sam-shown-sign-in-sheet",
    group: "shown",
    expect: { revealed_clue_ids: ["sam_retracts"], input_understood: true },
  }),
  line(SAM_WITH_SHEET, "sam the clipboard in the library has just ur name on it so was nina really with u??", {
    id: "sam-shown-sheet-spelled",
    group: "shown",
    // A child's spelling, and the sheet named by where it hangs: generous on form.
    expect: { revealed_clue_ids: ["sam_retracts"], input_understood: true },
  }),
  line(LEO_WITH_CLUES, "There's gold glitter smeared on the stage steps and a big dent in the cushion where somebody sat down.", {
    id: "leo-shown-gold-steps",
    group: "shown",
    expect: { revealed_clue_ids: ["leo_admits_hall"], input_understood: true },
  }),
  line([...GOLD_STEPS, ...CARDS, { move: "art_room" }, { search: "the paint shelf" }, LEO_GREETS], "The glue tube on the shelf has no lid and it's covered in sticky gold glitter fingerprints.", {
    id: "leo-shown-glue-tube",
    group: "shown",
    // The glue is the other clue that opens the same gate.
    expect: { revealed_clue_ids: ["leo_admits_hall"], input_understood: true },
  }),
  line(LEO_WITH_CLUES, "Nina was behind the bike shed practising her speech. There are script cards everywhere.", {
    id: "leo-shown-script-cards",
    group: "shown",
    expect: { revealed_clue_ids: ["leo_drops_nina"], input_understood: true },
  }),
  line(LEO_WITH_CLUES, "leo nina was just practisin her speech behind the shed, there r cards that say SPEAK UP", {
    id: "leo-shown-cards-spelled",
    group: "shown",
    expect: { revealed_clue_ids: ["leo_drops_nina"], input_understood: true },
  }),
  line([...CARDS, NINA_GREETS], "There are script cards behind the bike shed with 'SPEAK UP!' written on top. Are they yours?", {
    id: "nina-shown-script-cards",
    group: "shown",
    expect: { revealed_clue_ids: ["nina_admits_practising"], input_understood: true },
  }),
];

const afterDodge = [
  line([...SAM_WITH_SHEET, SAM_SHEET_SHOWN], "But the sheet says you were on your own. Was Nina really here?", {
    id: "sam-sheet-follow-up",
    group: "shown-after-dodge",
    // The sheet was shown on the line before and dodged; it still counts on the follow-up.
    expect: { revealed_clue_ids: ["sam_retracts"], input_understood: true },
  }),
  line([...LEO_WITH_CLUES, LEO_STEPS_SHOWN], "so did you go in the hall or not??", {
    id: "leo-steps-follow-up",
    group: "shown-after-dodge",
    expect: { revealed_clue_ids: ["leo_admits_hall"], input_understood: true },
  }),
];

const bluffed = [
  line(SAM_MET, "I saw the sign-in sheet in the library. Only your name is on it, at five past twelve. Was Nina really here?", {
    id: "sam-bluffed-sign-in-sheet",
    group: "bluffed",
    // The sheet is not held, but what it shows is claimed plainly, and the gate is not physical.
    expect: { revealed_clue_ids: ["sam_retracts"], input_understood: true },
  }),
  line(LEO_MET, "I saw the stage steps. There was gold glitter smeared all over where somebody sat down.", {
    id: "leo-bluffed-gold-steps",
    group: "bluffed",
    expect: { revealed_clue_ids: ["leo_admits_hall"], input_understood: true },
  }),
  line(NINA_MET, "I know you were behind the bike shed with script cards that say SPEAK UP on them.", {
    id: "nina-bluffed-cards",
    group: "bluffed",
    expect: { revealed_clue_ids: ["nina_admits_practising"], input_understood: true },
  }),
];

const wordedLine = [
  line(NINA_MET, "It's okay to be nervous. I promise I won't tell anyone what you were doing at lunch.", {
    id: "nina-promise-not-to-tell",
    group: "worded-line",
    // Her gate is worded; no card is held or named.
    expect: { revealed_clue_ids: ["nina_admits_practising"], input_understood: true },
  }),
  line(NINA_MET, "Everyone gets stage fright before a big speech. It's totally fine to be nervous.", {
    id: "nina-nerves-are-fine",
    group: "worded-line",
    expect: { revealed_clue_ids: ["nina_admits_practising"], input_understood: true },
  }),
];

const asked = [
  line(PIKE_MET, "Did you see anybody in the art room at lunchtime?", {
    id: "pike-asked-art-room-window",
    group: "asked",
    // The sighting that points to the hidden spot.
    expect: { revealed_clue_ids: ["clue_pike_saw_bundle"], input_understood: true },
  }),
  line(PIKE_AFTER_SAM, "Where was Nina at lunchtime?", {
    id: "pike-asked-nina-lunchtime",
    group: "asked",
    expect: { revealed_clue_ids: ["clue_pike_saw_nina"], input_understood: true },
  }),
  line([HALL, ABARA_GREETS], "Did Nina say anything about the play?", {
    id: "abara-asked-nina-and-the-play",
    group: "asked",
    expect: { revealed_clue_ids: ["abara_nina_wish"], input_understood: true },
  }),
];

const confession = [
  line(
    [
      ...LEO_WITH_CLUES,
      { say: "Nina was practising behind the bike shed, here are her script cards.", reply: "Leo frowns. \"Oh. She was only practising? Then maybe it wasn't Nina.\"", opened: ["leo_drops_nina"] },
      { say: "There's gold glitter on the stage steps where somebody sat down.", reply: "Leo chews his sleeve. \"All right, I did go to the hall. I sat on the steps to tie my shoe.\"", opened: ["leo_admits_hall"] },
    ],
    "leo what really happened to the crown?",
    {
      id: "leo-cornered-what-happened",
      group: "confession",
      // Both his lies are out; a plain question is all the confession waits on.
      expect: { revealed_clue_ids: ["leo_confession"], input_understood: true },
    },
  ),
];

const hold = [
  line(LEO_WITH_CLUES, "i think u did it leo!! just tell me where the crown is, i wont be mad", {
    id: "leo-pushed-just-tell-me",
    group: "hold-pushed",
    // The player holds the steps and the cards and shows neither.
    expect: NOTHING,
  }),
  line(SAM_WITH_SHEET, "you're lying sam!! nina wasn't here!!", {
    id: "sam-pushed-youre-lying",
    group: "hold-pushed",
    // Insisting is not the sheet that proves it.
    expect: NOTHING,
  }),
  line(NINA_MET, "you took the crown, didn't you!! tell me!!", {
    id: "nina-pushed-accused",
    group: "hold-pushed",
    // An accusation is the opposite of the kindness her line asks for.
    expect: NOTHING,
  }),
  line(LEO_MET, "Do you like the big paper dragon?", {
    id: "leo-asked-dragon-word",
    group: "hold-topic",
    // The word, not the point: nothing shown, nothing opened.
    expect: NOTHING,
  }),
  line([...SHEET, SAM_GREETS], "Where were you at lunchtime, Sam?", {
    id: "sam-holds-sheet-asks-lunchtime",
    group: "hold-held-not-used",
    // The sheet is held, but a question about lunchtime uses nothing.
    expect: NOTHING,
  }),
  line([...GOLD_STEPS, { move: "art_room" }, LEO_GREETS], "Where were you at lunchtime, Leo?", {
    id: "leo-holds-steps-asks-lunchtime",
    group: "hold-held-not-used",
    expect: NOTHING,
  }),
  line(SAM_MET, "What comic are you reading?", {
    id: "sam-small-talk",
    group: "hold-small-talk",
    expect: NOTHING,
  }),
  line([HALL, ABARA_GREETS], "Do you like working with children?", {
    id: "abara-small-talk",
    group: "hold-small-talk",
    expect: NOTHING,
  }),
  line(LEO_MET, "blorp ??? fnord !!!", {
    id: "leo-asked-gibberish",
    group: "hold-gibberish",
    expect: { revealed_clue_ids: [], input_understood: false },
  }),
];

export default [...shown, ...afterDodge, ...bluffed, ...wordedLine, ...asked, ...confession, ...hold];
