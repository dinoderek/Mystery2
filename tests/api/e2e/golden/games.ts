// The scripted games whose transcripts are committed in `transcripts/`.
//
// Together they play every command in docs/game.md under every alias, every
// refusal, `help`, the turn budget running out by each kind of last turn and the
// last accusations spent back to back, a failed accusation explored past into a
// win, and three failures into a loss, on the mock case; and the greenhouse
// clue-graph case played to a win and to a loss.

import type { ScriptStep } from "../../../testkit/src/golden/screen";

export const BLUEPRINT_IDS = {
  // `clueGraphCaseId("mock-case")`
  "mock-case": "0b4deb40-e0d1-8cbf-a4bc-9ae6af12fbd5",
  // `clueGraphCaseId("greenhouse-prizewinner")`
  "greenhouse-clue-graph": "9afa1ef4-b543-81b5-a50f-4a366ec7e2ef",
} as const;

export interface GoldenGame {
  name: string;
  blueprint: keyof typeof BLUEPRINT_IDS;
  script: ScriptStep[];
}

const ENTER = { enter: true } as const;

export const GOLDEN_GAMES: GoldenGame[] = [
  {
    // Every refusal, the views, searching a room, a spot, an empty spot and a
    // hidden one, talking, the ways back, a failed accusation, and a win once
    // the budget runs out.
    name: "mock-investigation-won",
    blueprint: "mock-case",
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
      "search the laundry basket",
      "go to the Living Room",
      "search",
      "talk to bob",
      "What did you see of Alice?!",
      "tell me more",
      "xzqv",
      "help",
      "notebook",
      "who is here?",
      "bye",
      "move to kitchen",
      "speak to Alice",
      "Where were you at noon?",
      "accuse Bob",
      "Look at this: clue_score_sheet",
      "goodbye",
      "accuse",
      "help",
      "notebook",
      "back",
      "accuse",
      "cancel",
      "accuse",
      "never mind",
      "accuse",
      "nevermind",
      "back",
      "accuse",
      "Maybe it was Bob?",
      // Back to exploring; the hidden spot is in view now, the search spends the last turn, and the accusation is forced.
      "search the laundry basket",
      "I think it was Alice, because of the empty cookie jar.",
    ],
  },
  {
    // Accusations given with the command, failed three times into a loss.
    name: "mock-accusation-lost",
    blueprint: "mock-case",
    script: [
      ENTER,
      "accuse Bob took the cookies",
      "It was Bob",
      "accuse It was definitely Bob",
      "accuse Bob, I am sure",
    ],
  },
  {
    // Ten turns, the last one a conversation, then a won accusation on the
    // confession: a statement taken back, then owned up to.
    name: "mock-budget-ends-in-talk",
    blueprint: "mock-case",
    script: [
      ENTER,
      "go to living room",
      "search",
      "go to kitchen",
      "search the pantry shelf",
      "talk to alice",
      "Where were you?",
      "Look at this: clue_score_sheet",
      "And this jar: clue_jar",
      "see you",
      "search",
      "search under the kitchen sink",
      "move to living room",
      "look behind the bookshelf",
      "talk to Bob",
      "help",
      "back",
      "Alice did it",
    ],
  },
  {
    // Ten turns, the last one a move, then the three accusations back to back into a loss.
    name: "mock-budget-ends-in-move",
    blueprint: "mock-case",
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
      "never mind",
      "Bob took it",
      "Bob again",
    ],
  },
  {
    // Ten turns, the last one a search, and the case left by quitting.
    name: "mock-budget-ends-in-search",
    blueprint: "mock-case",
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
      "search the pantry shelf",
      "search",
      "accuse",
      "quit",
    ],
  },
  {
    // Leaving a case partway through a conversation.
    name: "mock-quit-while-talking",
    blueprint: "mock-case",
    script: [ENTER, "talk to Alice", "quit"],
  },
  {
    // The longer aliases, a bare `go`, and `exit` out of a forced accusation.
    name: "mock-aliases",
    blueprint: "mock-case",
    script: [
      ENTER,
      "where can i go",
      "who is here",
      "look",
      "search the pantry shelf",
      "speak to Alice",
      "Where were you at noon?",
      "see you",
      "travel to the living room",
      "inspect",
      "speak with Bob",
      "leave",
      "talk to bob",
      "end",
      "go home",
      "head towards the kitchen",
      "talk to alice",
      "bye",
      "go living room",
      "exit",
    ],
  },
  {
    // First words, an answer, a gate opened that takes a statement back, and a
    // win on a supported culprit.
    name: "clue-graph-won",
    blueprint: "greenhouse-clue-graph",
    script: [
      ENTER,
      "search",
      "search the smashed pumpkin",
      "go to the workshop",
      "talk to Mr. Dobbs",
      "What about the noise last night?",
      "bye",
      "go to the garden",
      "talk to Mr. Thorne",
      "Look at these: clue_boot_prints",
      "bye",
      "notebook",
      "accuse",
      "It was Toby.",
      "accuse Toby did it: his welly prints are in the pumpkin, and Mia was at the cake tent.",
    ],
  },
  {
    // The culprit named twice with nothing to support it, then the wrong suspect, into a loss.
    name: "clue-graph-lost",
    blueprint: "greenhouse-clue-graph",
    script: [ENTER, "talk to Ms. Hale", "What about the missing key?", "bye", "accuse", "It was Toby", "accuse Toby, because I say so", "accuse Mr. Thorne, I am sure"],
  },
];
