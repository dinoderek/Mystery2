// Reading the database a self-play run's own server wrote, which is the only
// database self-play touches. It is opened read-only, and a copy is taken with
// SQLite's backup, which is safe while the server is still writing.

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { playedEvents } from "../../lib/game-events.mjs";

/** One saved event of a game, as the report lays it out. */
export interface PlayedEvent {
  sequence: number;
  type: string;
  payload: Record<string, unknown>;
  parts: Array<{ text?: string; speaker?: { label?: string; kind?: string } }>;
}

/** A consistent copy of `source` at `destination`; `source` is opened read-only. */
export async function copyDatabase(source: string, destination: string): Promise<void> {
  const db = openDatabase({ path: source, readonly: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
}

function parseJson<T>(text: unknown, fallback: T): T {
  try {
    return typeof text === "string" && text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** The events of one game the game master played, in order: a refused line or `help` is not among them. */
export function readPlayedEvents(databaseFile: string, gameId: string): PlayedEvent[] {
  const db = openDatabase({ path: databaseFile, readonly: true });
  try {
    const rows = db
      .prepare(
        "select sequence, event_type, payload, narration_parts from game_events where session_id = ? order by sequence",
      )
      .all(gameId);
    return rows
      .filter((row) => playedEvents([row]).length > 0)
      .map((row) => ({
        sequence: row.sequence as number,
        type: row.event_type as string,
        payload: parseJson(row.payload, {}),
        parts: parseJson(row.narration_parts, []),
      }));
  } finally {
    db.close();
  }
}
