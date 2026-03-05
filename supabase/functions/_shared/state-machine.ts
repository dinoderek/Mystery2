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
