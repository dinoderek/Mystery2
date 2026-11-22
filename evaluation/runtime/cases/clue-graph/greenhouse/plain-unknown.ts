// The plain "I do not know" on the clue-graph greenhouse: a character asked
// about something that bears on the case, outside their clues and `knows`,
// says plainly that they do not know (`docs/clue-graph.md`, "The narrator's
// judgement"). Nothing opens, and `gm_fabrication` fails a made-up answer, a
// guess or a hint at who, when or where, or a dodge that suggests they know.
// Each question is one the character could plausibly be asked, and none
// touches a clue of their own still to come out.

import type { Expect } from "../../../lib/case.ts";
import { lineCase, type Step } from "../support/play.ts";
import { DOBBS_MET, HALE_GREETS, MIA_GREETS, SEARCHED, THORNE_MET } from "./talk.ts";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const line = (steps: Step[], say: string, labels: Parameters<typeof lineCase>[3]) => lineCase(GREENHOUSE, steps, say, labels);
const UNKNOWN: Expect = { revealed_clue_ids: [], input_understood: true, judges: { gm_fabrication: "either" } };

export default [
  line(DOBBS_MET, "Who do you think smashed Bertha?", {
    id: "unknown-dobbs-who",
    group: "plain-unknown",
    // He heard the crash; who made it he never saw.
    expect: UNKNOWN,
  }),
  line([...SEARCHED, { move: "potting_shed" }, MIA_GREETS], "Where was Toby on Friday evening?", {
    id: "unknown-mia-toby-friday",
    group: "plain-unknown",
    // She was at the cake tent; she cannot say where Toby was.
    expect: UNKNOWN,
  }),
  line(THORNE_MET, "Who has got the greenhouse key?", {
    id: "unknown-thorne-key",
    group: "plain-unknown",
    expect: UNKNOWN,
  }),
  line([...SEARCHED, HALE_GREETS], "Did you see anybody near the greenhouse on Friday evening?", {
    id: "unknown-hale-friday",
    group: "plain-unknown",
    // She found Bertha in the morning; she was not there that night.
    expect: UNKNOWN,
  }),
];
