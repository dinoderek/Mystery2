// The accusation: the narrator sets the scene, then judges each round of the
// investigator's reasoning until it is won, lost, or goes on.

import { parseAccusationJudgeOutput, parseAccusationStartOutput } from "../ai-contracts.ts";
import { createNarrationPart } from "../narration.ts";
import { buildRoleRequest } from "../role-request.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import { askRole, rejectOutput } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

/** The session as the narrator sees it once the accusation is under way. */
function accusing(game: TurnGame) {
  return { ...game.session, mode: "accuse" as const, current_talk_character_id: null };
}

export async function resolveAccuseStart(game: TurnGame, runtime: TurnRuntime): Promise<ActionOutcome> {
  const { prompt, context } = await buildRoleRequest({
    role: "accusation_start",
    game_id: game.game_id,
    session: accusing(game),
    blueprint: game.blueprint,
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
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
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

export async function resolveAccuseRound(
  game: TurnGame,
  runtime: TurnRuntime,
  reasoning: string,
): Promise<ActionOutcome> {
  const round = game.history.filter((entry) => entry.event_type === "accuse_round").length;
  const { prompt, context } = await buildRoleRequest({
    role: "accusation_judge",
    game_id: game.game_id,
    session: accusing(game),
    blueprint: game.blueprint,
    player_input: reasoning,
    round,
    conversation_history: game.history,
    history_mode: "all",
  });
  const output = await askRole(runtime, "accuse_reasoning", {
    role: "accusation_judge",
    prompt,
    context: { ...context, round },
    parse: parseAccusationJudgeOutput,
  });

  const resolution = output.accusation_resolution;
  if (resolution !== "continue" && resolution !== "win" && resolution !== "lose") {
    rejectOutput(runtime, "accuse_reasoning", "Terminal accusation response with invalid resolution");
  }
  const ended = resolution !== "continue";

  return {
    event: {
      event_type: ended ? "accuse_resolved" : "accuse_round",
      actor: "system",
      payload: {
        role: "accusation_judge",
        player_reasoning: reasoning,
        judge_result: resolution,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
      model: runtime.provider.resolvedModel,
      action: "accuse_reasoning",
      mode: "accuse",
    },
    costs_turn: false,
    resulting_mode: ended ? "ended" : "accuse",
    patch: { outcome: ended ? resolution : null, current_talk_character_id: null },
    revealed_clues: [],
    result: ended ? resolution : null,
    endgame: null,
  };
}
