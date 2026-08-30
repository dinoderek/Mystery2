// `SessionStore` over SQLite.
//
// Every statement is scoped to one player. That scoping is not a convenience:
// it is the only thing stopping one local profile from reading another's
// sessions, and nothing underneath will catch a query that forgets.

import type {
  GameSessionPatch,
  GameSessionRow,
  GameSessionSummaryRow,
  NewGameSession,
  SessionStore,
} from "../context.ts";
import { readGameMode } from "../state-machine.ts";
import type { Db, SqlValue } from "./client.ts";

const SUMMARY_COLUMNS =
  "id, blueprint_id, mode, time_remaining, outcome, updated_at, created_at";

/**
 * How each patchable column is written. `discovered_clues` is a JSON array in
 * a TEXT column; the rest bind directly. A key absent from this map is not
 * patchable, which keeps `update()` from ever interpolating a caller-supplied
 * column name into SQL.
 */
const PATCH_ENCODERS: Record<
  keyof GameSessionPatch,
  (value: unknown) => SqlValue
> = {
  mode: (value) => String(value),
  current_location_id: (value) => String(value),
  current_talk_character_id: (value) => (value === null ? null : String(value)),
  time_remaining: (value) => Number(value),
  discovered_clues: (value) => JSON.stringify(value ?? []),
  outcome: (value) => (value === null ? null : String(value)),
  updated_at: (value) => String(value),
};

function readJsonArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is string => typeof entry === "string")
      : [];
  } catch {
    return [];
  }
}

function toSessionRow(row: Record<string, unknown>): GameSessionRow {
  return {
    id: String(row.id),
    player_id: String(row.player_id),
    blueprint_id: String(row.blueprint_id),
    ai_profile_id: String(row.ai_profile_id),
    mode: readGameMode(row.mode),
    current_location_id: String(row.current_location_id),
    current_talk_character_id:
      row.current_talk_character_id === null
        ? null
        : String(row.current_talk_character_id),
    time_remaining: Number(row.time_remaining),
    discovered_clues: readJsonArray(row.discovered_clues),
    outcome: row.outcome === null ? null : String(row.outcome),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toSummaryRow(row: Record<string, unknown>): GameSessionSummaryRow {
  return {
    id: String(row.id),
    blueprint_id: String(row.blueprint_id),
    mode: readGameMode(row.mode),
    time_remaining: Number(row.time_remaining),
    outcome: row.outcome === null ? null : String(row.outcome),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function createSessionStore(db: Db, playerId: string): SessionStore {
  return {
    async getById(gameId: string): Promise<GameSessionRow | null> {
      const row = db
        .prepare("select * from game_sessions where id = ? and player_id = ?")
        .get(gameId, playerId);
      return row ? toSessionRow(row) : null;
    },

    async create(session: NewGameSession): Promise<string> {
      // An explicit refusal to write a row the writer could not read back.
      if (session.player_id !== playerId) {
        throw new Error("Cannot create a session for another player");
      }

      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        `insert into game_sessions (
           id, player_id, blueprint_id, ai_profile_id, mode,
           current_location_id, time_remaining, created_at, updated_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        session.player_id,
        session.blueprint_id,
        session.ai_profile_id,
        session.mode,
        session.current_location_id,
        session.time_remaining,
        now,
        now,
      );

      return id;
    },

    async update(gameId: string, patch: GameSessionPatch): Promise<void> {
      const assignments: string[] = [];
      const values: SqlValue[] = [];

      for (const [column, encode] of Object.entries(PATCH_ENCODERS)) {
        const value = patch[column as keyof GameSessionPatch];
        if (value === undefined) continue;
        assignments.push(`${column} = ?`);
        values.push(encode(value));
      }

      if (assignments.length === 0) return;

      // Matching no rows is not an error: updating a session you do not own
      // is a no-op, not a failure.
      db.prepare(
        `update game_sessions set ${assignments.join(", ")}
         where id = ? and player_id = ?`,
      ).run(...values, gameId, playerId);
    },

    async listForPlayer(): Promise<GameSessionSummaryRow[]> {
      return db
        .prepare(
          `select ${SUMMARY_COLUMNS} from game_sessions where player_id = ?`,
        )
        .all(playerId)
        .map(toSummaryRow);
    },
  };
}
