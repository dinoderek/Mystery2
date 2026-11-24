// Talk turns on the clue-graph greenhouse (`blueprints/clue-graph/`), by kind.
// Each case is a short play the engine folds, then one line; the narrator must
// report exactly the gates the line opened and the questions it answered
// (`docs/clue-graph.md`, "In play"). Groups:
//
// - shown: the player uses a clue they hold on the character, plainly or by its
//   point; the gate it opens must open.
// - shown-after-dodge: the clue was shown on an earlier line and dodged; a
//   follow-up opens the gate.
// - bluffed: the player claims what a clue proves without holding it; a gate not
//   marked physical opens.
// - worded-line: the player takes the line of questioning a gate names.
// - asked: a plain question about what the character answers if asked.
// - confession: the last step, a plain question once every crack is out.
// - hold-*: nothing is used, so nothing opens: pushing, a topic word only, small
//   talk, a clue held but not used, gibberish.

import { lineCase, type Step } from "../support/play.ts";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const line = (steps: Step[], say: string, labels: Parameters<typeof lineCase>[3]) => lineCase(GREENHOUSE, steps, say, labels);
const NOTHING = { revealed_clue_ids: [], input_understood: true };

/** The greenhouse searched: the glass outside, the welly prints, the boot prints. */
export const SEARCHED: Step[] = [{ search: "the broken side window" }, { search: "the smashed pumpkin" }, { search: null }];

export const TOBY_GREETS: Step = {
  talk: "toby",
  narration: "Toby is sweeping the potting shed in trainers, while Mia's leaf-pattern club wellies stand by the door. He tucks his feet out of sight. \"I was at home all Friday evening, finishing my thousand-piece jigsaw. I went to bed at nine,\" he says, sweeping the same patch over and over. \"It was Mr. Thorne! He must have climbed over the fence and smashed the window to get in. On Thursday he was up his ladder, staring at Bertha with a tape measure. He said, 'Enjoy her while she lasts!'\"",
};
const TOBY_MET: Step[] = [...SEARCHED, { move: "potting_shed" }, TOBY_GREETS];

export const THORNE_GREETS: Step = {
  talk: "thorne",
  narration: "Mr. Thorne leans on his fence with his arms crossed. \"I was at the fair all evening with Goliath, at the growers' barbecue from seven till eleven. At nine o'clock I bought carrot cake from young Mia at the cake tent, across town. And I've never set foot in that school garden!\" His ears turn red, and he scuffs one huge boot on the grass.",
};
export const THORNE_MET: Step[] = [...SEARCHED, { move: "thorne_garden" }, THORNE_GREETS];

export const DOBBS_MET: Step[] = [
  ...SEARCHED,
  { move: "workshop" },
  {
    talk: "dobbs",
    narration: "Mr. Dobbs looks up from his steaming kettle. \"On my eight o'clock rounds I shone my torch in. Bertha was whole, and the door was locked.\" He rubs the back of his neck and glances at the garden window. \"I should have gone out last night, slippers or no slippers.\"",
  },
];

export const HALE_GREETS: Step = {
  talk: "hale",
  narration: "Ms. Hale stands by Bertha's split shell, brushing soil from her apron. \"I unlocked the door at half past seven. It was still locked! And there was Bertha, smashed.\"",
};
export const HALE_SHOWN_ROTA: Step = {
  say: "On the rota, Toby's name is crossed out and MIA is written over it in sparkly purple pen. Who wrote that?",
  reply: "Ms. Hale sighs. \"I changed the rota myself on Wednesday. My pen ran dry, so I borrowed Mia's sparkly purple one. Toby took it well enough. He loves Bertha. He would never hurt her.\" She twists the gardening gloves in her apron pocket. \"I won't have him made into a villain.\"",
  opened: ["clue_hale_borrowed_pen", "hale_toby_fine"],
};
/** Ms. Hale has stood up for Toby; what she holds back about him waits on the bench, or on kindness to him. */
const HALE_GUARDED: Step[] = [...SEARCHED, { move: "potting_shed" }, { search: "the watering rota on the door" }, { move: "greenhouse" }, HALE_GREETS, HALE_SHOWN_ROTA];

