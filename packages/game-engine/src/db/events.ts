// `EventStore` over SQLite.
//
// Ownership is enforced by joining through `game_sessions`, which is what
// migration 0004's event policy did with its `exists (select 1 from
// game_sessions where ... user_id = auth.uid())` clause.

import type { EventStore, GameEventRow, NewGameEvent } from "../context.ts";
import type { NarrationPart } from "../narration.ts";
import type { Db } from "./client.ts";

const OWNED_SESSION = `
  exists (
    select 1 from game_sessions
    where game_sessions.id = game_events.session_id
      and game_sessions.player_id = ?
  )
`;

function readJson(value: unknown): unknown {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function toEventRow(row: Record<string, unknown>): GameEventRow {
  const payload = readJson(row.payload);
  const parts = readJson(row.narration_parts);

  return {
    sequence: Number(row.sequence),
    event_type: String(row.event_type),
    actor: String(row.actor),
    narration: String(row.narration),
    payload:
      payload && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null,
    narration_parts: Array.isArray(parts) ? (parts as NarrationPart[]) : [],
    model: row.model === null ? null : String(row.model),
    created_at: String(row.created_at),
  };
}

export function createEventStore(db: Db, playerId: string): EventStore {
  function assertOwnedSession(sessionId: string): void {
    const row = db
      .prepare("select 1 from game_sessions where id = ? and player_id = ?")
      .get(sessionId, playerId);
    if (!row) {
      throw new Error(`Session ${sessionId} is not available to this player`);
    }
  }

  return {
    async listBySession(gameId: string): Promise<GameEventRow[]> {
      return db
        .prepare(
          `select sequence, event_type, actor, narration, payload,
                  narration_parts, model, created_at
             from game_events
            where session_id = ? and ${OWNED_SESSION}
            order by sequence asc`,
        )
        .all(gameId, playerId)
        .map(toEventRow);
    },

    async nextSequence(gameId: string): Promise<number> {
      const row = db
        .prepare(
          `select max(sequence) as highest
             from game_events
            where session_id = ? and ${OWNED_SESSION}`,
        )
        .get(gameId, playerId);

      const highest = row?.highest;
      return typeof highest === "number" ? highest + 1 : 1;
    },

    async insert(event: NewGameEvent): Promise<void> {
      // Postgres refused this through the policy's `with check`; the same
      // refusal has to be explicit here, because a foreign key alone would
      // happily let one player append to another's session.
      assertOwnedSession(event.session_id);

      db.prepare(
        `insert into game_events (
           id, session_id, sequence, event_type, actor,
           payload, narration, narration_parts, model, created_at
         ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        crypto.randomUUID(),
        event.session_id,
        event.sequence,
        event.event_type,
        event.actor,
        event.payload === null ? null : JSON.stringify(event.payload),
        event.narration,
        JSON.stringify(event.narration_parts),
        event.model ?? null,
        new Date().toISOString(),
      );
    },
  };
}
