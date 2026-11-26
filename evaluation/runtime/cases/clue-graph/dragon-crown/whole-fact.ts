// Whole facts on the clue-graph dragon crown, as on the greenhouse
// (`../greenhouse/whole-fact.ts`): the clue comes out with every name, time and
// place of its fact, in the narration and in its notebook line. The story's own
// cases: Mr. Pike's sighting, whose line also names the hidden spot it points
// at, and the crown found there.

import { lineCase, searchCase, type Step, type Story } from "../support/play.ts";
import { GOLD_STEPS, CARDS, LEO_GREETS, PIKE_AFTER_SAM, PIKE_MET, SAM_WITH_SHEET, SHEET } from "./talk.ts";
import { POINTED } from "./search.ts";

const CROWN: Story = { file: "blueprints/clue-graph/dragon-crown.json", reading_age: 8 };
type Labels = Parameters<typeof lineCase>[3];
const line = (steps: Step[], say: string, labels: Labels) => lineCase(CROWN, steps, say, labels);
const search = (steps: Step[], query: string | null, labels: Labels) => searchCase(CROWN, steps, query, labels);
const JUDGED = { gm_clue_discipline: "either" } as const;
const QUARTER_PAST = ["quarter past twelve", "12:15"];

export default [
  line(PIKE_MET, "What could you see through the art room window at lunchtime?", {
    id: "whole-pike-bundle",
    group: "whole-fact",
    // A pointer: its line names the spot behind the big paper dragon.
    expect: {
      revealed_clue_ids: ["clue_pike_saw_bundle"],
      input_understood: true,
      whole_fact: { clue_pike_saw_bundle: ["Leo", QUARTER_PAST, "art room", "apron", ["behind the big paper dragon", "behind the paper dragon"]] },
      judges: JUDGED,
    },
  }),
  line(PIKE_AFTER_SAM, "Did you see Nina at lunchtime?", {
    id: "whole-pike-nina",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["clue_pike_saw_nina"],
      input_understood: true,
      whole_fact: { clue_pike_saw_nina: ["Nina", ["bike shed", "bike-shed"], ["past twelve", "after twelve", "past 12", "after 12"], ["quarter to one", "12:45"], "hall"] },
      judges: JUDGED,
    },
  }),
  line(SAM_WITH_SHEET, "The sign-in sheet only has your name on it. Nina isn't on it at all.", {
    id: "whole-sam-retracts",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["sam_retracts"],
      input_understood: true,
      whole_fact: { sam_retracts: ["Nina", ["five past twelve", "12:05"], ["on his own", "on my own", "by himself", "by myself", "alone"]] },
      judges: JUDGED,
    },
  }),
  line([...GOLD_STEPS, ...CARDS, { move: "art_room" }, LEO_GREETS], "There's gold glitter smeared on the stage steps and a big dent in the cushion.", {
    id: "whole-leo-admits-hall",
    group: "whole-fact",
    expect: {
      revealed_clue_ids: ["leo_admits_hall"],
      input_understood: true,
      whole_fact: { leo_admits_hall: ["hall", ["glitter paint", "glitter"], ["stage steps", "steps"], "shoe"] },
      judges: JUDGED,
    },
  }),
  search(SHEET.slice(0, 1), "the sign-in sheet on the desk", {
    id: "whole-sign-in-sheet",
    group: "whole-fact",
    expect: {
      revealed_clue_id: "clue_signin_sheet",
      input_understood: true,
      whole_fact: { clue_signin_sheet: ["Sam", ["12:05", "five past twelve"], "Nina"] },
      judges: JUDGED,
    },
  }),
  search(POINTED, "behind the big paper dragon", {
    id: "whole-crown-behind-dragon",
    group: "whole-fact",
    expect: {
      revealed_clue_id: "clue_crown_behind_dragon",
      input_understood: true,
      whole_fact: { clue_crown_behind_dragon: ["crown", ["paper dragon", "dragon"], "glue"] },
      judges: JUDGED,
    },
  }),
];