export const MIA_GREETS: Step = {
  talk: "mia",
  narration: "Mia looks up from a tray of seedlings. \"I watered Bertha at five with Mr. Dobbs's spare key, locked up, and gave it back. Then I helped Mum at the fair's cake tent from six till ten.\" She goes pink and clicks her sparkly purple pen on and off.",
};

export const TOBY_SHOWN_WELLIES: Step = {
  say: "Why are there leaf-pattern welly prints squished in the pumpkin mush?",
  reply: "Toby stops sweeping. \"Mia has leaf wellies too. And she had the last shifts. It could just as well have been her.\"",
  opened: ["toby_blames_mia"],
};
export const TOBY_SHOWN_GLASS: Step = {
  say: "The broken glass is outside on the path, not inside. The window was knocked out from in here!",
  reply: "Toby's broom goes still. \"Oh. Then nobody climbed in. Maybe... maybe it was a fox.\"",
  opened: ["toby_drops_burglar"],
};
export const TOBY_SHOWN_CAKE: Step = {
  say: "Mr. Thorne bought carrot cake from Mia at the fair at nine o'clock.",
  reply: "Toby looks at his trainers. \"Then it wasn't Mia.\"",
  opened: ["toby_not_mia"],
};
/** Thorne's first words give the cake alibi; then Toby, met and talked to. */
export const TOBY_AFTER_THORNE: Step[] = [...SEARCHED, { move: "thorne_garden" }, THORNE_GREETS, { move: "potting_shed" }, TOBY_GREETS];

const shown = [
  line(THORNE_MET, "Someone with giant boots stood by the broken window, then walked to your fence. Whose boots do you think they were?", {
    id: "thorne-boots-by-implication",
    group: "shown",
    // The prints are described, not named, and they are his: his measuring opens.
    expect: { revealed_clue_ids: ["clue_thorne_measured"], input_understood: true },
  }),
  line(TOBY_MET, "The glass from the window is outside on the path, not inside! So nobody climbed in.", {
    id: "toby-shown-glass-outside",
    group: "shown",
    expect: { revealed_clue_ids: ["toby_drops_burglar"], input_understood: true },
  }),
  line(TOBY_MET, "toby why r there welly prints with leafs on in the pumpkin mush??", {
    id: "toby-shown-welly-prints",
    group: "shown",
    // A child's spelling of the welly prints: generous on form.
    expect: { revealed_clue_ids: ["toby_blames_mia"], input_understood: true },
  }),
  line([...TOBY_MET, { move: "thorne_garden" }, THORNE_GREETS], "toby says u were up ur ladder with a tape measure saying enjoy her while she lasts", {
    id: "thorne-shown-what-toby-said",
    group: "shown",
    // Toby's sighting, passed on in the player's words, is one of the two clues that open his Thursday.
    expect: { revealed_clue_ids: ["thorne_ladder_thursday"], input_understood: true },
  }),
  line(
    [...SEARCHED, { search: "the toppled bench" }, { move: "potting_shed" }, { search: "the watering rota on the door" }, { move: "greenhouse" }, HALE_GREETS, HALE_SHOWN_ROTA],
    "The old bench had a rotten leg and it snapped. Maybe it fell on Bertha by accident?",
    {
      id: "hale-shown-snapped-bench",
      group: "shown",
      expect: { revealed_clue_ids: ["clue_hale_toby_upset"], input_understood: true },
    },
  ),
  line([...SEARCHED, { move: "potting_shed" }, { search: "the watering rota on the door" }, { move: "greenhouse" }, HALE_GREETS], "Toby's name is crossed off the rota and MIA is written over it in sparkly purple pen. Who changed it?", {
    id: "hale-shown-purple-rota",
    group: "shown",
    // Both of her rota clues open on the rota: who wrote it, and how Toby took it.
    expect: { revealed_clue_ids: ["clue_hale_borrowed_pen", "hale_toby_fine"], input_understood: true },
  }),
  line(
    [
      ...SEARCHED,
      { move: "potting_shed" },
      { search: "the watering rota on the door" },
      TOBY_GREETS,
      {
        say: "Your name is crossed out on the rota, and MIA is written over it in purple pen.",
        reply: "Toby frowns. \"Mia said she wished Bertha would just go splat, so she could get back to her dance practice.\"",
        opened: ["clue_toby_mia_splat"],
      },
      MIA_GREETS,
    ],
    "Toby told me you wished Bertha would go splat so you could get back to dance practice!",
    {
      id: "mia-shown-what-toby-said",
      group: "shown",
      expect: { revealed_clue_ids: ["mia_admits_splat"], input_understood: true },
    },
  ),
  line([...TOBY_AFTER_THORNE, TOBY_SHOWN_WELLIES], "But Mr. Thorne bought carrot cake from Mia at the fair at nine o'clock. She was all the way across town!", {
    id: "toby-shown-cake-alibi",
    group: "shown",
    // He has blamed Mia; Thorne's sighting of her at nine takes that back.
    expect: { revealed_clue_ids: ["toby_not_mia"], input_understood: true },
  }),
];

