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
  TurnSave,
} from "../context.ts";
import { retiredCaseFormat, SaveConflictError } from "../errors.ts";
import { readGameMode } from "../state-machine.ts";
import type { Db, SqlValue } from "./client.ts";
import { insertEventRow } from "./events.ts";
import { validateClueGraph } from "../../../shared/src/clue-graph-validator.ts";
import { clueGraphCaseId } from "../../../shared/src/clue-graph-case.ts";
import { CLUE_GRAPH_FORMAT, type ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import { ReadingAgeSchema } from "../../../shared/src/reading-age.ts";

const SUMMARY_COLUMNS =
  "id, blueprint_id, mode, time_remaining, outcome, updated_at, created_at, json_extract(clue_graph_snapshot, '$.metadata.title') as clue_graph_title, json_extract(clue_graph_snapshot, '$.format') as clue_graph_format";

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

/** The saved clue-graph case, or a rejection naming its format when the engine no longer reads it. */
function readClueGraphSnapshot(value: unknown): ClueGraphCase | undefined {
  if (typeof value !== "string") return undefined;
  const saved = JSON.parse(value);
  if (saved?.format !== CLUE_GRAPH_FORMAT) throw retiredCaseFormat(String(saved?.format));
  return validateClueGraph(saved, { story: false });
}

function toSessionRow(row: Record<string, unknown>): GameSessionRow {
  const graph = readClueGraphSnapshot(row.clue_graph_snapshot);
  if (graph && clueGraphCaseId(graph.metadata.id) !== row.blueprint_id) throw new Error("Saved clue-graph case does not match session blueprint");
  return {
    ...(graph ? { clue_graph_snapshot: graph } : {}),
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
    reading_age: row.reading_age === null ? null : Number(row.reading_age),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function toSummaryRow(row: Record<string, unknown>): GameSessionSummaryRow {
  return {
    ...(typeof row.clue_graph_title === "string" ? { clue_graph_title: row.clue_graph_title } : {}),
    ...(typeof row.clue_graph_format === "string" ? { clue_graph_format: row.clue_graph_format } : {}),
    id: String(row.id),
    blueprint_id: String(row.blueprint_id),
    mode: readGameMode(row.mode),
    time_remaining: Number(row.time_remaining),
    outcome: row.outcome === null ? null : String(row.outcome),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

function insertSessionRow(db: Db, id: string, session: NewGameSession): void {
  if (session.clue_graph_snapshot && clueGraphCaseId(session.clue_graph_snapshot.metadata.id) !== session.blueprint_id) throw new Error("Clue-graph snapshot must match session blueprint");
  const now = new Date().toISOString();

  db.prepare(
    `insert into game_sessions (
       id, player_id, blueprint_id, ai_profile_id, mode,
       current_location_id, time_remaining, created_at, updated_at, msf_snapshot,
       clue_graph_snapshot, reading_age
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    null,
    session.clue_graph_snapshot ? JSON.stringify(validateClueGraph(session.clue_graph_snapshot, { story: false })) : null,
    ReadingAgeSchema.parse(session.reading_age),
  );
}

function updateSessionRow(
  db: Db,
  playerId: string,
  gameId: string,
  patch: GameSessionPatch,
): void {
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
}

export function createSessionStore(db: Db, playerId: string): SessionStore {
  function assertCanCreate(session: NewGameSession): void {
    // An explicit refusal to write a row the writer could not read back.
    if (session.player_id !== playerId) {
      throw new Error("Cannot create a session for another player");
    }
  }

  function assertOwned(gameId: string): void {
    const row = db
      .prepare("select 1 from game_sessions where id = ? and player_id = ?")
      .get(gameId, playerId);
    if (!row) {
      throw new Error(`Session ${gameId} is not available to this player`);
    }
  }

  function readNextSequence(gameId: string): number {
    const row = db
      .prepare("select max(sequence) as highest from game_events where session_id = ?")
      .get(gameId);
    return typeof row?.highest === "number" ? row.highest + 1 : 1;
  }

  return {
    async getById(gameId: string): Promise<GameSessionRow | null> {
      const row = db
        .prepare("select * from game_sessions where id = ? and player_id = ?")
        .get(gameId, playerId);
      return row ? toSessionRow(row) : null;
    },

    async create(session: NewGameSession): Promise<string> {
      assertCanCreate(session);

      const id = crypto.randomUUID();
      insertSessionRow(db, id, session);
      return id;
    },

    async update(gameId: string, patch: GameSessionPatch): Promise<void> {
      updateSessionRow(db, playerId, gameId, patch);
    },

    async saveTurn(save: TurnSave): Promise<void> {
      if (save.start) assertCanCreate(save.start);

      // The transaction is the whole point: the session row, its patch and
      // every event land together or not at all. The sequence is read inside
      // it, so the check and the writes see the same game.
      db.transaction(() => {
        if (save.start) {
          insertSessionRow(db, save.game_id, save.start);
        } else {
          assertOwned(save.game_id);
        }

        if (readNextSequence(save.game_id) !== save.expected_sequence) {
          throw new SaveConflictError(save.game_id, save.expected_sequence);
        }

        updateSessionRow(db, playerId, save.game_id, save.patch ?? {});

        save.events.forEach((event, index) => {
          insertEventRow(db, {
            ...event,
            session_id: save.game_id,
            sequence: save.expected_sequence + index,
          });
        });
      });
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
