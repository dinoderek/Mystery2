import { describe, expect, it } from "vitest";
import {
  commandHint,
  interpretLine,
  normalizeInput,
  type GrammarState,
} from "../../../packages/game-engine/src/command-grammar.ts";
import type { GameMode } from "../../../packages/game-engine/src/state-machine.ts";
import { BASE_GAME_STATE } from "../../testkit/src/fixtures.ts";

const EXPLORE_HINT =
  "Commands: move to/go to <location>, talk to <character>, search, accuse [statement], locations, characters, notebook, help, quit. Type 'help' for details.";
const TALK_HINT = "Commands: <question>, bye, notebook, help, quit. Type 'help' for details.";
const ACCUSE_HINT = "Commands: <reasoning>, notebook, help, quit. Type 'help' for details.";
const ENDED_HINT = "Commands: notebook, help, quit. Type 'help' for details.";

const MODES: GameMode[] = ["explore", "talk", "accuse", "ended"];

function stateFor(mode: GameMode = "explore"): GrammarState {
  return {
    mode,
    location: "Kitchen",
    locations: BASE_GAME_STATE.locations,
    characters: BASE_GAME_STATE.characters,
  };
}

function interpret(input: string, mode: GameMode = "explore") {
  return interpretLine(input, stateFor(mode));
}

function action(a: unknown) {
  return { kind: "action", action: a };
}

describe("normalizeInput", () => {
  it("normalizes casing, whitespace, and trailing punctuation", () => {
    expect(normalizeInput("  Go To   The Kitchen!  ")).toBe("go to the kitchen");
  });

  it("returns an empty string for whitespace-only input", () => {
    expect(normalizeInput("   ")).toBe("");
  });
});

describe("interpretLine - aliases and modes", () => {
  it("matches move aliases in explore mode", () => {
    expect(interpret("travel to kitchen")).toEqual(
      action({ type: "move", destination: "loc-kitchen" }),
    );
    expect(interpret("head towards barn")).toEqual(
      action({ type: "move", destination: "loc-barn" }),
    );
  });

  it("matches talk aliases in explore mode", () => {
    expect(interpret("speak with mayor fox")).toEqual(
      action({ type: "talk", character_id: "char-mayor" }),
    );
  });

  it("matches search aliases in explore mode", () => {
    expect(interpret("look around")).toEqual(action({ type: "search", query: null }));
    expect(interpret("search")).toEqual(action({ type: "search", query: null }));
  });

  it("captures freeform text after search aliases", () => {
    expect(interpret("search under the bed")).toEqual(
      action({ type: "search", query: "under the bed" }),
    );
    expect(interpret("inspect the bookshelf")).toEqual(
      action({ type: "search", query: "the bookshelf" }),
    );
    expect(interpret("look behind the curtains")).toEqual(
      action({ type: "search", query: "behind the curtains" }),
    );
  });

  it("preserves original casing in search query", () => {
    expect(interpret("Search Under The Desk")).toEqual(
      action({ type: "search", query: "Under The Desk" }),
    );
  });

  it("maps explore accuse commands to reasoning-first payloads", () => {
    expect(interpret("accuse")).toEqual(action({ type: "accuse", reasoning: null }));
    expect(interpret("accuse mayor fox took the cookies")).toEqual(
      action({ type: "accuse", reasoning: "mayor fox took the cookies" }),
    );
  });

  it("matches end-talk aliases in talk mode", () => {
    expect(interpret("goodbye", "talk")).toEqual(action({ type: "end_talk" }));
    expect(interpret("see you", "talk")).toEqual(action({ type: "end_talk" }));
  });

  it("supports quit aliases in all modes", () => {
    expect(interpret("quit", "explore")).toEqual({ kind: "quit" });
    expect(interpret("exit", "talk")).toEqual({ kind: "quit" });
    expect(interpret("quit", "accuse")).toEqual({ kind: "quit" });
    expect(interpret("exit", "ended")).toEqual({ kind: "quit" });
  });

  it("falls back to ask in talk and accuse modes for non-exact commands", () => {
    expect(interpret("go to kitchen", "talk")).toEqual(
      action({ type: "ask", question: "go to kitchen" }),
    );
    expect(interpret("travel to garden", "accuse")).toEqual(
      action({ type: "ask", question: "travel to garden" }),
    );
  });

  it("treats command-like input as reasoning while in accuse mode", () => {
    expect(interpret("talk to mayor", "accuse")).toEqual(
      action({ type: "ask", question: "talk to mayor" }),
    );
    expect(interpret("search under the table", "accuse")).toEqual(
      action({ type: "ask", question: "search under the table" }),
    );
  });

  it("keeps the player's own words as the question", () => {
    expect(interpret("  Where WERE you?  ", "talk")).toEqual(
      action({ type: "ask", question: "Where WERE you?" }),
    );
  });
});

