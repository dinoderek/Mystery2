// What one line of player input does, decided the way the browser decides it.
//
// Parsing is the UI's own parser (web/src/lib/domain/parser.ts), imported as is.
// Routing a parsed command to an endpoint mirrors `getBackendInvocation` in
// web/src/lib/domain/store.svelte.ts, including its one subtlety: free text in
// accuse mode parses as `ask` but goes to game-accuse as reasoning. The
// feedback wording mirrors the store's `format*Message` helpers.

import { parseCommand } from "../../../web/src/lib/domain/parser.ts";

/** The parser's context, built from game state the way the store builds it. */
export function parseContextOf(state) {
  return {
    locations: state.locations.map((location) => ({ id: location.id, name: location.name })),
    characters: state.characters.map((character) => ({
      id: character.id,
      first_name: character.first_name,
      last_name: character.last_name,
      location_name: character.location_name || character.location_id,
    })),
    currentLocation: state.location,
  };
}

function formatSuggestions(suggestions) {
  return suggestions.length > 0 ? suggestions.join(", ") : "none available right now";
}

/**
 * Turns input into one of:
 *   { kind: "call", endpoint, body, command }  a request to the game API
 *   { kind: "feedback", text, parsed }         what the UI prints instead; no turn
 *   { kind: "quit" }                           the player stopped
 */
export function resolveInput(input, state, gameId) {
  const parsed = parseCommand(input, state.mode, parseContextOf(state));

  switch (parsed.type) {
    case "valid":
      return { kind: "call", command: parsed.command, ...invocation(parsed.command, state, gameId) };
    case "quit":
      return { kind: "quit" };
    case "help":
      return { kind: "feedback", parsed, text: "Help menu opened." };
    case "notebook":
      return {
        kind: "feedback",
        parsed,
        text: "Your notebook is already shown to you each turn; opening it costs nothing.",
      };
    case "theme-list":
    case "theme-set":
      return { kind: "feedback", parsed, text: "Themes only change colours." };
    case "missing-target":
      return {
        kind: "feedback",
        parsed,
        text: parsed.commandType === "move"
          ? `Where to? Try: ${formatSuggestions(parsed.suggestions)}.`
          : `Who do you want to talk to? Try: ${formatSuggestions(parsed.suggestions)}.`,
      };
    case "invalid-target":
      return {
        kind: "feedback",
        parsed,
        text: `"${parsed.attempted}" is not a valid ${
          parsed.commandType === "move" ? "destination" : "character"
        }. Try: ${formatSuggestions(parsed.suggestions)}.`,
      };
    case "unrecognized":
      return { kind: "feedback", parsed, text: parsed.hint };
    default:
      return { kind: "feedback", parsed, text: "Unable to parse command." };
  }
}

function invocation(command, state, gameId) {
  switch (command.type) {
    case "move":
      return { endpoint: "game-move", body: { game_id: gameId, destination: command.destination } };
    case "search":
      return { endpoint: "game-search", body: { game_id: gameId, search_query: command.query } };
    case "talk":
      return { endpoint: "game-talk", body: { game_id: gameId, character_id: command.character_id } };
    case "ask":
      return state.mode === "accuse"
        ? { endpoint: "game-accuse", body: { game_id: gameId, player_reasoning: command.question } }
        : { endpoint: "game-ask", body: { game_id: gameId, player_input: command.question } };
    case "end_talk":
      return { endpoint: "game-end-talk", body: { game_id: gameId } };
    case "accuse":
      return {
        endpoint: "game-accuse",
        body: command.reasoning
          ? { game_id: gameId, player_reasoning: command.reasoning }
          : { game_id: gameId },
      };
    default:
      throw new Error(`Unsupported command ${JSON.stringify(command)}`);
  }
}
