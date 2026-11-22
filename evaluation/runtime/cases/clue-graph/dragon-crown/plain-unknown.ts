// The plain "I do not know" on the clue-graph dragon crown, as on the
// greenhouse (`../greenhouse/plain-unknown.ts`): asked about something that
// bears on the case and lies outside their clues and `knows`, a character says
// plainly that they do not know, and nothing opens.

import type { Expect } from "../../../lib/case.ts";
import { lineCase, type Step } from "../support/play.ts";
import { ABARA_GREETS, HALL, NINA_MET, PIKE_MET, SAM_MET } from "./talk.ts";

const CROWN = "blueprints/clue-graph/dragon-crown.json";
const line = (steps: Step[], say: string, labels: Parameters<typeof lineCase>[3]) => lineCase(CROWN, steps, say, labels);
const UNKNOWN: Expect = { revealed_clue_ids: [], input_understood: true, judges: { gm_fabrication: "either" } };

export default [
  line([HALL, ABARA_GREETS], "Where was Leo at lunchtime?", {
    id: "unknown-abara-leo",
    group: "plain-unknown",
    // She was in the staff room; she saw only Nina pass the door.
    expect: UNKNOWN,
  }),
  line(SAM_MET, "Who took the crown?", {
    id: "unknown-sam-who",
    group: "plain-unknown",
    // His secret is Nina's alibi, not the crown: who took it he does not know.
    expect: UNKNOWN,
  }),
  line(PIKE_MET, "Where was Mrs. Abara at lunchtime?", {
    id: "unknown-pike-abara",
    group: "plain-unknown",
    // He watched the art room windows and the bike shed, not the staff room.
    expect: UNKNOWN,
  }),
  line(NINA_MET, "Did you see who went into the hall?", {
    id: "unknown-nina-hall",
    group: "plain-unknown",
    expect: UNKNOWN,
  }),
];
