// The accusation (`docs/game.md`, "The accusation"): the narrator sets the
// scene, `back` leaves it for nothing, and each line of reasoning is one
// accusation, judged once. A win or the last failure ends the case; any other
// failure spends one and returns to exploring, or, out of turns, asks again.
// The engine decides each accusation from the case's graph.

import { parseAccusationStartOutput, parseGraphAccusationOutput } from "../ai-contracts.ts";
import {
  ACCUSE_BACK,
  ACCUSE_FAILED,
  ACCUSE_RESOLVED,
  accusationRuleLine,
  accusationsLeft,
} from "../accusations.ts";
import { judgeReport, replyKindOf } from "../clue-graph/accusation.ts";
import { createNarrationPart } from "../narration.ts";
import { buildRoleRequest } from "../role-request.ts";
import type { GameMode } from "../state-machine.ts";
import { NARRATOR_SPEAKER, SYSTEM_SPEAKER } from "../speaker.ts";
import { askRole, rejectOutput } from "./narrator.ts";
import type { ActionOutcome, ActionEvent, TurnGame, TurnRuntime } from "./types.ts";

/** The session as the narrator sees it once the accusation is under way. */
function accusing(game: TurnGame) {
  return { ...game.session, mode: "accuse" as const, current_talk_character_id: null };
}

/** The rule, told on the scene a player opens with `accuse`, where `back` is free. */
function ruleLine(game: TurnGame) {
  return createNarrationPart(accusationRuleLine(accusationsLeft(game.history), false), SYSTEM_SPEAKER);
}

export async function resolveAccuseStart(game: TurnGame, runtime: TurnRuntime): Promise<ActionOutcome> {
  const { prompt, context } = await buildRoleRequest({
    role: "accusation_start",
    game_id: game.game_id,
    session: accusing(game),
    blueprint: game.blueprint,
    reading_age: game.reading_age,
    conversation_history: game.history,
    history_mode: "all",
  });
  const output = await askRole(runtime, "accuse_start", {
    role: "accusation_start",
    prompt,
    context,
    parse: parseAccusationStartOutput,
  });

  return {
    event: {
      event_type: "accuse_start",
      actor: "player",
      payload: { role: "accusation_start", trigger: "player", speaker: NARRATOR_SPEAKER },
      narration_parts: [
        createNarrationPart(output.narration, NARRATOR_SPEAKER),
        ruleLine(game),
      ],
      model: runtime.provider.resolvedModel,
      action: "accuse_start",
      mode: game.session.mode,
    },
    costs_turn: false,
    resulting_mode: "accuse",
    patch: { current_talk_character_id: null },
    revealed_clues: [],
    result: null,
    endgame: null,
  };
}

/** What the player reads on `back`: the engine's line, not the narrator's. */
export const BACK_LINE = "You put the accusation aside and go back to investigating. Nothing is spent.";

/** `back` out of the scene: nothing is spent and play returns to exploring. */
export function resolveAccuseBack(): ActionOutcome {
  return {
    event: {
      event_type: ACCUSE_BACK,
      actor: "player",
      payload: { trigger: "player", speaker: SYSTEM_SPEAKER },
      narration_parts: [createNarrationPart(BACK_LINE, SYSTEM_SPEAKER)],
      model: null,
      action: "accuse_back",
      mode: "accuse",
    },
    costs_turn: false,
    resulting_mode: "explore",
    patch: { current_talk_character_id: null },
    revealed_clues: [],
    result: null,
    endgame: null,
  };
}

/** How the game goes on after a judged accusation: ended, or back to exploring unless out of turns. */
function afterAccusation(game: TurnGame, result: "win" | "lose" | null): GameMode {
  if (result) return "ended";
  return game.session.time_remaining === 0 ? "accuse" : "explore";
}

/**
 * One judged accusation, as saved: a failure is `accuse_failed`, with the kind
 * of reply it gave (null until a format picks one); a win or a loss is
 * `accuse_resolved`.
 */
function judgedOutcome(
  game: TurnGame,
  result: "win" | "lose" | null,
  event: Omit<ActionEvent, "event_type" | "actor" | "action" | "mode">,
): ActionOutcome {
  const mode = afterAccusation(game, result);
  return {
    event: {
      ...event,
      event_type: result ? ACCUSE_RESOLVED : ACCUSE_FAILED,
      actor: "system",
      payload: result ? event.payload : { reply_kind: null, ...event.payload },
      action: "accuse_reasoning",
      mode: "accuse",
    },
    costs_turn: false,
    resulting_mode: mode,
    patch: { outcome: result, current_talk_character_id: null },
    revealed_clues: [],
    result,
    endgame: null,
  };
}

/**
 * An accusation (`clue-graph/accusation.ts`): the narrator reports who was
 * named and what was cited, the engine decides, and the narrator words it, as
 * a failure given only what the investigator holds or as the closing scene. A
 * report naming someone the case does not hold fails the turn; a cited clue
 * the player does not hold is dropped.
 */
export async function resolveAccusation(game: TurnGame, runtime: TurnRuntime, reasoning: string): Promise<ActionOutcome> {
  const session = accusing(game);
  const judge = await buildRoleRequest({
    role: "graph_accusation",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    reading_age: game.reading_age,
    player_input: reasoning,
    conversation_history: game.history,
  });
  const report = await askRole(runtime, "accuse_reasoning", {
    role: "graph_accusation",
    prompt: judge.prompt,
    context: judge.context,
    parse: parseGraphAccusationOutput,
  });
  const judged = judgeReport(game.blueprint.clue_graph, game.history, report);
  if (!judged) {
    rejectOutput(runtime, "accuse_reasoning", "Clue-graph accusation named someone the case does not hold", {
      accused: report.accused_character_id,
    });
  }
  // A clue the player does not hold cannot be cited: it is dropped, as a restated reveal is.
  if (judged.notHeld.length > 0) {
    runtime.logger.log("accusation.cited_not_held", { game_id: game.game_id, clue_ids: judged.notHeld });
  }
  const { saved, result, reply, parse } = judged;
  const { prompt, context } = await buildRoleRequest({
    ...reply,
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    reading_age: game.reading_age,
    player_input: reasoning,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "accuse_reasoning", { role: reply.role, prompt, context, parse });

  return judgedOutcome(game, result, {
    payload: {
      role: reply.role,
      player_reasoning: reasoning,
      judge_result: result ?? "continue",
      clue_graph_accusation: saved,
      ...(result ? {} : { reply_kind: replyKindOf(context) }),
      speaker: NARRATOR_SPEAKER,
    },
    narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
    model: runtime.provider.resolvedModel,
  });
}
