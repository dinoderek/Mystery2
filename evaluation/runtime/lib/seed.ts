/**
 * Seeds a fully specified game session and its fixed history into a database,
 * so a server reading it rebuilds the exact same context every run. That is
 * what makes a server-narrated replay deterministic: identical seeded rows give
 * an identical prompt, and the only variable is the model behind the session's
 * profile.
 *
 * The database is always the throwaway server's own, which the caller names;
 * nothing here resolves a path of its own.
 */

import { randomUUID } from "node:crypto";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import type { BlueprintLike, Given, Speaker } from "./case.ts";
import { normalizeHistory } from "./roles.ts";

const NARRATOR: Speaker = { kind: "narrator", key: "narrator", label: "Narrator" };

export interface SeedRequest {
  /** The throwaway server's database file. */
  databaseFile: string;
  blueprint: BlueprintLike;
  given: Given;
  /** The profile label to pin the session to. */
  aiProfile: string;
  /** The profile that owns the session, by name. */
  playerName: string;
}

/** Inserts a session matching `given` plus its history rows, and returns its id. */
export function seedSessionWithHistory({ databaseFile, blueprint, given, aiProfile, playerName }: SeedRequest): string {
  if (given.mode === undefined || given.location_id === undefined || given.time_remaining === undefined) {
    throw new Error("a case replayed through the server needs given.mode, given.location_id and given.time_remaining");
  }
  const db = openDatabase({ path: databaseFile });
  try {
    const player = db.prepare("select id from players where name = ?").get(playerName) as { id: string } | undefined;
    if (!player) throw new Error(`no profile named ${playerName} in ${databaseFile}`);
    const gameId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `insert into game_sessions (
         id, player_id, blueprint_id, ai_profile_id, mode, current_location_id,
         current_talk_character_id, time_remaining, discovered_clues,
         created_at, updated_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      gameId,
      player.id,
      blueprint.id as string,
      aiProfile,
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
    const source = given.history ?? [];
    normalizeHistory(source).forEach((entry, index) => {
      // game_events requires a non-empty narration_parts array. The runtime
      // context builder only reads `narration`, so a single part mirroring the
      // text satisfies the constraint without affecting the prompt.
      const parts = source[index].narration_parts ?? [{ text: entry.narration, speaker: NARRATOR }];
      insertEvent.run(
        randomUUID(),
        gameId,
        entry.sequence,
        entry.event_type,
        entry.actor,
        JSON.stringify(entry.payload),
        entry.narration,
        JSON.stringify(parts),
        null,
        now,
      );
    });
    return gameId;
  } finally {
    db.close();
  }
}
