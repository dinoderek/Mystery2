// Conversations: walking up to someone, asking them things, and saying goodbye.

import type { RevealedClue } from "../../../shared/src/mystery-api-contracts.ts";
import { parseTalkConversationOutput, parseTalkEndOutput, parseTalkStartOutput } from "../ai-contracts.ts";
import { findLocationById } from "../ai-context.ts";
import { buildDiscoveredClueIdSet } from "../clue-discovery.ts";
import { RequestRejectedError } from "../errors.ts";
import { createNarrationPart } from "../narration.ts";
import { buildRoleRequest } from "../role-request.ts";
import { createCharacterSpeaker, NARRATOR_SPEAKER } from "../speaker.ts";
import { askRole } from "./narrator.ts";
import type { ActionOutcome, TurnGame, TurnRuntime } from "./types.ts";

type Character = TurnGame["blueprint"]["world"]["characters"][number];

export interface FirstTimeReveals {
  revealed_clue_ids: string[];
  revealed_off_script: string[];
  /** The character's own clue ids the narrator re-listed though the player already holds them. */
  repeated_clue_ids: string[];
}

/**
 * Narrows the narrator's reported reveals to what this turn discovers: clues
 * the active character holds that the player has not discovered yet. A
 * character may restate a clue the player already has, but that is not a new
 * discovery. Off-script flags survive only on ids that are kept.
 */
export function selectFirstTimeReveals(
  output: { revealed_clue_ids: string[]; revealed_off_script: string[] },
  characterClueIds: Set<string>,
  discovered: Set<string>,
): FirstTimeReveals {
  const characterIds = output.revealed_clue_ids.filter((id) => characterClueIds.has(id));
  const revealed = characterIds.filter((id) => !discovered.has(id));
  const revealedSet = new Set(revealed);
  return {
    revealed_clue_ids: revealed,
    revealed_off_script: output.revealed_off_script.filter((id) => revealedSet.has(id)),
    repeated_clue_ids: characterIds.filter((id) => discovered.has(id)),
  };
}

function characterOf(game: TurnGame, characterId: string): Character {
  const character = game.blueprint.world.characters.find((entry) => entry.id === characterId);
  if (!character) throw new RequestRejectedError(500, "Character missing in blueprint", "character_missing_in_blueprint");
  return character;
}

export async function resolveTalk(game: TurnGame, runtime: TurnRuntime, characterId: string): Promise<ActionOutcome> {
  const { session } = game;
  const character = game.blueprint.world.characters.find(
    (entry) => entry.id === characterId && entry.location_id === session.current_location_id,
  );
  if (!character) {
    throw new RequestRejectedError(
      400,
      `Character ${characterId} not found in current location`,
      "character_not_found_in_location",
    );
  }

  const { prompt, context } = await buildRoleRequest({
    role: "talk_start",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    character_id: character.id,
    location_id: session.current_location_id,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "talk", { role: "talk_start", prompt, context, parse: parseTalkStartOutput });
  const portrait = character.portrait_image_id ?? null;

  return {
    event: {
      event_type: "talk",
      actor: "system",
      payload: {
        role: "talk_start",
        character_id: character.id,
        character_name: character.first_name,
        location_id: session.current_location_id,
        character_portrait_image_id: portrait,
        speaker: NARRATOR_SPEAKER,
      },
      narration_parts: [createNarrationPart(output.narration, NARRATOR_SPEAKER, portrait)],
      // Read now: a forced accusation's call would change it before the save.
      model: runtime.provider.resolvedModel,
      action: "talk",
      mode: session.mode,
    },
    costs_turn: true,
    resulting_mode: "talk",
    patch: { current_talk_character_id: character.id },
    revealed_clues: [],
    result: null,
    endgame: {
      scene_summary: `The investigator approached ${character.first_name} to talk, and that last moment used up all remaining time.`,
      payload: {
        character_id: character.id,
        character_name: character.first_name,
        location_id: session.current_location_id,
      },
    },
  };
}

function talkRecords(character: Character, reveals: FirstTimeReveals): RevealedClue[] {
  const characterName = `${character.first_name} ${character.last_name}`.trim();
  return reveals.revealed_clue_ids.map((id) => ({
    id,
    text: character.clues.find((clue) => clue.id === id)?.text ?? "",
    source: "talk" as const,
    origin: { kind: "character" as const, character_id: character.id, character_name: characterName },
    discovered_at: new Date().toISOString(),
    off_script: reveals.revealed_off_script.includes(id),
  }));
}

export async function resolveAsk(
  game: TurnGame,
  runtime: TurnRuntime,
  ask: { character_id: string; question: string },
): Promise<ActionOutcome> {
  const { session } = game;
  const character = characterOf(game, ask.character_id);
  const speaker = createCharacterSpeaker(character.first_name);

  const { prompt, context } = await buildRoleRequest({
    role: "talk_conversation",
    game_id: game.game_id,
    session,
    blueprint: game.blueprint,
    character_id: character.id,
    player_input: ask.question,
    location_id: session.current_location_id,
    conversation_history: game.history,
  });
  const output = await askRole(runtime, "ask", {
    role: "talk_conversation",
    prompt,
    context,
    parse: parseTalkConversationOutput,
  });

  // An off-script reveal is still a real discovery; only kept ids carry the flag.
  const reveals = selectFirstTimeReveals(
    output,
    new Set(character.clues.map((clue) => clue.id)),
    buildDiscoveredClueIdSet(game.history),
  );
  if (reveals.repeated_clue_ids.length > 0) {
    runtime.logger.log("ask.clue_already_discovered", {
      game_id: game.game_id,
      character_id: character.id,
      clue_ids: reveals.repeated_clue_ids,
    });
  }

  return {
    event: {
      event_type: "ask",
      actor: "system",
      payload: {
        role: "talk_conversation",
        character_id: character.id,
        character_name: character.first_name,
        location_id: session.current_location_id,
        player_input: ask.question,
        character_portrait_image_id: character.portrait_image_id ?? null,
        speaker,
        revealed_clue_ids: reveals.revealed_clue_ids,
        revealed_off_script: reveals.revealed_off_script,
        input_understood: output.input_understood,
      },
      narration_parts: [createNarrationPart(output.narration, speaker, null)],
      model: runtime.provider.resolvedModel,
      action: "ask",
      mode: session.mode,
    },
    costs_turn: false,
    resulting_mode: "talk",
    patch: { discovered_clues: [...new Set([...session.discovered_clues, ...reveals.revealed_clue_ids])] },
    revealed_clues: talkRecords(character, reveals),
    result: null,
    endgame: null,
  };
}

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
