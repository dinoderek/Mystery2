// Shared action map — how a case's `action` (+ fixed `given` state and history)
// becomes either an endpoint call or a local prompt replay.
//
// A case evaluates exactly ONE action against a fully-specified prior state, so
// the input is deterministic and identical across models. There is no turn
// accumulation here — `given.history` is the complete, fixed conversation.
//
// Role resolution and prompt assembly are NOT here: they live in
// supabase/functions/_shared/role-request.ts, shared with the Edge Function
// handlers, so both paths pick the same role and build the same prompt.

import {
  resolveAccusationRole,
  resolveSearchRole,
} from "../../../supabase/functions/_shared/role-request.ts";

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
//   requiredMode  — session mode the action is valid from (also what we seed);
//                   null for an action that has no prior state
//   createsSession — true when the endpoint CREATES the session rather than
//                   acting on a seeded one (`start` only). The endpoint backend
//                   skips seeding and the body identifies the blueprint instead
//                   of a game id.
//   endpoint      — how to call the live function (name, method, body builder).
//                   body(given, action, gameId, { blueprint, aiProfile })
//   roleInput     — the RoleRequestInput for the local (CLI) replay of the same
//                   turn, built from the case's fixed `given` + `action`
//   speaker       — who the resulting narration is attributed to
//
// `roleInput` deliberately carries NO prompt or context logic: it names the role
// and hands over the same fields the handler would, and
// supabase/functions/_shared/role-request.ts does the assembly for both. The
// per-action `cli` blocks that used to live here duplicated that assembly and
// drifted out of sync with the handlers (see prompt-build.mjs).
export const ACTIONS = {
  // The opening narration. Unlike every other action there is no prior state to
  // seed: game-start creates the session, so `given` is empty and the endpoint
  // body names the blueprint rather than a game.
  start: {
    requiredMode: null,
    createsSession: true,
    endpoint: {
      name: "game-start",
      method: "POST",
      body: (g, a, gid, extra) => ({
        blueprint_id: extra.blueprint.id,
        ai_profile: extra.aiProfile,
      }),
    },
    roleInput: (g, a, bp) => ({
      role: "intro",
      game_id: "case",
      blueprint: bp,
      conversation_history: [],
    }),
    speaker: () => narratorSpeaker(),
  },

  talk: {
    requiredMode: "explore",
    endpoint: { name: "game-talk", method: "POST", body: (g, a, gid) => ({ game_id: gid, character_id: a.character_id }) },
    roleInput: (g, a, bp, history) => ({
      role: "talk_start",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: a.character_id,
      location_id: g.location_id,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  ask: {
    requiredMode: "talk",
    endpoint: { name: "game-ask", method: "POST", body: (g, a, gid) => ({ game_id: gid, player_input: a.player_input }) },
    roleInput: (g, a, bp, history) => ({
      role: "talk_conversation",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: g.talk_character_id,
      location_id: g.location_id,
      player_input: a.player_input,
      conversation_history: history,
    }),
    speaker: (g, a, bp) => characterSpeaker(characterFirstName(bp, g.talk_character_id)),
  },

  end_talk: {
    requiredMode: "talk",
    endpoint: { name: "game-end-talk", method: "POST", body: (g, a, gid) => ({ game_id: gid }) },
    roleInput: (g, a, bp, history) => ({
      role: "talk_end",
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      character_id: g.talk_character_id,
      location_id: g.location_id,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  move: {
    requiredMode: "explore",
    endpoint: { name: "game-move", method: "POST", body: (g, a, gid) => ({ game_id: gid, destination: a.destination }) },
    roleInput: (g, a, bp, history) => ({
      role: "ambience",
      game_id: "case",
      blueprint: bp,
      destination_id: a.destination,
      // The handler derives these from the destination's own history; a case
      // fixes the history, so derive them the same way from `given`.
      has_visited_before: history.some(
        (e) => (e.payload?.location_id ?? e.payload?.destination) === a.destination,
      ),
      destination_history_json: JSON.stringify(
        history.filter(
          (e) => (e.payload?.location_id ?? e.payload?.destination) === a.destination,
        ),
      ),
      destination_characters_json: JSON.stringify(
        (bp.world.characters ?? [])
          .filter((c) => c.location_id === a.destination)
          .map((c) => ({
            id: c.id,
            first_name: c.first_name,
            last_name: c.last_name,
            sex: c.sex,
            appearance: c.appearance,
            public_summary:
              (bp.narrative?.starting_knowledge?.characters ?? []).find(
                (entry) => entry.character_id === c.id,
              )?.summary ?? null,
          })),
      ),
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  search: {
    requiredMode: "explore",
    endpoint: {
      name: "game-search",
      method: "POST",
      body: (g, a, gid) => ({
        game_id: gid,
        ...(a.search_query ? { search_query: a.search_query } : {}),
      }),
    },
    roleInput: (g, a, bp, history) => ({
      role: resolveSearchRole(a.search_query),
      game_id: "case",
      blueprint: bp,
      session: snapshotFromGiven(g),
      location_id: g.location_id,
      revealed_clue_ids: g.revealed_clue_ids ?? [],
      discovered_clue_ids: g.discovered_clues ?? [],
      next_clue: a.search_query ? null : (nextUnrevealedClue(bp, g) ?? null),
      search_query: a.search_query ?? null,
      conversation_history: history,
    }),
    speaker: () => narratorSpeaker(),
  },

  accuse: {
    requiredMode: "accuse",
    endpoint: {
      name: "game-accuse",
      method: "POST",
      body: (g, a, gid) => ({
        game_id: gid,
        ...(a.player_reasoning ? { player_reasoning: a.player_reasoning } : {}),
        ...(a.accusation_history_mode ? { accusation_history_mode: a.accusation_history_mode } : {}),
      }),
    },
    roleInput: (g, a, bp, history) => {
      const role = resolveAccusationRole(a.player_reasoning);
      const base = {
        role,
        game_id: "case",
        blueprint: bp,
        session: { ...snapshotFromGiven(g), mode: "accuse", current_talk_character_id: null },
        conversation_history: history,
        ...(a.accusation_history_mode ? { history_mode: a.accusation_history_mode } : {}),
      };
      return role === "accusation_judge"
        ? {
          ...base,
          player_input: a.player_reasoning,
          round: history.filter((e) => e.event_type === "accuse_round").length,
        }
        : base;
    },
    speaker: () => narratorSpeaker(),
  },
};

/**
 * The first location-level clue a bare search would surface, mirroring the
 * handler's rule (unrevealed AND unlocked). Locking needs the session-global
 * discovered set, which a case supplies via `given.discovered_clues`.
 */
function nextUnrevealedClue(blueprint, given) {
  const location = (blueprint.world.locations ?? []).find((l) => l.id === given.location_id);
  if (!location) return null;
  const revealed = new Set(given.revealed_clue_ids ?? []);
  const discovered = new Set(given.discovered_clues ?? []);
  return (
    (location.clues ?? []).find(
      (c) =>
        !revealed.has(c.id) &&
        (c.requires?.clue_ids ?? []).every((id) => discovered.has(id)),
    ) ?? null
  );
}

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