describe("interpretLine - target validation and views", () => {
  it("refuses a bare movement command with the places and people to try", () => {
    expect(interpret("go")).toEqual({
      kind: "refused",
      reason: "missing-target",
      hint: "Where to? Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox.",
    });
  });

  it("refuses a bare talk command with the people here", () => {
    expect(interpret("talk to")).toEqual({
      kind: "refused",
      reason: "missing-target",
      hint: "Who do you want to talk to? Try: Rosie Jones, Mayor Fox.",
    });
  });

  it("refuses an unknown destination", () => {
    expect(interpret("go to zyx")).toEqual({
      kind: "refused",
      reason: "invalid-target",
      hint: '"zyx" is not a valid destination. Try: Kitchen, Garden, Barn, Rosie Jones, Mayor Fox.',
    });
  });

  it("refuses an unknown character", () => {
    expect(interpret("talk to zyx")).toEqual({
      kind: "refused",
      reason: "invalid-target",
      hint: '"zyx" is not a valid character. Try: Rosie Jones, Mayor Fox.',
    });
  });

  it("says so when there is nobody to talk to", () => {
    const empty: GrammarState = { ...stateFor(), characters: [] };
    expect(interpretLine("talk to", empty)).toEqual({
      kind: "refused",
      reason: "missing-target",
      hint: "Who do you want to talk to? Try: none available right now.",
    });
    expect(interpretLine("talk to rosie", empty)).toEqual({
      kind: "refused",
      reason: "invalid-target",
      hint: '"rosie" is not a valid character. Try: none available right now.',
    });
  });

  it("opens the notebook at the matching section for the list aliases", () => {
    for (const line of ["where can i go", "locations", "Locations"]) {
      expect(interpret(line)).toEqual({ kind: "view", view: "locations", section: "places" });
    }
    for (const line of ["who is here", "characters", "WHO IS HERE?"]) {
      expect(interpret(line)).toEqual({ kind: "view", view: "characters", section: "people" });
    }
  });

  it("resolves a character by first name, last name or full name", () => {
    expect(interpret("talk to rosie")).toEqual(
      action({ type: "talk", character_id: "char-rosie" }),
    );
    expect(interpret("talk to fox")).toEqual(
      action({ type: "talk", character_id: "char-mayor" }),
    );
    expect(interpret("talk to Rosie Jones")).toEqual(
      action({ type: "talk", character_id: "char-rosie" }),
    );
  });

  it("answers help in every mode with the help view", () => {
    for (const mode of MODES) {
      expect(interpret("help", mode)).toEqual({ kind: "view", view: "help", section: null });
    }
  });
});

describe("interpretLine - the notebook", () => {
  it("opens the notebook for 'notebook' and 'n' in every mode", () => {
    for (const mode of MODES) {
      for (const line of ["notebook", "Notebook", "n", "N"]) {
        expect(interpret(line, mode)).toEqual({ kind: "view", view: "notebook", section: null });
      }
    }
  });

  it("leaves the list aliases askable as questions in talk mode", () => {
    expect(interpret("who is here", "talk")).toEqual(
      action({ type: "ask", question: "who is here" }),
    );
    expect(interpret("characters", "talk")).toEqual(
      action({ type: "ask", question: "characters" }),
    );
  });
});