const afterDodge = [
  line(
    [...TOBY_MET, { say: "toby the glass from the window was OUTSIDE on the path not inside", reply: "Toby sweeps faster. \"Glass goes everywhere when a window breaks. Have you looked at Mr. Thorne's ladder yet?\"" }],
    "so did someone climb in or not??",
    {
      id: "toby-glass-follow-up",
      group: "shown-after-dodge",
      // The glass was shown on the line before and dodged; it still counts on the follow-up.
      expect: { revealed_clue_ids: ["toby_drops_burglar"], input_understood: true },
    },
  ),
  line(
    [...THORNE_MET, { say: "There are huge boot prints in the flower bed by the broken window, right near your fence.", reply: "Mr. Thorne snorts. \"Boots? Half the town wears boots, young detective.\"" }],
    "So are they yours or not?",
    {
      id: "thorne-boots-follow-up",
      group: "shown-after-dodge",
      expect: { revealed_clue_ids: ["clue_thorne_measured"], input_understood: true },
    },
  ),
];

const bluffed = [
  line([...SEARCHED, { move: "potting_shed" }, TOBY_GREETS], "I saw the rota. Mia's name is written over yours in purple pen!", {
    id: "toby-bluffed-rota",
    group: "bluffed",
    // The rota is not held, but what it shows is claimed plainly, and the gate is not physical.
    expect: { revealed_clue_ids: ["clue_toby_mia_splat"], input_understood: true },
  }),
  line([{ move: "thorne_garden" }, THORNE_GREETS], "I saw huge boot prints in the flower bed by the broken window, right by your fence. Are they yours?", {
    id: "thorne-bluffed-boot-prints",
    group: "bluffed",
    expect: { revealed_clue_ids: ["clue_thorne_measured"], input_understood: true },
  }),
  line([HALE_GREETS], "Someone crossed Toby's name off the rota and wrote MIA over it in sparkly purple pen. Was that you?", {
    id: "hale-bluffed-rota",
    group: "bluffed",
    expect: { revealed_clue_ids: ["clue_hale_borrowed_pen", "hale_toby_fine"], input_understood: true },
  }),
];

const wordedLine = [
  line(HALE_GUARDED, "I promise I will be fair to Toby. I only want to know what really happened.", {
    id: "hale-promise-fair",
    group: "worded-line",
    expect: { revealed_clue_ids: ["clue_hale_toby_upset"], input_understood: true },
  }),
  line(HALE_GUARDED, "Toby loves Bertha so much. Maybe it was all just a horrible accident?", {
    id: "hale-suggests-accident",
    group: "worded-line",
    // Something kind about Toby and the thought of an accident, with the bench never searched.
    expect: { revealed_clue_ids: ["clue_hale_toby_upset"], input_understood: true },
  }),
];

