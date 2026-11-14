// The command grammar: what one typed line means in a given game state.
//
// Pure data in, data out. Nothing here reads a database, calls a model or
// knows about HTTP, so every rule is testable without a server.

import type { GameMode } from "./state-machine.ts";

export type NotebookSection = "story" | "places" | "people" | "clues";

/** The part of a game's state that decides what a line means. */
export interface GrammarState {
  mode: GameMode;
  /** The current place, as a name or an id. */
  location: string;
  locations: Array<{ id: string; name: string }>;
  characters: Array<{
    id: string;
    first_name: string;
    last_name: string;
    location_name: string;
  }>;
}

export type GameAction =
  | { type: "move"; destination: string }
  | { type: "search"; query: string | null }
  | { type: "talk"; character_id: string }
  | { type: "ask"; question: string }
  | { type: "accuse"; reasoning: string | null }
  | { type: "end_talk" };

export type RefusalKind = "missing-target" | "invalid-target" | "unrecognized";

export type GrammarView = "help" | "notebook" | "locations" | "characters";

/** What a typed line means. */
export type Interpretation =
  | { kind: "action"; action: GameAction }
  | { kind: "refused"; reason: RefusalKind; hint: string }
  | { kind: "view"; view: GrammarView; section: NotebookSection | null }
  | { kind: "quit" };

const MOVE_ALIASES = ["head towards", "travel to", "move to", "go to", "move", "go"] as const;
const TALK_ALIASES = ["speak with", "speak to", "talk to"] as const;
const ACCUSE_ALIASES = ["accuse"] as const;
const SEARCH_ALIASES = ["look around", "inspect", "search", "look"] as const;
const LOCATION_LIST_ALIASES = ["where can i go", "locations"] as const;
const CHARACTER_LIST_ALIASES = ["who is here", "characters"] as const;
const HELP_ALIASES = ["help"] as const;
const QUIT_ALIASES = ["quit", "exit"] as const;
const END_TALK_ALIASES = ["goodbye", "see you", "leave", "bye", "end"] as const;
const NOTEBOOK_ALIASES = ["notebook", "n"] as const;

const MODE_HINTS: Record<GameMode, string> = {
  explore:
    "Commands: move to/go to <location>, talk to <character>, search, accuse [statement], locations, characters, notebook, help, quit. Type 'help' for details.",
  talk: "Commands: <question>, bye, notebook, help, quit. Type 'help' for details.",
  accuse: "Commands: <reasoning>, notebook, help, quit. Type 'help' for details.",
  ended: "Commands: notebook, help, quit. Type 'help' for details.",
};

/** What the transcript says when help opens. */
export const HELP_NOTE = "Help menu opened.";

const TRAILING_PUNCTUATION = /[!?.,]+$/g;
const WHITESPACE = /\s+/g;

type Character = GrammarState["characters"][number];

/** The command list a mode offers, as shown for an unrecognised line and in help. */
export function commandHint(mode: GameMode): string {
  return MODE_HINTS[mode] ?? MODE_HINTS.explore;
}

export function normalizeInput(rawInput: string): string {
  return rawInput
    .trim()
    .toLowerCase()
    .replace(WHITESPACE, " ")
    .replace(TRAILING_PUNCTUATION, "")
    .trim();
}

function isAliasExact(input: string, aliases: readonly string[]): boolean {
  return aliases.includes(input);
}

function isAliasPrefix(input: string, alias: string): boolean {
  return input === alias || input.startsWith(`${alias} `);
}

function extractAliasTarget(input: string, alias: string): string {
  return input === alias ? "" : input.slice(alias.length).trim();
}

function normalizeTargetForMatch(target: string): string {
  return normalizeInput(target).replace(/^the\s+/, "").trim();
}

function displayNameOf(character: Character): string {
  return `${character.first_name} ${character.last_name}`.trim();
}

function charactersHere(state: GrammarState): Character[] {
  const current = normalizeInput(state.location);
  return state.characters.filter(
    (character) => normalizeInput(character.location_name) === current,
  );
}

