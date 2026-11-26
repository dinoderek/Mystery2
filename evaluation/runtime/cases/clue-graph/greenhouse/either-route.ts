// A gate with two routes on the clue-graph greenhouse: Ms. Hale's admission
// about Toby opens on the snapped bench shown to her, or on her line of
// questioning (be fair or kind to Toby, or suggest an accident), each on its
// own (`docs/clue-graph.md`, "The model"). The bench is held in every case, so
// only what the line does differs: the bench shown alone, the line taken alone,
// and neither. An admission that comes out is checked in the narration, the
// reported gate id and its notebook line (`expect.whole_fact`).

import { lineCase, type Step, type Story } from "../support/play.ts";
import { HALE_GREETS, HALE_SHOWN_ROTA, SEARCHED } from "./talk.ts";

const GREENHOUSE: Story = { file: "blueprints/clue-graph/greenhouse-prizewinner.json", reading_age: 10 };
const line = (steps: Step[], say: string, labels: Parameters<typeof lineCase>[3]) => lineCase(GREENHOUSE, steps, say, labels);

/** The bench searched and the rota shown: she has stood up for Toby, and her admission is offered. */
const HALE_WITH_BENCH: Step[] = [
  ...SEARCHED,
  { search: "the toppled bench" },
  { move: "potting_shed" },
  { search: "the watering rota on the door" },
  { move: "greenhouse" },
  HALE_GREETS,
  HALE_SHOWN_ROTA,
];

const ADMISSION = {
  revealed_clue_ids: ["clue_hale_toby_upset"],
  input_understood: true,
  whole_fact: { clue_hale_toby_upset: ["Toby", ["watering", "shifts"], "Monday", "lock", "pumpkin"] },
};

export default [
  line(HALE_WITH_BENCH, "Look at the toppled bench. Its rotten leg snapped clean through, and its heavy pots crashed down onto Bertha.", {
    id: "hale-either-bench-alone",
    group: "shown",
    // The bench shown, with nothing kind said and the word accident never used: as near the show route alone as the bench allows, since its fact itself points to an accident.
    expect: ADMISSION,
  }),
  line(HALE_WITH_BENCH, "I promise I will be fair to Toby. He is a kind boy.", {
    id: "hale-either-line-alone",
    group: "worded-line",
    // The line taken, with the bench held but never brought up: the line route alone.
    expect: ADMISSION,
  }),
  line(HALE_WITH_BENCH, "Did you see anyone near the greenhouse on Friday evening?", {
    id: "hale-either-neither",
    group: "hold-held-not-used",
    // The bench held and not used, and nothing of her line: nothing opens.
    expect: { revealed_clue_ids: [], input_understood: true },
  }),
];