describe("interpretLine - hints for unrecognised lines", () => {
  it("answers an unknown command in each mode that refuses one", () => {
    expect(interpret("wander to market", "explore")).toEqual({
      kind: "refused",
      reason: "unrecognized",
      hint: EXPLORE_HINT,
    });
    expect(interpret("jump over fence", "ended")).toEqual({
      kind: "refused",
      reason: "unrecognized",
      hint: ENDED_HINT,
    });
  });

  it("answers an empty line with the mode's command list", () => {
    const expected = { explore: EXPLORE_HINT, talk: TALK_HINT, accuse: ACCUSE_HINT, ended: ENDED_HINT };
    for (const mode of MODES) {
      expect(interpret("", mode)).toEqual({
        kind: "refused",
        reason: "unrecognized",
        hint: expected[mode],
      });
      expect(interpret("   ", mode)).toEqual({
        kind: "refused",
        reason: "unrecognized",
        hint: expected[mode],
      });
    }
  });

  it("words the command list for each mode", () => {
    expect(commandHint("explore")).toBe(EXPLORE_HINT);
    expect(commandHint("talk")).toBe(TALK_HINT);
    expect(commandHint("accuse")).toBe(ACCUSE_HINT);
    expect(commandHint("ended")).toBe(ENDED_HINT);
  });

  it("no longer recognises the retired 'zoom' command in explore mode", () => {
    expect(interpret("zoom").kind).toBe("refused");
    expect(interpret("ZOOM").kind).toBe("refused");
  });

  it("does not accept movement or talk commands once the case has ended", () => {
    expect(interpret("go to kitchen", "ended")).toMatchObject({ kind: "refused", hint: ENDED_HINT });
    expect(interpret("talk to rosie", "ended")).toMatchObject({ kind: "refused", hint: ENDED_HINT });
  });
});

describe("interpretLine - location resolution for the move command", () => {
  const state: GrammarState = {
    mode: "explore",
    location: "loc-grand-library",
    locations: [
      { id: "loc-grand-library", name: "The Grand Library" },
      { id: "loc-kitchen", name: "Kitchen" },
      { id: "loc-secret-garden", name: "Secret Garden" },
    ],
    characters: [
      {
        id: "char-alice",
        first_name: "Alice",
        last_name: "Smith",
        location_name: "loc-grand-library",
      },
    ],
  };

  function destination(input: string): string | null {
    const result = interpretLine(input, state);
    return result.kind === "action" && result.action.type === "move"
      ? result.action.destination
      : null;
  }

  it("resolves by exact location ID", () => {
    expect(destination("go to loc-kitchen")).toBe("loc-kitchen");
  });

  it("resolves by full location name (case-insensitive)", () => {
    expect(destination("move to The Grand Library")).toBe("loc-grand-library");
    expect(destination("move to the grand library")).toBe("loc-grand-library");
    expect(destination("go to SECRET GARDEN")).toBe("loc-secret-garden");
  });

  it("resolves by a single word from the location name", () => {
    expect(destination("go to kitchen")).toBe("loc-kitchen");
    expect(destination("go to library")).toBe("loc-grand-library");
    expect(destination("go to garden")).toBe("loc-secret-garden");
  });

  it("strips leading 'the' for matching", () => {
    expect(destination("go to grand library")).toBe("loc-grand-library");
  });

  it("returns null for an unknown location", () => {
    expect(destination("go to dungeon")).toBeNull();
  });

  it("returns the location ID, not the name", () => {
    expect(destination("move to secret garden")).not.toBe("Secret Garden");
  });

  it("finds people when the current place is given as an id", () => {
    expect(interpretLine("talk to alice", state)).toEqual(
      action({ type: "talk", character_id: "char-alice" }),
    );
  });
});
