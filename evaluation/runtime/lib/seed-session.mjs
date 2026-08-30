// Seed a fully-specified game session + fixed history into the database so the
// live endpoint rebuilds the exact same context every run. This is what makes
// the endpoint backend deterministic: identical seeded rows -> identical prompt
// -> the only variable is the model behind the session's ai_profile.
//
// It writes straight into `game.db`, so there is no network hop between
// setting a case up and playing it.

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { resolveDatabasePath } from "../../../packages/game-engine/src/paths.ts";
import { normalizeHistory } from "./roles.mjs";

const NARRATOR = { kind: "narrator", key: "narrator", label: "Narrator" };

/**
 * Insert a session matching `given` plus its history rows. Returns the game_id.
 *   blueprint  — parsed blueprint (for blueprint_id)
 *   given      — { mode, location_id, talk_character_id?, time_remaining, discovered_clues?, history? }
 *   aiProfile  — profile label to pin the session to (default "default")
 *   playerId   — owner (a throwaway harness profile)
 */
export async function seedSessionWithHistory({ blueprint, given, aiProfile, playerId }) {
  const db = openDatabase({ path: resolveDatabasePath() });

  try {
    const gameId = crypto.randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `insert into game_sessions (
         id, player_id, blueprint_id, ai_profile_id, mode, current_location_id,
         current_talk_character_id, time_remaining, discovered_clues,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      gameId,
      playerId,
      blueprint.id,
      aiProfile ?? "default",
      given.mode,
      given.location_id,
      given.talk_character_id ?? null,
      given.time_remaining,
      JSON.stringify(given.discovered_clues ?? []),
      now,
      now,
    );

    const insertEvent = db.prepare(
      `insert into game_events (
         id, session_id, sequence, event_type, actor, payload, narration,
         narration_parts, model, created_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (const entry of normalizeHistory(given.history)) {
      // game_events requires a non-empty narration_parts array. The runtime
      // context builder only reads `narration`, so a single part mirroring the
      // text satisfies the constraint without affecting the prompt.
      const parts = entry.narration_parts ?? [{ text: entry.narration, speaker: NARRATOR }];

      insertEvent.run(
        crypto.randomUUID(),
        gameId,
        entry.sequence,
        entry.event_type,
        entry.actor,
        entry.payload === null || entry.payload === undefined
          ? null
          : JSON.stringify(entry.payload),
        entry.narration,
        JSON.stringify(parts),
        null,
        now,
      );
    }

    return gameId;
  } finally {
    db.close();
  }
}
