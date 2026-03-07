export type InvestigatorAction =
  | "move"
  | "search"
  | "talk"
  | "ask"
  | "end_talk"
  | "accuse_start"
  | "accuse_reasoning";

export interface InvestigatorStep {
  action: InvestigatorAction;
  payload: Record<string, unknown>;
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
      action: "search",
      payload: {},
      expect_mode: "explore",
    },
    {
      action: "talk",
      payload: { character_name: "Alice" },
      expect_mode: "talk",
    },
    {
      action: "ask",
      payload: {
        player_input: "Where were you when the cookies disappeared?",
      },
      expect_mode: "talk",
    },
    {
      action: "end_talk",
      payload: {},
      expect_mode: "explore",
    },
    {
      action: "accuse_start",
      payload: { accused_character_id: "Alice" },
      expect_mode: "accuse",
    },
    {
      action: "accuse_reasoning",
      payload: { player_reasoning: "Alice looked nervous near the cookie jar." },
      expect_mode: "accuse",
    },
    {
      action: "accuse_reasoning",
      payload: {
        player_reasoning:
          "Alice had motive, opportunity, and clues place her at the scene.",
      },
      expect_mode: "ended",
    },
  ],
};
