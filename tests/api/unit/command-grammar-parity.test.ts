import { describe, expect, it } from "vitest";
import { parseCommand } from "../../../web/src/lib/domain/parser.ts";
import { interpretLine } from "../../../packages/game-engine/src/command-grammar.ts";
import type { GameMode } from "../../../packages/game-engine/src/state-machine.ts";
import { BASE_GAME_STATE } from "../../testkit/src/fixtures.ts";

// The browser still parses lines itself. Until it sends them to the engine,
// both grammars must answer every line the same way, hint for hint.

const MODES: GameMode[] = ["explore", "talk", "accuse", "ended"];
const PLACES = ["Kitchen", "Barn", "loc-barn", ""];
const VERBS = [
  "", "go", "go to", "move to", "travel to", "talk to", "speak with", "search", "look",
  "look around", "inspect", "accuse", "help", "quit", "exit", "notebook", "n",
  "locations", "who is here", "characters", "bye", "goodbye", "leave", "end", "zoom",
];
const TARGETS = ["", "kitchen", "the barn", "garden", "rosie", "fox", "mayor fox", "zyx", "Under The Bed", "Why?"];

function suggestions(list: string[]): string {
  return list.length > 0 ? list.join(", ") : "none available right now";
}

type Parsed = ReturnType<typeof parseCommand>;

function expectedHint(old: Extract<Parsed, { suggestions: string[] }>): string {
  const list = suggestions(old.suggestions);
  if (old.type === "missing-target") {
    return old.commandType === "move" ? `Where to? Try: ${list}.` : `Who do you want to talk to? Try: ${list}.`;
  }
  const label = old.commandType === "move" ? "destination" : "character";
  return `"${old.attempted}" is not a valid ${label}. Try: ${list}.`;
}

describe("engine grammar and browser parser agree", () => {
  it("answers every combination of mode, place and line alike", () => {
    for (const mode of MODES) {
      for (const location of PLACES) {
        const context = {
          locations: BASE_GAME_STATE.locations,
          characters: BASE_GAME_STATE.characters,
          currentLocation: location,
        };
        const state = { mode, location, locations: context.locations, characters: context.characters };
        for (const verb of VERBS) {
          for (const target of TARGETS) {
            for (const decorate of [(t: string) => t, (t: string) => t.toUpperCase() + "."]) {
              const line = decorate(`${verb} ${target}`.trim());
              const old = parseCommand(line, mode, context);
              const next = interpretLine(line, state);
              const label = `${mode} @ ${location}: "${line}"`;
              if (old.type === "valid") {
                expect(next, label).toEqual({ kind: "action", action: old.command });
              } else if (old.type === "quit") {
                expect(next, label).toEqual({ kind: "quit" });
              } else if (old.type === "help") {
                expect(next, label).toEqual({ kind: "view", view: "help", section: null });
              } else if (old.type === "notebook") {
                expect(next, label).toMatchObject({ kind: "view", section: old.section });
              } else if (old.type === "unrecognized") {
                expect(next, label).toEqual({ kind: "refused", reason: "unrecognized", hint: old.hint });
              } else {
                expect(next, label).toEqual({ kind: "refused", reason: old.type, hint: expectedHint(old) });
              }
            }
          }
        }
      }
    }
  });
});
