// Cases on the clue-graph mock case that state their expected outcome, graded
// by code over every sample.
//
// `expect` names what the narrator's structured output must say; a key left
// out is not graded. `group` sums a case's samples with its group's, and
// `ungraded: true` would show a case without counting it in its group. Each
// case is replayed `--samples` times (default 5) per narrator.
//
// The mock provider gets all three right: it reveals the clue in a spot a
// search names, the statement a question about the noon earns, and the
// verdict a well-argued accusation earns.

import { accusationCase, lineCase, searchCase } from "../support/play.ts";
import { ALICE_GREETS, WELL_ARGUED, WELL_ARGUED_STEPS } from "./all-interactions.ts";

const MOCK = "blueprints/clue-graph/mock-case.json";

export default [
  // Naming the spot that holds a clue earns it.
  searchCase(MOCK, [], "the pantry shelf", {
    id: "search-pantry-shelf-reveals-jar",
    group: "example-should-reveal",
    expect: { revealed_clue_id: "clue_jar", input_understood: true },
  }),

  // Alice's answer about noon is open from the start, so a plain question earns it.
  lineCase(MOCK, [ALICE_GREETS], "Where were you at noon?", {
    id: "ask-alice-noon-shares-pantry",
    group: "example-should-give",
    expect: { revealed_clue_ids: ["alice_noon"], input_understood: true },
  }),

  // The culprit, shown by the clues cited: the engine decides a win.
  accusationCase(
    MOCK,
    WELL_ARGUED_STEPS,
    WELL_ARGUED,
    {
      id: "accuse-alice-won",
      group: "example-accuse",
      expect: { verdict: "win" },
    },
  ),
];
