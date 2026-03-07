import { BadRequestError } from "./errors.ts";

export type GameMode = "explore" | "talk" | "accuse" | "ended";
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
