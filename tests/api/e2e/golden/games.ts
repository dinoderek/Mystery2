// The scripted games whose transcripts are committed in `transcripts/`.
//
// Together they play every command in docs/game.md under every alias, every
// refusal, `help`, the turn budget running out by each kind of last turn, and a
// won and a lost accusation, on the two fixture blueprints.

import type { ScriptStep } from "../../../testkit/src/golden/screen";

export const BLUEPRINT_IDS = {
  "mock-blueprint": "123e4567-e89b-12d3-a456-426614174000",
  "the-missing-heartwood": "a3f5c9d1-4e7b-4a2c-9f81-6b0d2e5a7c34",
} as const;

export interface GoldenGame {
  name: string;
  blueprint: keyof typeof BLUEPRINT_IDS;
  script: ScriptStep[];
}

const ENTER = { enter: true } as const;

export const GOLDEN_GAMES: GoldenGame[] = [
  {
    // Every refusal, the views, searching, talking and a win, within the budget.
    name: "mock-investigation-won",
    blueprint: "mock-blueprint",
    script: [
      ENTER,
      "help",
      "notebook",
      "n",
      "locations",
      "characters",
      "dance",
      "go",
      "move to the moon",
      "talk to",
      "talk to Bob",
      "search xzqv",
      "search",
      "inspect the pantry shelf",
      "look around",
      "go to the Living Room",
      "search",
      "look",
      "talk to bob",
      "What did you see?!",
      "aha, I bet it was the cookies",
      "tell me more",
      "xzqv",
      "help",
      "notebook",
      "who is here?",
      "bye",
      "move to kitchen",
      "speak to Alice Smith",
      "Where were you at noon?",
      "accuse Bob",
      "goodbye",
      "accuse",
      "help",
      "notebook",
      "Maybe it was Bob?",
      "I think it was Alice, because of the empty cookie jar.",
    ],
  },
  {
    // An accusation given with the command, refused three times into a loss.
    name: "mock-accusation-lost",
    blueprint: "mock-blueprint",
    script: [
      ENTER,
      "accuse Bob took the cookies",
      "It was Bob",
      "It was definitely Bob",
      "Bob, I am sure",
    ],
  },
  {
    // Ten turns, the last one a conversation, then a won accusation.
    name: "mock-budget-ends-in-talk",
    blueprint: "mock-blueprint",
    script: [
      ENTER,
      "go to living room",
      "go to kitchen",
      "search",
      "search",
      "talk to alice",
      "Where were you?",
      "see you",
      "move to living room",
      "search",
      "look",
      "go to the kitchen",
      "talk to Alice",
      "help",
      "Alice did it",
      "Alice, because of the clues I found",
    ],
  },
  {
    // Ten turns, the last one a move, then a lost accusation.
    name: "mock-budget-ends-in-move",
    blueprint: "mock-blueprint",
    script: [
      ENTER,
      "move living room",
      "move to kitchen",
      "move to living room",
      "move to kitchen",
      "move to living room",
      "move to kitchen",
      "move to living room",
      "move to kitchen",
      "move to living room",
      "move to kitchen",
      "n",
      "I do not know",
      "Bob took it",
      "Bob again",
      "Bob, Bob, Bob",
    ],
  },
  {
    // Ten turns, the last one a search, and the case left by quitting.
    name: "mock-budget-ends-in-search",
    blueprint: "mock-blueprint",
    script: [
      ENTER,
      "search",
      "search",
      "search",
      "search",
      "search",
      "search",
      "search",
      "search",
      "search the pantry",
      "search",
      "accuse",
      "quit",
    ],
  },
  {
    // Leaving a case partway through a conversation.
    name: "mock-quit-while-talking",
    blueprint: "mock-blueprint",
    script: [ENTER, "talk to Alice", "quit"],
  },
  {
    // The longer aliases on the second fixture, and `exit`.
    name: "heartwood-aliases",
    blueprint: "the-missing-heartwood",
    script: [
      ENTER,
      "where can i go",
      "who is here",
      "look",
      "search the banner wall",
      "speak to Sophie",
      "Where were you?",
      "see you",
      "speak with Sam",
      "leave",
      "talk to Sam Bramble",
      "end",
      "travel to heartwood hollow",
      "inspect",
      "head towards Eva's Leaf-Lab",
      "talk to eva",
      "What are the gloves for?",
      "bye",
      "go home",
      "move to the cheer stage grove",
      "talk to Toby Flit",
      "goodbye",
      "talk to alexandra",
      "exit",
    ],
  },
];
