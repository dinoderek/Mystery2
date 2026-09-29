// What one line of player input does, decided the way the browser decides it.
//
// Parsing is the UI's own parser (web/src/lib/domain/parser.ts), imported as is.
// Routing a parsed command to an endpoint mirrors `getBackendInvocation` in
// web/src/lib/domain/store.svelte.ts, including its one subtlety: free text in
// accuse mode parses as `ask` but goes to game-accuse as reasoning. Hints for
// missing, invalid and unrecognised commands use the store's exact wording.
// Three lines differ, because the browser answers them with a screen rather
// than text: `help` opens a modal of commands (here: the mode's command list),
// `notebook` opens the notebook (here: already in every view), and theme
// commands change colours. The store does not echo `notebook` or theme lines
// into the transcript, and neither does this (`echo: false`).

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

/** The command list the help modal shows, as the parser words it per mode. */
function commandList(state) {
  return parseCommand("", state.mode, parseContextOf(state)).hint;
}

/**
 * Turns input into one of:
 *   { kind: "call", endpoint, body, command }   a request to the game API
 *   { kind: "feedback", text, parsed, echo }    what the UI shows instead; no turn
 *   { kind: "quit" }                            the player stopped
 */
export function resolveInput(input, state, gameId) {
  const parsed = parseCommand(input, state.mode, parseContextOf(state));

  switch (parsed.type) {
    case "valid":
      return { kind: "call", command: parsed.command, ...invocation(parsed.command, state, gameId) };
    case "quit":
      return { kind: "quit" };
    case "help":
      return { kind: "feedback", parsed, echo: true, text: `Help menu opened. ${commandList(state)}` };
    case "notebook":
      return {
        kind: "feedback",
        parsed,
        echo: false,
        text: "(The notebook opens: it is the NOTEBOOK sections of your view.)",
      };
    case "theme-list":
    case "theme-set":
      return { kind: "feedback", parsed, echo: false, text: "(Theme commands only change the colours.)" };
    case "missing-target":
      return {
        kind: "feedback",
        parsed,
        echo: true,
        text: parsed.commandType === "move"
          ? `Where to? Try: ${formatSuggestions(parsed.suggestions)}.`
          : `Who do you want to talk to? Try: ${formatSuggestions(parsed.suggestions)}.`,
      };
    case "invalid-target":
      return {
        kind: "feedback",
        parsed,
        echo: true,
        text: `"${parsed.attempted}" is not a valid ${
          parsed.commandType === "move" ? "destination" : "character"
        }. Try: ${formatSuggestions(parsed.suggestions)}.`,
      };
    case "unrecognized":
      return { kind: "feedback", parsed, echo: true, text: parsed.hint };
    default:
      return { kind: "feedback", parsed, echo: true, text: "Unable to parse command." };
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