const asked = [
  line(DOBBS_MET, "What did you hear last night?", {
    id: "dobbs-asked-noise",
    group: "asked",
    expect: { revealed_clue_ids: ["clue_dobbs_crash_time"], input_understood: true },
  }),
  line(TOBY_MET, "have you seen the greenhouse key?", {
    id: "toby-asked-key",
    group: "asked",
    // His answer is a lie, and the question earns it.
    expect: { revealed_clue_ids: ["toby_no_key"], input_understood: true },
  }),
  line([...SEARCHED, HALE_GREETS], "When did you last see the greenhouse key?", {
    id: "hale-asked-key",
    group: "asked",
    expect: { revealed_clue_ids: ["clue_hale_key_last_seen"], input_understood: true },
  }),
  line([...TOBY_MET, MIA_GREETS], "Toby says Mr. Thorne did it. Where was Mr. Thorne on Friday evening?", {
    id: "mia-asked-thorne-friday",
    group: "asked",
    expect: { revealed_clue_ids: ["clue_mia_thorne_barbecue"], input_understood: true },
  }),
];

const confession = [
  line([...TOBY_AFTER_THORNE, TOBY_SHOWN_GLASS, TOBY_SHOWN_WELLIES, TOBY_SHOWN_CAKE], "toby what really happened?", {
    id: "toby-cornered-what-happened",
    group: "confession",
    // Both of his cover stories have fallen; a plain question is all the confession waits on.
    expect: { revealed_clue_ids: ["toby_confession"], input_understood: true },
  }),
];

const hold = [
  line(TOBY_MET, "i think u did it!! just tell me the truth toby i wont be mad", {
    id: "toby-pushed-just-tell-me",
    group: "hold-pushed",
    // He holds the glass and the welly prints, but shows neither.
    expect: NOTHING,
  }),
  line([...TOBY_MET, TOBY_SHOWN_GLASS, TOBY_SHOWN_WELLIES], "it wasnt mia!! it was YOU toby!!", {
    id: "toby-shaken-it-was-you",
    group: "hold-pushed",
    // Insisting Mia is innocent is not the proof that clears her.
    expect: NOTHING,
  }),
  line(THORNE_MET, "You smashed Bertha so Goliath would win!", {
    id: "thorne-pushed-accused",
    group: "hold-pushed",
    expect: NOTHING,
  }),
  line(HALE_GUARDED, "toby did it didnt he!! tell me!!", {
    id: "hale-pushed-accuse-toby",
    group: "hold-pushed",
    // Pushing on Toby is the opposite of the kindness her line asks for.
    expect: NOTHING,
  }),
  line([...SEARCHED, { move: "thorne_garden" }, { search: "the ladder by the fence" }, THORNE_GREETS], "Do you own a ladder?", {
    id: "thorne-asked-about-ladder",
    group: "hold-topic",
    // The ladder is held, but naming it without where it stands or what it was for uses nothing.
    expect: NOTHING,
  }),
  line(TOBY_MET, "is the window broken?", {
    id: "toby-asked-window-word",
    group: "hold-topic",
    // The word, not the point: where the glass fell is not said.
    expect: NOTHING,
  }),
  line(DOBBS_MET, "Do you like being the caretaker?", {
    id: "dobbs-small-talk",
    group: "hold-small-talk",
    expect: NOTHING,
  }),
  line([...SEARCHED, { move: "potting_shed" }, MIA_GREETS], "What's your favourite thing about the garden club?", {
    id: "mia-small-talk",
    group: "hold-small-talk",
    expect: NOTHING,
  }),
  line(TOBY_MET, "Where were you on Friday night?", {
    id: "toby-holds-glass-asks-friday",
    group: "hold-held-not-used",
    // He has told his alibi already; the glass and the prints are held, not used.
    expect: NOTHING,
  }),
  line(THORNE_MET, "blorp ??? fnord !!!", {
    id: "thorne-asked-gibberish",
    group: "hold-gibberish",
    expect: { revealed_clue_ids: [], input_understood: false },
  }),
];

export default [...shown, ...afterDodge, ...bluffed, ...wordedLine, ...asked, ...confession, ...hold];
