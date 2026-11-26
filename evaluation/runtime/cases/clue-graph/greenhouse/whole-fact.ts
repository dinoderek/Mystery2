// Whole facts on the clue-graph greenhouse: a clue that comes out keeps every
// name, time and place of its fact, in the narration and in its notebook line
// (`docs/clue-graph.md`, "The narrator's judgement"). Each case expects its
// clue, lists the fact's details (`expect.whole_fact`, a list of accepted
// spellings each), and asks `gm_clue_discipline`, which reads the line against
// the fact. Chosen for the facts most crowded with details: times, days and
// people together.

import { lineCase, searchCase, type Step, type Story } from "../support/play.ts";
import { DOBBS_MET, HALE_GREETS, SEARCHED, THORNE_MET, TOBY_AFTER_THORNE, TOBY_SHOWN_CAKE, TOBY_SHOWN_GLASS, TOBY_SHOWN_WELLIES } from "./talk.ts";

const GREENHOUSE: Story = { file: "blueprints/clue-graph/greenhouse-prizewinner.json", reading_age: 10 };
type Labels = Parameters<typeof lineCase>[3];
const line = (steps: Step[], say: string, labels: Labels) => lineCase(GREENHOUSE, steps, say, labels);
const search = (steps: Step[], query: string | null, labels: Labels) => searchCase(GREENHOUSE, steps, query, labels);
const JUDGED = { gm_clue_discipline: "either" } as const;

export default [
  search([...SEARCHED, { move: "workshop" }], null, {
    id: "whole-key-book",
    group: "whole-fact",
    // Three days, two people and five times, in one entry of the key book; 5:20 stands for both its showings.
    expect: {
      revealed_clue_id: "clue_spare_key_book",
      input_understood: true,
      whole_fact: {
        clue_spare_key_book: [
          "Mia",
          ["Ms. Hale", "Ms Hale"],
          "Thursday",
          "Friday",
          "Saturday",
          ["5:05", "five past five"],
          ["5:20", "twenty past five"],
          ["5:00", "five o'clock", "5 o'clock", "5pm", "5 pm"],
          ["7:25", "twenty-five past seven", "twenty five past seven"],
        ],
      },
      judges: JUDGED,
    },
  }),
  line(DOBBS_MET, "Did you hear anything last night?", {
    id: "whole-dobbs-crash",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["clue_dobbs_crash_time"],
      input_understood: true,
      whole_fact: { clue_dobbs_crash_time: [["ten to nine", "8:50"], "garden", "fox"] },
      judges: JUDGED,
    },
  }),
  line([...SEARCHED, HALE_GREETS], "When did anyone last see the greenhouse key?", {
    id: "whole-hale-key",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["clue_hale_key_last_seen"],
      input_understood: true,
      whole_fact: { clue_hale_key_last_seen: ["Wednesday", ["half past three", "3:30"], "hook", "Toby", "Mia", "shed"] },
      judges: JUDGED,
    },
  }),
  line(THORNE_MET, "There are huge boot prints in the flower bed outside the broken window, right by your fence. Are they yours?", {
    id: "whole-thorne-measured",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["clue_thorne_measured"],
      input_understood: true,
      whole_fact: { clue_thorne_measured: ["Friday", ["four", "4:00", "4pm", "4 pm", "4 o'clock"], ["boot prints", "boot print", "bootprints", "footprints", "prints"], "window", "Bertha"] },
      judges: JUDGED,
    },
  }),
  line([...TOBY_AFTER_THORNE, TOBY_SHOWN_GLASS, TOBY_SHOWN_WELLIES, TOBY_SHOWN_CAKE], "please toby, tell me everything that happened", {
    id: "whole-toby-confession",
    group: "whole-fact",
    // The longest fact in the story, and the one the ending rests on.
    expect: {
      revealed_clue_ids: ["toby_confession"],
      input_understood: true,
      whole_fact: { toby_confession: ["Wednesday", "key", "water", "Bertha", "hose", "bench", "window", "burglar"] },
      judges: JUDGED,
    },
  }),
];
