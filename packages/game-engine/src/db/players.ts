// Local player profiles.
//
// There are no passwords and no tokens: a profile is a name and an id, the
// browser carries the id in a cookie, and the session/event repositories scope
// every query to it. That scoping is the whole of the access model.

import type { Db } from "./client.ts";

export interface PlayerRecord {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export interface PlayerStore {
  /** Returns null when no profile has that id. */
  getById(id: string): PlayerRecord | null;
  /** Returns null when no profile has that name. Names are unique. */
  getByName(name: string): PlayerRecord | null;
  /** Every profile, oldest first — the profile picker's list. */
  list(): PlayerRecord[];
  /** Creates a profile. Throws when the name is already taken. */
  create(name: string): PlayerRecord;
  /** The profile with this name, created if it does not exist yet. */
  ensure(name: string): PlayerRecord;
}

function toRecord(row: Record<string, unknown>): PlayerRecord {
  return {
    id: String(row.id),
    name: String(row.name),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function createPlayerStore(db: Db): PlayerStore {
  const store: PlayerStore = {
    getById(id) {
      const row = db.prepare("select * from players where id = ?").get(id);
      return row ? toRecord(row) : null;
    },

    getByName(name) {
      const row = db.prepare("select * from players where name = ?").get(name.trim());
      return row ? toRecord(row) : null;
    },

    list() {
      // `created_at` is an ISO string with millisecond resolution, so two
      // profiles created in the same millisecond tie — and the id is a random
      // UUID, which would make the order of that tie arbitrary. `rowid` is
      // insertion order, so it breaks the tie the way a reader expects.
      return db
        .prepare("select * from players order by created_at asc, rowid asc")
        .all()
        .map(toRecord);
    },

    create(name) {
      const trimmed = name.trim();
      if (!trimmed) throw new Error("Player name must not be empty");

      const now = new Date().toISOString();
      const record: PlayerRecord = {
        id: crypto.randomUUID(),
        name: trimmed,
        created_at: now,
        updated_at: now,
      };

      db.prepare(
        "insert into players (id, name, created_at, updated_at) values (?, ?, ?, ?)",
      ).run(record.id, record.name, record.created_at, record.updated_at);

      return record;
    },

    ensure(name) {
      // Racing callers both see "no such profile" and one insert loses to the
      // unique index; re-reading turns that into the row the other one wrote.
      const existing = store.getByName(name);
      if (existing) return existing;

      try {
        return store.create(name);
      } catch (error) {
        const winner = store.getByName(name);
        if (winner) return winner;
        throw error;
      }
    },
  };

  return store;
}
