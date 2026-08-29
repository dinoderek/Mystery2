import { BadRequestError } from "./errors.ts";

export type GameMode = "explore" | "talk" | "accuse" | "ended";

const GAME_MODES: readonly GameMode[] = ["explore", "talk", "accuse", "ended"];

export function isGameMode(value: unknown): value is GameMode {
  return typeof value === "string" && (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Narrows a mode read back out of storage. The column is text, so an
 * unrecognised value is possible in principle; it falls back to `explore`
 * rather than failing the request, which is what the session catalog has
 * always done with it.
 */
export function readGameMode(value: unknown): GameMode {
  return isGameMode(value) ? value : "explore";
}
export type ActionType =
  | "move"
  | "search"
  | "talk"
  | "ask"
  | "end_talk"
  | "accuse"
  | "accuse_reasoning";

export function validateTransition(
  currentMode: GameMode,
  action: ActionType,
): void {
  const validTransitions: Record<GameMode, ActionType[]> = {
    explore: ["move", "search", "talk", "accuse"],
    talk: ["ask", "end_talk"],
    accuse: ["accuse_reasoning"],
    ended: [],
  };

  if (!validTransitions[currentMode].includes(action)) {
    throw new BadRequestError(
      `Invalid action '${action}' for mode '${currentMode}'`,
    );
  }
}

export function resolveAccusationAction(currentMode: GameMode): ActionType {
  if (currentMode === "explore") {
    return "accuse";
  }

  if (currentMode === "accuse") {
    return "accuse_reasoning";
  }

  throw new BadRequestError(
    `Invalid accusation attempt while in mode '${currentMode}'`,
  );
}
