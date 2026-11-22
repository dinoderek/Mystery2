// Invention on the clue-graph dragon crown, as on the greenhouse
// (`../greenhouse/invention.ts`): a spot that holds nothing finds nothing that
// looks like evidence, and a detail an earlier turn made up stays, later in the
// talk and on a later visit.

import { lineCase, searchCase, type Step } from "../support/play.ts";
import { HALL } from "./talk.ts";

const CROWN = "blueprints/clue-graph/dragon-crown.json";
type Labels = Parameters<typeof lineCase>[3];
const line = (steps: Step[], say: string, labels: Labels) => lineCase(CROWN, steps, say, labels);
const search = (steps: Step[], query: string | null, labels: Labels) => searchCase(CROWN, steps, query, labels);
const JUDGED = { gm_fabrication: "either" } as const;

/** Sam met, reading a comic the narration named. */
const SAM_WITH_COMIC: Step[] = [
  { move: "library" },
  {
    talk: "sam",
    narration:
      "Sam peeks out from behind a comic called Captain Comet and the Moon Pirates. \"Nina was in here with me all lunchtime, reading comics, from twelve until the bell. She never went anywhere near the hall.\" He holds the comic up so high that it hides his face, and the page never turns.",
  },
];

/** The library in the rain, the hall, then the library again. */
const BACK_IN_THE_RAIN: Step[] = [
  { move: "library" },
  {
    search: "the sign-in sheet on the desk",
    narration:
      "Rain streaks the library windows, and an old radiator ticks under the sill. On the desk, the lunchtime sign-in sheet has one name: 'Sam, 12:05'. No second name is beside it, and Nina's name is nowhere on the page.",
  },
  HALL,
  { search: "the stage steps" },
  { move: "library" },
];

export default [
  search([HALL], "the props table", {
    id: "invent-nothing-props-table",
    group: "invention",
    // Beside the empty cushion, a smear, a print or a dropped thing would look like a clue.
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
  search([{ move: "playground" }], "the climbing frame", {
    id: "invent-nothing-climbing-frame",
    group: "invention",
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
  line(SAM_WITH_COMIC, "What's your comic about?", {
    id: "invent-kept-sam-comic",
    group: "invention",
    // The comic keeps its name, and its story says nothing about lunchtime.
    expect: { revealed_clue_ids: [], input_understood: true, judges: JUDGED },
  }),
  search(BACK_IN_THE_RAIN, "the comic corner", {
    id: "invent-kept-library-revisit",
    group: "invention",
    // Back in the library: still raining, and the comic corner holds nothing.
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
];
