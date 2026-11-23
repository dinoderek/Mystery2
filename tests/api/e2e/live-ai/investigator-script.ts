import { MOCK_CASE_ID } from "../../../testkit/src/mock-case";

/** One typed line, as the player would type it, and the mode it should leave the game in. */
export interface InvestigatorStep {
  input: string;
  expect_mode?: "explore" | "talk" | "accuse" | "ended";
}

export interface InvestigatorScriptCase {
  case_id: string;
  blueprint_id: string;
  max_turns: number;
  steps: InvestigatorStep[];
}

export const investigatorScript: InvestigatorScriptCase = {
  case_id: "default-cookie-case",
  blueprint_id: MOCK_CASE_ID,
  max_turns: 10,
  steps: [
    { input: "search the pantry shelf", expect_mode: "explore" },
    { input: "go to living room", expect_mode: "explore" },
    { input: "search", expect_mode: "explore" },
    { input: "talk to bob", expect_mode: "talk" },
    { input: "What did you see of Alice?", expect_mode: "talk" },
    { input: "bye", expect_mode: "explore" },
    // A clue-graph accusation is judged at once; a failure returns to exploring, and the third ends the case.
    { input: "accuse Alice: her floury fingerprints are on the empty cookie jar, and Bob's score sheet shows he was playing his board game." },
    { input: "accuse Alice, because the cookie jar is empty and Bob was busy with his board game all through noon." },
    { input: "accuse Alice: the jar and Bob's score sheet point to her.", expect_mode: "ended" },
  ],
};