function uniqueNames(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = normalizeInput(value);
    if (normalized === "" || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function movementSuggestions(state: GrammarState): string[] {
  const places = state.locations.map((location) => location.name);
  return uniqueNames([...places, ...charactersHere(state).map(displayNameOf)]);
}

function talkSuggestions(state: GrammarState): string[] {
  return uniqueNames(charactersHere(state).map(displayNameOf));
}

function resolveLocation(target: string, state: GrammarState): string | null {
  const wanted = normalizeTargetForMatch(target);
  const byId = state.locations.find((location) => location.id.toLowerCase() === wanted);
  if (byId) {
    return byId.id;
  }
  const byName = state.locations.find(
    (location) => normalizeTargetForMatch(location.name) === wanted,
  );
  if (byName) {
    return byName.id;
  }
  // Partial match: any single word of the location name.
  const byWord = state.locations.find((location) =>
    normalizeTargetForMatch(location.name).split(/\s+/).includes(wanted),
  );
  return byWord ? byWord.id : null;
}

function resolveSceneCharacter(target: string, state: GrammarState): string | null {
  const wanted = normalizeInput(target);
  for (const character of charactersHere(state)) {
    const names = [
      normalizeInput(character.first_name),
      normalizeInput(character.last_name),
      normalizeInput(displayNameOf(character)),
    ];
    if (names.includes(wanted)) {
      return character.id;
    }
  }
  return null;
}

function formatSuggestions(suggestions: string[]): string {
  return suggestions.length > 0 ? suggestions.join(", ") : "none available right now";
}

function refuse(reason: RefusalKind, hint: string): Interpretation {
  return { kind: "refused", reason, hint };
}

function act(action: GameAction): Interpretation {
  return { kind: "action", action };
}

function unrecognized(mode: GameMode): Interpretation {
  return refuse("unrecognized", commandHint(mode));
}

function missingTarget(commandType: "move" | "talk", suggestions: string[]): Interpretation {
  const list = formatSuggestions(suggestions);
  return refuse(
    "missing-target",
    commandType === "move"
      ? `Where to? Try: ${list}.`
      : `Who do you want to talk to? Try: ${list}.`,
  );
}

function invalidTarget(
  commandType: "move" | "talk",
  attempted: string,
  suggestions: string[],
): Interpretation {
  const label = commandType === "move" ? "destination" : "character";
  return refuse(
    "invalid-target",
    `"${attempted}" is not a valid ${label}. Try: ${formatSuggestions(suggestions)}.`,
  );
}

/** The text after an alias, in the player's own casing. */
function rawRemainder(rawInput: string, alias: string, fallback: string): string {
  const trimmed = rawInput.trim();
  const start = trimmed.toLowerCase().indexOf(alias) + alias.length;
  return trimmed.slice(start).trim() || fallback;
}

function interpretSearch(text: string, rawInput: string): Interpretation | null {
  for (const alias of SEARCH_ALIASES) {
    if (isAliasPrefix(text, alias)) {
      const target = extractAliasTarget(text, alias);
      return act({
        type: "search",
        query: target === "" ? null : rawRemainder(rawInput, alias, target),
      });
    }
  }
  return null;
}

function interpretMove(text: string, state: GrammarState): Interpretation | null {
  for (const alias of MOVE_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }
    const target = extractAliasTarget(text, alias);
    if (target === "") {
      return missingTarget("move", movementSuggestions(state));
    }
    const destination = resolveLocation(target, state);
    return destination
      ? act({ type: "move", destination })
      : invalidTarget("move", target, movementSuggestions(state));
  }
  return null;
}

function interpretTalk(text: string, state: GrammarState): Interpretation | null {
  for (const alias of TALK_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }
    const target = extractAliasTarget(text, alias);
    if (target === "") {
      return missingTarget("talk", talkSuggestions(state));
    }
    const characterId = resolveSceneCharacter(target, state);
    return characterId
      ? act({ type: "talk", character_id: characterId })
      : invalidTarget("talk", target, talkSuggestions(state));
  }
  return null;
}

function interpretAccuse(text: string, rawInput: string): Interpretation | null {
  for (const alias of ACCUSE_ALIASES) {
    if (!isAliasPrefix(text, alias)) {
      continue;
    }
    const target = extractAliasTarget(text, alias);
    const reasoning = target === "" ? null : rawInput.trim().slice(alias.length).trim() || target;
    return act({ type: "accuse", reasoning });
  }
  return null;
}

function interpretExplore(text: string, rawInput: string, state: GrammarState): Interpretation {
  if (text === "") {
    return unrecognized("explore");
  }
  if (isAliasExact(text, HELP_ALIASES)) {
    return { kind: "view", view: "help", section: null };
  }
  if (isAliasExact(text, QUIT_ALIASES)) {
    return { kind: "quit" };
  }
  // The list commands open the notebook section that holds the same facts.
  // Explore-only on purpose: in talk mode "who is here?" is a question.
  if (isAliasExact(text, LOCATION_LIST_ALIASES)) {
    return { kind: "view", view: "locations", section: "places" };
  }
  if (isAliasExact(text, CHARACTER_LIST_ALIASES)) {
    return { kind: "view", view: "characters", section: "people" };
  }
  return (
    interpretSearch(text, rawInput) ??
    interpretMove(text, state) ??
    interpretTalk(text, state) ??
    interpretAccuse(text, rawInput) ??
    unrecognized("explore")
  );
}

function interpretTalkMode(text: string, rawInput: string): Interpretation {
  if (text === "") {
    return unrecognized("talk");
  }
  if (isAliasExact(text, HELP_ALIASES)) {
    return { kind: "view", view: "help", section: null };
  }
  if (isAliasExact(text, QUIT_ALIASES)) {
    return { kind: "quit" };
  }
  if (isAliasExact(text, END_TALK_ALIASES)) {
    return act({ type: "end_talk" });
  }
  return act({ type: "ask", question: rawInput.trim() });
}

function interpretAccuseMode(text: string, rawInput: string): Interpretation {
  if (text === "") {
    return unrecognized("accuse");
  }
  if (isAliasExact(text, HELP_ALIASES)) {
    return { kind: "view", view: "help", section: null };
  }
  if (isAliasExact(text, QUIT_ALIASES)) {
    return { kind: "quit" };
  }
  return act({ type: "ask", question: rawInput.trim() });
}

function interpretEnded(text: string): Interpretation {
  if (isAliasExact(text, HELP_ALIASES)) {
    return { kind: "view", view: "help", section: null };
  }
  if (isAliasExact(text, QUIT_ALIASES)) {
    return { kind: "quit" };
  }
  return unrecognized("ended");
}

/** Decides what a typed line means in the given state. */
export function interpretLine(rawInput: string, state: GrammarState): Interpretation {
  const text = normalizeInput(rawInput);

  if (isAliasExact(text, NOTEBOOK_ALIASES)) {
    return { kind: "view", view: "notebook", section: null };
  }

  switch (state.mode) {
    case "explore":
      return interpretExplore(text, rawInput, state);
    case "talk":
      return interpretTalkMode(text, rawInput);
    case "accuse":
      return interpretAccuseMode(text, rawInput);
    case "ended":
      return interpretEnded(text);
    default:
      return unrecognized("explore");
  }
}
