// Shared action/role map — the single source of truth both backends use to
// turn a case's `action` (+ fixed `given` state and history) into either a
// reconstructed prompt (CLI backend) or an endpoint call (endpoint backend).
//
// A case evaluates exactly ONE action against a fully-specified prior state, so
// the input is deterministic and identical across models. There is no turn
// accumulation here — `given.history` is the complete, fixed conversation.

export function characterFirstName(blueprint, characterId) {
  return blueprint.world.characters.find((c) => c.id === characterId)?.first_name ?? characterId;
}
export function locationName(blueprint, locationId) {
  return blueprint.world.locations.find((l) => l.id === locationId)?.name ?? locationId;
}

export function narratorSpeaker() {
  return { kind: "narrator", key: "narrator", label: "Narrator" };
}
export function characterSpeaker(firstName) {
  return { kind: "character", key: `character:${String(firstName).toLowerCase()}`, label: firstName };
}

/** SessionSnapshot the context builders expect, derived from `given`. */
export function snapshotFromGiven(given) {
  return {
    mode: given.mode,
    current_location_id: given.location_id,
    current_talk_character_id: given.talk_character_id ?? null,
    time_remaining: given.time_remaining,
  };
}

// Each action maps to:
//   requiredMode  — session mode the action is valid from (also what we seed)
//   cli           — how to replay it locally (role + context builder + vars + speaker).
//                   Absent for actions whose runtime prompt we don't replay yet.
//   endpoint      — how to call the live function (name, method, body builder).
export const ACTIONS = {
  talk: {
    requiredMode: "explore",
    endpoint: { name: "game-talk", method: "POST", body: (g, a, gid) => ({ game_id: gid, character_id: a.character_id }) },
    cli: {
      role: "talk_start",
      builder: "buildTalkStartContext",
      promptVars: (g, a, bp) => ({
        character_name: characterFirstName(bp, a.character_id),
        location_name: locationName(bp, g.location_id),
        target_age: bp.metadata.target_age,
      }),
      contextInput: (g, a, bp, history) => ({
        game_id: "case",
        session: snapshotFromGiven(g),
        blueprint: bp,
        character_id: a.character_id,
        location_id: g.location_id,
        conversation_history: history,
      }),
      speaker: () => narratorSpeaker(),
    },
  },

  ask: {
    requiredMode: "talk",
    endpoint: { name: "game-ask", method: "POST", body: (g, a, gid) => ({ game_id: gid, player_input: a.player_input }) },
    cli: {
      role: "talk_conversation",
      builder: "buildTalkConversationContext",
      promptVars: (g, a, bp) => ({
        character_name: characterFirstName(bp, g.talk_character_id),
        player_input: a.player_input,
        target_age: bp.metadata.target_age,
      }),
      contextInput: (g, a, bp, history) => ({
        game_id: "case",
        session: snapshotFromGiven(g),
        blueprint: bp,
        character_id: g.talk_character_id,
        player_input: a.player_input,
        location_id: g.location_id,
        conversation_history: history,
      }),
      speaker: (g, a, bp) => characterSpeaker(characterFirstName(bp, g.talk_character_id)),
    },
  },

  move: {
    requiredMode: "explore",
    endpoint: { name: "game-move", method: "POST", body: (g, a, gid) => ({ game_id: gid, destination: a.destination }) },
  },

  search: {
    requiredMode: "explore",
    endpoint: { name: "game-search", method: "POST", body: (g, a, gid) => ({ game_id: gid }) },
  },

  accuse: {
    requiredMode: "accuse",
    endpoint: {
      name: "game-accuse",
      method: "POST",
      body: (g, a, gid) => ({
        game_id: gid,
        player_reasoning: a.player_reasoning,
        ...(a.accusation_history_mode ? { accusation_history_mode: a.accusation_history_mode } : {}),
      }),
    },
  },
};

export function getAction(type) {
  const action = ACTIONS[type];
  if (!action) {
    throw new Error(`Unknown action type "${type}". Known: ${Object.keys(ACTIONS).join(", ")}`);
  }
  return action;
}

/**
 * Normalize a case's `given.history` into ConversationFragment / game_events
 * rows: assign sequential `sequence` when omitted and default actor to "system".
 */
export function normalizeHistory(history) {
  return (history ?? []).map((entry, i) => ({
    sequence: entry.sequence ?? i + 1,
    event_type: entry.event_type,
    actor: entry.actor ?? "system",
    narration: entry.narration ?? "",
    payload: entry.payload ?? {},
  }));
}
