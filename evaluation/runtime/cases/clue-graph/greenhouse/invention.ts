// Invention on the clue-graph greenhouse: the narrator may add scenery and
// manner, but nothing that looks like evidence or bears on who, when or where,
// and what earlier narration established stays (`docs/clue-graph.md`, "The
// narrator's judgement"). `gm_fabrication` judges each turn. Two kinds:
//
// - a spot that holds nothing, where an invented mark or object would look
//   like a clue;
// - a detail an earlier turn invented, asked about later in the same talk, or
//   met again on a later visit to the place.

import { lineCase, searchCase, type Step } from "../support/play.ts";
import { SEARCHED } from "./talk.ts";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
type Labels = Parameters<typeof lineCase>[3];
const line = (steps: Step[], say: string, labels: Labels) => lineCase(GREENHOUSE, steps, say, labels);
const search = (steps: Step[], query: string | null, labels: Labels) => searchCase(GREENHOUSE, steps, query, labels);
const JUDGED = { gm_fabrication: "either" } as const;

/** Mr. Dobbs met, with a cat the narration made up. */
const DOBBS_WITH_CAT: Step[] = [
  ...SEARCHED,
  { move: "workshop" },
  {
    talk: "dobbs",
    narration:
      "Mr. Dobbs looks up from his steaming kettle. A fat ginger cat called Biscuit is curled asleep on his tool bench. \"On my eight o'clock rounds I shone my torch in. Bertha was whole, and the door was locked.\" He rubs the back of his neck and glances at the garden window. \"I should have gone out last night, slippers or no slippers.\"",
  },
];

/** The greenhouse searched in the rain, then the shed, then back. */
const BACK_IN_THE_RAIN: Step[] = [
  {
    search: "the broken side window",
    narration:
      "Rain drums on the glass roof, and a robin watches you from the top of the water butt. Under the broken side window, the glass lies outside on the brick path, not inside. The window was knocked out from inside the greenhouse, so nobody climbed in through it.",
  },
  { search: "the smashed pumpkin" },
  { search: null },
  { move: "potting_shed" },
  { search: "the watering rota on the door" },
  { move: "greenhouse" },
];

export default [
  search([{ move: "potting_shed" }], "the row of key hooks", {
    id: "invent-nothing-key-hooks",
    group: "invention",
    // The key is missing, but nothing at the hooks shows it: an invented label or mark would be evidence.
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
  search([{ move: "potting_shed" }], "the welly pegs", {
    id: "invent-nothing-welly-pegs",
    group: "invention",
    // Muddy or leaf-pattern wellies here would point at a pupil.
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
  line(DOBBS_WITH_CAT, "Can I stroke Biscuit? Is she your cat?", {
    id: "invent-kept-dobbs-cat",
    group: "invention",
    // The cat stays as it was shown, and gains no owner, sighting or time.
    expect: { revealed_clue_ids: [], input_understood: true, judges: JUDGED },
  }),
  search(BACK_IN_THE_RAIN, null, {
    id: "invent-kept-greenhouse-revisit",
    group: "invention",
    // Back in the greenhouse, the room's own clue already found: the rain and the robin stay, and nothing new turns up.
    expect: { revealed_clue_id: null, input_understood: true, judges: JUDGED },
  }),
];
