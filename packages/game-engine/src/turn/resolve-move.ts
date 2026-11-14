// Moving: the narrator describes the place arrived at, and who is there.

import { RequestRejectedError } from "../errors.ts";
import { createNarrationPart } from "../narration.ts";
import { buildNarrationPrompt } from "../role-request.ts";
import { NARRATOR_SPEAKER } from "../speaker.ts";
import { narrate } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

export async function resolveMove(
  game: TurnGame,
  runtime: TurnRuntime,
  destination: string,
): Promise<ActionOutcome> {
  const place = game.blueprint.world.locations.find((location) => location.id === destination);
  if (!place) throw new RequestRejectedError(400, "Invalid destination", "invalid_destination");

  // The arrival prompt reads everything else from the history: whether this is
  // a return visit, what happened here, and who is present.
  const prompt = buildNarrationPrompt({
    role: "ambience",
    game_id: game.game_id,
    blueprint: game.blueprint,
    destination_id: place.id,
    conversation_history: game.history,
  });
  const narration = await narrate(runtime, "move", prompt);
  const imageId = place.location_image_id ?? null;

  return {
    event: {
      event_type: "move",
      actor: "system",
      payload: {
        destination: place.id,
        location_id: place.id,
        location_name: place.name,
        location_image_id: imageId,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(narration, NARRATOR_SPEAKER, imageId)],
      // Read now: a forced accusation's call would change it before the save.
      model: runtime.provider.resolvedModel,
      action: "move",
      mode: game.session.mode,
    },
    costs_turn: true,
    resulting_mode: "explore",
    patch: { current_location_id: place.id, current_talk_character_id: null },
    revealed_clues: [],
    result: null,
    endgame: {
      scene_summary: `The investigator moved to ${place.name}, and that final movement exhausted all remaining time.`,
      location_id: place.id,
      payload: { location_id: place.id, location_name: place.name, location_image_id: imageId },
    },
  };
}
