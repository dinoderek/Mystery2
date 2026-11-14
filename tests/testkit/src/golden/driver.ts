// How a scripted line reaches the game and what comes back, for the golden
// transcripts.
//
// A driver is the one part of the harness that knows how a line of input
// becomes requests. `BrowserDriver` does what the browser does today: it parses
// the line itself, answers refusals, `help` and `quit` without asking the
// server, and routes everything else to the endpoint that plays it. Whatever
// replaces that routing implements `GameDriver` and answers with the same
// `LineOutcome`s; the screen and the golden files do not change with it.

import { parseCommand, type ActionCommand, type GameMode, type ParseContext, type ParseResult } from "../../../../web/src/lib/domain/parser.ts";
import { NARRATOR_SPEAKER, readSpeaker } from "../../../../web/src/lib/domain/speaker.ts";
import type { NarrationPart } from "../../../../web/src/lib/types/game.ts";

/** One event the player's screen gains: its type, its page label and its lines. */
export interface OutcomeEvent {
  event_type: string;
  payload?: Record<string, unknown>;
  narration_parts: NarrationPart[];
}

export interface ClueFound {
  id: string;
  text: string;
}

export type LineOutcome =
  /** An action the game played. */
  | {
      kind: "turn";
      events: OutcomeEvent[];
      mode: GameMode;
      time_remaining: number;
      clues: ClueFound[];
      result: "win" | "lose" | null;
    }
  /** A line the game did not act on: the player reads the hint. */
  | { kind: "refused"; hint: string }
  /** An overlay opens. `note` is the transcript line that goes with it, if any. */
  | { kind: "view"; overlay: "help" | "notebook"; section: string | null; echo: boolean; note: string | null }
  /** The player left the case. */
  | { kind: "quit" };

export interface GameDriver {
  /** Step into the starting location, as the player does after reading the premise. */
  enter(): Promise<LineOutcome>;
  /** Play one line as the player typed it. */
  submit(line: string): Promise<LineOutcome>;
}

/** What `game-start` tells the browser about the case. */
export interface StartState {
  locations: Array<{ id: string; name: string }>;
  characters: Array<{ id: string; first_name: string; last_name: string; location_id: string }>;
  location: string;
  mode: GameMode;
  time_remaining: number;
}

export interface BrowserDriverOptions {
  apiUrl: string;
  headers: HeadersInit;
  gameId: string;
  start: StartState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMode(value: unknown, fallback: GameMode): GameMode {
  return value === "explore" || value === "talk" || value === "accuse" || value === "ended" ? value : fallback;
}

function suggestionsText(suggestions: string[]): string {
  return suggestions.length === 0 ? "none available right now" : suggestions.join(", ");
}

/** The hint for a `move` or `talk` with no target, in the store's wording. */
function missingTargetHint(result: Extract<ParseResult, { type: "missing-target" }>): string {
  return result.commandType === "move"
    ? `Where to? Try: ${suggestionsText(result.suggestions)}.`
    : `Who do you want to talk to? Try: ${suggestionsText(result.suggestions)}.`;
}

/** The hint for a target that is not here, in the store's wording. */
function invalidTargetHint(result: Extract<ParseResult, { type: "invalid-target" }>): string {
  const label = result.commandType === "move" ? "destination" : "character";
  return `"${result.attempted}" is not a valid ${label}. Try: ${suggestionsText(result.suggestions)}.`;
}

/** The endpoint, body and event type the browser uses for an action. */
function invocation(
  command: ActionCommand,
  mode: GameMode,
  gameId: string,
): { endpoint: string; body: Record<string, unknown>; eventType: string } {
  switch (command.type) {
    case "move":
      return { endpoint: "game-move", body: { game_id: gameId, destination: command.destination }, eventType: "move" };
    case "search":
      return { endpoint: "game-search", body: { game_id: gameId, search_query: command.query }, eventType: "search" };
    case "talk":
      return { endpoint: "game-talk", body: { game_id: gameId, character_id: command.character_id }, eventType: "talk" };
    case "ask":
      return mode === "accuse"
        ? { endpoint: "game-accuse", body: { game_id: gameId, player_reasoning: command.question }, eventType: "accuse_round" }
        : { endpoint: "game-ask", body: { game_id: gameId, player_input: command.question }, eventType: "ask" };
    case "end_talk":
      return { endpoint: "game-end-talk", body: { game_id: gameId }, eventType: "end_talk" };
    case "accuse":
      return {
        endpoint: "game-accuse",
        body: command.reasoning ? { game_id: gameId, player_reasoning: command.reasoning } : { game_id: gameId },
        eventType: "accuse_start",
      };
  }
}

function readParts(payload: Record<string, unknown>): NarrationPart[] {
  if (!Array.isArray(payload.narration_parts)) return [];
  const parts: NarrationPart[] = [];
  for (const raw of payload.narration_parts) {
    if (!isRecord(raw) || typeof raw.text !== "string" || raw.text === "") continue;
    parts.push({
      text: raw.text,
      speaker: readSpeaker(raw.speaker, NARRATOR_SPEAKER),
      image_id: typeof raw.image_id === "string" ? raw.image_id : null,
    });
  }
  return parts;
}

function readClues(raw: unknown): ClueFound[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) =>
    isRecord(entry) && typeof entry.id === "string" && typeof entry.text === "string"
      ? [{ id: entry.id, text: entry.text }]
      : [],
  );
}

