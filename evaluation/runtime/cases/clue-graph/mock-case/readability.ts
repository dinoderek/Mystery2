// Readability cases on the clue-graph mock case: each is ONE deterministic
// interaction event, judged by `flesch` alone.
//
// A case fixes the entire prior state (`given`, including the full `history`)
// and the single `action` under test, so the model input is identical every run
// and across models. No turn accumulation, no divergence: swap the narrator or
// ai_profile/model and you are comparing apples to apples on the same input.
//
// These cases are narrated at age 10 (about US grade 5). `history` rows mirror how the
// runtime stores game_events, so the same data drives both narrator sources:
// the server seeds these as rows; a CLI narrator feeds them to the context
// builder.
//
// This file exports a LIST of cases; `judge turn` accepts a single case or a list.
// Default judges are deterministic (no judge-model calls). Add the model judge
// with --judges flesch,age_appropriate_turn; --judge-binding judge-stub answers
// it offline.

import { actionCase, lineCase, type Story } from "../support/play.ts";
import { ALICE_GREETS } from "./all-interactions.ts";

const MOCK: Story = { file: "blueprints/clue-graph/mock-case.json", reading_age: 10 };
const FLESCH = { judges: ["flesch"], judgeConfig: { flesch: { tolerance: 2 } } };

export default [
  // Mid-conversation question to the culprit: the richest readability signal.
  lineCase(
    MOCK,
    [
      ALICE_GREETS,
      {
        say: "Did you take the cookies?",
        reply: "\"The cookies? I never even went near the jar,\" Alice says, folding her arms.",
      },
    ],
    "Then why are your hands shaking?",
    { id: "ask-alice-alibi-pressure", ...FLESCH },
  ),

  // Opening a conversation cold: narrator scene-setting prose.
  actionCase(MOCK, [{ move: "loc-living-room" }], { type: "talk", character_id: "char-bob" }, { id: "talk-bob-open", ...FLESCH }),
];
