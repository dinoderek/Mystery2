// The shapes a turn passes between its steps.

import type { BlueprintV2 } from "../../../shared/src/blueprint-schema-v2.ts";
import type { RevealedClue } from "../../../shared/src/mystery-api-contracts.ts";
import type { AIProvider } from "../ai-provider.ts";
import type { GameEventRow, GameSessionPatch, GameSessionRow } from "../context.ts";
import type { LogWriter } from "../logging.ts";
import type { NarrationPart } from "../narration.ts";
import type { GameMode } from "../state-machine.ts";

/** The game as the turn found it. */
export interface TurnGame {
  game_id: string;
  session: GameSessionRow;
  blueprint: BlueprintV2;
  /** The events the game master took part in so far, in sequence order. */
  history: GameEventRow[];
  /** The sequence the next saved event takes, counting every event saved. */
  next_sequence: number;
}

/** What a turn needs to call the narrator and log. */
export interface TurnRuntime {
  req: Request;
  request_id: string;
  game_id: string;
  provider: AIProvider;
  logger: LogWriter;
}

/** The action a typed line asked for, checked against the mode it was typed in. */
export type PlannedAction =
  | { kind: "move"; destination: string }
  | { kind: "search"; query: string | null }
  | { kind: "talk"; character_id: string }
  | { kind: "ask"; question: string; character_id: string }
  | { kind: "end_talk"; character_id: string }
  | { kind: "accuse_start" }
  | { kind: "accuse_round"; reasoning: string };

/** How the narrator sets the accusation scene when this action spends the last turn. */
export interface EndgameScene {
  scene_summary: string;
  /** Where the investigator stands once the action has happened, when it moved them. */
  location_id?: string;
  /** What the forced accusation's event records about where it happened. */
  payload: Record<string, unknown>;
}

/** The event an action saves, before the turn's cost and diagnostics are known. */
export interface ActionEvent {
  event_type: string;
  actor: string;
  payload: Record<string, unknown>;
  narration_parts: NarrationPart[];
  model: string | null;
  /** The action the diagnostics name. */
  action: string;
  /** The mode the diagnostics say the action was played in. */
  mode: GameMode;
}

/** What resolving one action produced: the narration and the action's own change. */
export interface ActionOutcome {
  event: ActionEvent;
  costs_turn: boolean;
  /** The mode after the action, unless spending the last turn forces the accusation. */
  resulting_mode: GameMode;
  /** The action's own change to the session; the turn adds the cost and the mode. */
  patch: GameSessionPatch;
  revealed_clues: RevealedClue[];
  result: "win" | "lose" | null;
  /** Present for the actions that cost a turn. */
  endgame: EndgameScene | null;
}

/** The narration of an accusation forced by the last turn running out. */
export interface ForcedEndgame {
  narration_parts: NarrationPart[];
  model: string | null;
}
