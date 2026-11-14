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
  blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
  max_turns: 10,
  steps: [
    {
      input: "go to kitchen",
      expect_mode: "explore",
    },
    {
      input: "search",
      expect_mode: "explore",
    },
    {
      input: "talk to alice",
      expect_mode: "talk",
    },
    {
      input: "Where were you when the cookies disappeared?",
      expect_mode: "talk",
    },
    {
      input: "bye",
      expect_mode: "explore",
    },
    {
      input: "accuse Alice. She looked nervous near the cookie jar.",
      expect_mode: "accuse",
    },
    {
      input: "Alice had motive, opportunity, and clues place her at the scene.",
      expect_mode: "ended",
    },
  ],
};
