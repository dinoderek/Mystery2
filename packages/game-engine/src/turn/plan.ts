// From the grammar's action to the one the turn plays, checked against the
// mode the line was typed in. Pure: no store, no narrator.

import type { GameAction } from "../command-grammar.ts";
import type { GameSessionRow } from "../context.ts";
import { BadRequestError } from "../errors.ts";
import { validateTransition, type ActionType } from "../state-machine.ts";
import type { PlannedAction } from "./types.ts";

type PlanSession = Pick<GameSessionRow, "mode" | "current_talk_character_id">;

function talkingTo(session: PlanSession, refusal: string): string {
  if (!session.current_talk_character_id) throw new BadRequestError(refusal);
  return session.current_talk_character_id;
}

function transitionOf(action: GameAction, session: PlanSession): ActionType {
  if (action.type === "ask" && session.mode === "accuse") return "accuse_reasoning";
  return action.type;
}

/**
 * Throws `BadRequestError` when the action is not allowed in the session's
 * mode, or needs a conversation the session is not in.
 */
export function planAction(action: GameAction, session: PlanSession): PlannedAction {
  validateTransition(session.mode, transitionOf(action, session));

  switch (action.type) {
    case "move":
      return { kind: "move", destination: action.destination };
    case "search":
      return { kind: "search", query: action.query };
    case "talk":
      return { kind: "talk", character_id: action.character_id };
    case "ask":
      // In the accusation every line is reasoning, said to the narrator.
      return session.mode === "accuse"
        ? { kind: "accuse_round", reasoning: action.question }
        : { kind: "ask", question: action.question, character_id: talkingTo(session, "Not talking to anyone") };
    case "end_talk":
      return { kind: "end_talk", character_id: talkingTo(session, "No active conversation to end") };
    case "accuse":
      return action.reasoning === null
        ? { kind: "accuse_start" }
        : { kind: "accuse_round", reasoning: action.reasoning };
  }
}
