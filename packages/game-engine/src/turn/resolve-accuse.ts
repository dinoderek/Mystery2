// The accusation: the narrator sets the scene, then judges each round of the
// investigator's reasoning until it is won, lost, or goes on. On a clue-graph
// case the engine decides each round instead.

import {
  parseAccusationJudgeOutput,
  parseAccusationStartOutput,
  parseGraphAccusationOutput,
  parseGraphAccusationRoundOutput,
  parseGraphEndingOutput,
} from "../ai-contracts.ts";
import { decideAccusation, resolves, type SavedAccusation } from "../clue-graph/accusation.ts";
import { playOf } from "../clue-graph/history.ts";
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
  if (game.blueprint.clue_graph) return resolveGraphAccuseRound(game, runtime, reasoning);
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

/**
 * A clue-graph round (`clue-graph/accusation.ts`): the narrator reports who was
 * named and what was cited, the engine decides, and the narrator words it, as
 * a round given only what the investigator holds or as the closing scene. A
 * report naming someone or something the case does not offer fails the turn.
 */
async function resolveGraphAccuseRound(game: TurnGame, runtime: TurnRuntime, reasoning: string): Promise<ActionOutcome> {
  const graph = game.blueprint.clue_graph!;
  const session = accusing(game);
  const play = playOf(graph, game.history);
  const judge = await buildRoleRequest({
    role: "graph_accusation",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    player_input: reasoning,
    conversation_history: game.history,
  });
  const report = await askRole(runtime, "accuse_reasoning", {
    role: "graph_accusation",
    prompt: judge.prompt,
    context: judge.context,
    parse: parseGraphAccusationOutput,
  });
  const accused = report.accused_character_id;
  const unknown = [
    ...(accused !== null && !Object.hasOwn(graph.characters, accused) ? [accused] : []),
    ...report.cited_clue_ids.filter((id) => !play.held.includes(id)),
  ];
  if (unknown.length > 0) {
    rejectOutput(runtime, "accuse_reasoning", "Clue-graph accusation named what the case does not offer", { ids: unknown });
  }

  const saved: SavedAccusation = {
    accused,
    cited: report.cited_clue_ids,
    verdict: decideAccusation(graph, play, game.history, { accused, cited: report.cited_clue_ids }),
  };
  const ended = resolves(saved.verdict);
  const role = ended ? "graph_ending" : "graph_accusation_round";
  const { prompt, context } = await buildRoleRequest({
    role,
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    player_input: reasoning,
    verdict: saved.verdict,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "accuse_reasoning", {
    role,
    prompt,
    context,
    parse: ended ? parseGraphEndingOutput : parseGraphAccusationRoundOutput,
  });
  const result = ended ? (saved.verdict as "win" | "lose") : null;

  return {
    event: {
      event_type: ended ? "accuse_resolved" : "accuse_round",
      actor: "system",
      payload: {
        role,
        player_reasoning: reasoning,
        judge_result: result ?? "continue",
        clue_graph_accusation: saved,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER)],
      model: runtime.provider.resolvedModel,
      action: "accuse_reasoning",
      mode: "accuse",
    },
    costs_turn: false,
    resulting_mode: ended ? "ended" : "accuse",
    patch: { outcome: result, current_talk_character_id: null },
    revealed_clues: [],
    result,
    endgame: null,
  };
}
