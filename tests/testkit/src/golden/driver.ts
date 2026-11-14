// How a scripted line reaches the game and what comes back, for the golden
// transcripts.
//
// A driver is the one part of the harness that knows how a line of input
// becomes requests. `TurnDriver` sends each line to `game-turn` as typed and
// turns its answer into a `LineOutcome`; the screen and the golden files do not
// depend on how that happens.

import { GameTurnResponseSchema, type GameTurnResponse, type NarrationEvent } from "@my2/shared";
import { NARRATOR_SPEAKER, readSpeaker } from "../../../../web/src/lib/domain/speaker.ts";
import type { NarrationPart } from "../../../../web/src/lib/types/game.ts";

export type GameMode = "explore" | "talk" | "accuse" | "ended";

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

export interface DriverOptions {
  apiUrl: string;
  headers: HeadersInit;
  gameId: string;
  start: StartState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

/** The transcript line the browser adds when help opens. */
const HELP_NOTE = "Help menu opened.";

/**
 * An accusation made with its reasoning in one line is saved as its first
 * round, which on its own would continue the page already open. On screen it
 * opens the accusation, as `accuse` alone does.
 */
function presentedType(eventType: string, playedIn: GameMode): string {
  const isRound = eventType === "accuse_round" || eventType === "accuse_resolved";
  return isRound && playedIn === "explore" ? "accuse_start" : eventType;
}

function viewOutcome(answer: Extract<GameTurnResponse, { kind: "view" }>): LineOutcome {
  return answer.view === "help"
    ? { kind: "view", overlay: "help", section: null, echo: true, note: HELP_NOTE }
    : { kind: "view", overlay: "notebook", section: answer.section, echo: false, note: null };
}

export class TurnDriver implements GameDriver {
  private readonly options: DriverOptions;
  private mode: GameMode;
  private location: string;
  private talkingTo: string | null = null;

  constructor(options: DriverOptions) {
    this.options = options;
    this.mode = options.start.mode;
    this.location = options.start.location;
  }

  async enter(): Promise<LineOutcome> {
    const payload = await this.post("game-enter", { game_id: this.options.gameId });
    if (typeof payload.current_location === "string") this.location = payload.current_location;
    return {
      kind: "turn",
      events: [{ event_type: "move", payload: this.pagePayload("move"), narration_parts: readParts(payload) }],
      mode: this.mode,
      time_remaining: typeof payload.time_remaining === "number" ? payload.time_remaining : this.options.start.time_remaining,
      clues: [],
      result: null,
    };
  }

  async submit(line: string): Promise<LineOutcome> {
    const answer = GameTurnResponseSchema.parse(await this.post("game-turn", { game_id: this.options.gameId, input: line }));
    switch (answer.kind) {
      case "refused":
        return { kind: "refused", hint: answer.hint };
      case "view":
        return viewOutcome(answer);
      case "quit":
        this.mode = "ended";
        return { kind: "quit" };
      case "turn": {
        const playedIn = this.mode;
        this.mode = answer.state.mode;
        this.location = answer.state.location;
        this.talkingTo = answer.state.current_talk_character;
        return {
          kind: "turn",
          events: answer.events.map((event, index) => this.eventOutcome(event, index === 0 ? playedIn : null)),
          mode: answer.state.mode,
          time_remaining: answer.state.time_remaining,
          clues: answer.revealed_clues.map((clue) => ({ id: clue.id, text: clue.text })),
          result: answer.result,
        };
      }
    }
  }

  /** `playedIn` is the mode the line was typed in, for the turn's first event only. */
  private eventOutcome(event: NarrationEvent, playedIn: GameMode | null): OutcomeEvent {
    const eventType = playedIn ? presentedType(event.event_type, playedIn) : event.event_type;
    return {
      event_type: eventType,
      payload: this.pagePayload(eventType),
      narration_parts: readParts({ narration_parts: event.narration_parts }),
    };
  }

  /**
   * The naming half of an event's payload, as the browser fills it from where
   * the game stands after the turn: a page is labelled with its place or person.
   */
  private pagePayload(eventType: string): Record<string, unknown> | undefined {
    if (eventType === "talk" || eventType === "ask") {
      const character = this.options.start.characters.find((entry) => entry.id === this.talkingTo);
      return character ? { character_name: character.first_name } : undefined;
    }
    if (eventType === "move" || eventType === "end_talk") {
      const place = this.options.start.locations.find((entry) => entry.id === this.location);
      return { location_name: place?.name ?? this.location };
    }
    return undefined;
  }

  private async post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.options.apiUrl}/${endpoint}`, {
      method: "POST",
      headers: this.options.headers,
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`${endpoint} answered ${response.status}: ${await response.text()}`);
    }
    return (await response.json()) as Record<string, unknown>;
  }
}
