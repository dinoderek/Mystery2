// Saying goodbye. Walking up to someone and asking them things play from the
// case's graph (`resolve-clue-graph.ts`).

import { parseTalkEndOutput } from "../ai-contracts.ts";
import { findLocationById } from "../ai-context.ts";
import { buildRoleRequest } from "../role-request.ts";
import { createNarrationPart } from "../narration.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import { askRole } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

export async function resolveEndTalk(
  game: TurnGame,
  runtime: TurnRuntime,
  characterId: string,
): Promise<ActionOutcome> {
  const { session } = game;
  const character = game.blueprint.world.characters.find((entry) => entry.id === characterId);
  // Leaving puts the player back in the room, so the narration carries its picture.
  const location = findLocationById(game.blueprint, session.current_location_id);
  const imageId = location?.location_image_id ?? null;

  const { prompt, context } = await buildRoleRequest({
    role: "talk_end",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    character_id: characterId,
    location_id: session.current_location_id,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "end_talk", { role: "talk_end", prompt, context, parse: parseTalkEndOutput });

  return {
    event: {
      event_type: "end_talk",
      actor: "system",
      payload: {
        role: "talk_end",
        character_id: characterId,
        character_name: character?.first_name ?? characterId,
        location_id: session.current_location_id,
        location_name: location?.name ?? session.current_location_id,
        location_image_id: imageId,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER, imageId)],
      model: runtime.provider.resolvedModel,
      action: "end_talk",
      mode: session.mode,
    },
    costs_turn: false,
    resulting_mode: "explore",
    patch: { current_talk_character_id: null },
    revealed_clues: [],
    result: null,
    endgame: null,
  };
}