export class BrowserDriver implements GameDriver {
  private readonly options: BrowserDriverOptions;
  private mode: GameMode;
  private location: string;
  private talkingTo: string | null = null;
  private timeRemaining: number;
  private readonly locations: StartState["locations"];
  /** `location_name` holds a location id, as the store keeps it. */
  private readonly characters: Array<{ id: string; first_name: string; last_name: string; location_name: string }>;

  constructor(options: BrowserDriverOptions) {
    this.options = options;
    this.mode = options.start.mode;
    this.location = options.start.location;
    this.timeRemaining = options.start.time_remaining;
    this.locations = options.start.locations;
    this.characters = options.start.characters.map((character) => ({
      id: character.id,
      first_name: character.first_name,
      last_name: character.last_name,
      location_name: character.location_id,
    }));
  }

  enter(): Promise<LineOutcome> {
    return this.call("game-enter", { game_id: this.options.gameId }, "move");
  }

  async submit(line: string): Promise<LineOutcome> {
    const context: ParseContext = {
      locations: this.locations,
      characters: this.characters,
      currentLocation: this.location,
    };
    const parsed = parseCommand(line, this.mode, context);

    switch (parsed.type) {
      case "notebook":
        return { kind: "view", overlay: "notebook", section: parsed.section, echo: false, note: null };
      case "help":
        return { kind: "view", overlay: "help", section: null, echo: true, note: "Help menu opened." };
      case "quit":
        this.mode = "ended";
        return { kind: "quit" };
      case "missing-target":
        return { kind: "refused", hint: missingTargetHint(parsed) };
      case "invalid-target":
        return { kind: "refused", hint: invalidTargetHint(parsed) };
      case "unrecognized":
        return { kind: "refused", hint: parsed.hint };
      case "valid": {
        const { endpoint, body, eventType } = invocation(parsed.command, this.mode, this.options.gameId);
        return this.call(endpoint, body, eventType);
      }
    }
  }

  private async call(endpoint: string, body: Record<string, unknown>, eventType: string): Promise<LineOutcome> {
    const response = await fetch(`${this.options.apiUrl}/${endpoint}`, {
      method: "POST",
      headers: this.options.headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${endpoint} answered ${response.status}: ${await response.text()}`);
    }
    const payload = (await response.json()) as Record<string, unknown>;
    return this.outcomeOf(payload, endpoint, eventType);
  }

  /** What the store does with a response: sync its state, then name the event's page. */
  private outcomeOf(payload: Record<string, unknown>, endpoint: string, eventType: string): LineOutcome {
    this.mode = readMode(payload.mode, endpoint === "game-accuse" ? "ended" : this.mode);

    if (typeof payload.current_location === "string") {
      this.location = payload.current_location;
      this.placeVisibleCharacters(payload.visible_characters, payload.current_location);
    }
    if (typeof payload.current_talk_character === "string" || payload.current_talk_character === null) {
      this.talkingTo = payload.current_talk_character;
    }

    if (typeof payload.time_remaining === "number") this.timeRemaining = Math.trunc(payload.time_remaining);

    const parts = readParts(payload);
    const event: OutcomeEvent = {
      event_type: eventType,
      payload: this.pagePayload(eventType),
      narration_parts: parts.length > 0 ? parts : [{ text: "Action completed.", speaker: NARRATOR_SPEAKER, image_id: null }],
    };
    const result = payload.result === "win" || payload.result === "lose" ? payload.result : null;

    return {
      kind: "turn",
      events: [event],
      mode: this.mode,
      time_remaining: this.timeRemaining,
      clues: readClues(payload.revealed_clues),
      result: endpoint === "game-accuse" && payload.mode === "ended" ? result : null,
    };
  }

  private placeVisibleCharacters(visible: unknown, location: string): void {
    if (!Array.isArray(visible)) return;
    const names = new Set(
      visible.flatMap((value) => {
        if (typeof value === "string") return [value.toLowerCase()];
        return isRecord(value) && typeof value.first_name === "string" ? [value.first_name.toLowerCase()] : [];
      }),
    );
    for (const character of this.characters) {
      if (names.has(character.first_name.toLowerCase())) character.location_name = location;
    }
  }

  /** The naming half of an event's payload, so a page is labelled with its place or person. */
  private pagePayload(eventType: string): Record<string, unknown> | undefined {
    if (eventType === "talk" || eventType === "ask") {
      const active = this.talkingTo;
      if (!active) return undefined;
      const match = this.characters.find(
        (character) => character.id === active || character.first_name.toLowerCase() === active.toLowerCase(),
      );
      return { character_name: match?.first_name ?? active };
    }
    if (eventType === "move" || eventType === "end_talk") {
      const name = this.locations.find((place) => place.id === this.location)?.name ?? this.location;
      return name ? { location_name: name } : undefined;
    }
    return undefined;
  }
}
