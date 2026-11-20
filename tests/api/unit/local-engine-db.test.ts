// The local `EngineContext` stores, over a real SQLite file.
//
// Ownership, cascade, and sequence uniqueness are the repositories' job, so
// they are asserted here. Every test opens a fresh database under a temporary
// directory; none of them can reach the development database.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openDatabase,
  planMigrations,
  SCHEMA_VERSION,
  type Db,
  type Migration,
} from "../../../packages/game-engine/src/db/client.ts";
import { createEventStore } from "../../../packages/game-engine/src/db/events.ts";
import { createPlayerStore } from "../../../packages/game-engine/src/db/players.ts";
import { createSessionStore } from "../../../packages/game-engine/src/db/sessions.ts";
import type {
  NewGameEvent,
  NewGameSession,
} from "../../../packages/game-engine/src/context.ts";

let tempDir: string;
let db: Db;

function databasePath(): string {
  return path.join(tempDir, "nested", "game.db");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-db-"));
  db = openDatabase({ path: databasePath() });
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function newSession(playerId: string): NewGameSession {
  return {
    player_id: playerId,
    blueprint_id: "blueprint-1",
    ai_profile_id: "default",
    mode: "explore",
    current_location_id: "loc_hall",
    time_remaining: 20,
  };
}

function newEvent(sessionId: string, sequence: number): NewGameEvent {
  return {
    session_id: sessionId,
    sequence,
    event_type: "move",
    actor: "narrator",
    payload: { location_id: "loc_garden" },
    narration: "You step into the garden.",
    narration_parts: [
      {
        text: "You step into the garden.",
        speaker: { kind: "narrator", key: "narrator", label: "Narrator" },
      },
    ],
    model: "mock/runtime-default",
  };
}

describe("local database client", () => {
  it("creates the schema in a directory that does not exist yet", () => {
    expect(fs.existsSync(databasePath())).toBe(true);
    expect(
      db.prepare("select name from sqlite_master where type = 'table' order by name").all(),
    ).toEqual([
      { name: "app_settings" },
      { name: "game_events" },
      { name: "game_sessions" },
      { name: "players" },
    ]);
  });

  it("creates a fresh database at the current version, holding the AI choice as one value", () => {
    expect(SCHEMA_VERSION).toBe(4);
    expect(db.prepare("pragma user_version").get()).toEqual({ user_version: SCHEMA_VERSION });
    expect(
      db.prepare("pragma table_info(app_settings)").all().map((column) => column.name),
    ).toEqual(["id", "ai_name"]);
    // One row at most.
    db.prepare("insert into app_settings (id, ai_name) values (1, 'mock')").run();
    expect(() => db.prepare("insert into app_settings (id, ai_name) values (2, 'mock')").run()).toThrow();
  });

  it("stamps the schema version so a reopen is a no-op", () => {
    expect(db.prepare("pragma user_version").get()).toEqual({
      user_version: SCHEMA_VERSION,
    });

    createPlayerStore(db).create("Ada");
    db.close();

    db = openDatabase({ path: databasePath() });
    expect(createPlayerStore(db).list().map((p) => p.name)).toEqual(["Ada"]);
  });

  it("upgrades version 3 with a nullable private MSF snapshot and keeps existing sessions", async () => {
    const player = createPlayerStore(db).create("Version three");
    const sessionId = await createSessionStore(db, player.id).create(newSession(player.id));
    db.exec("alter table game_sessions drop column msf_snapshot; pragma user_version = 3;");
    db.close();
    db = openDatabase({ path: databasePath() });
    expect(db.prepare("pragma user_version").get()).toEqual({ user_version: 4 });
    expect(await createSessionStore(db, player.id).getById(sessionId)).toMatchObject({ blueprint_id: "blueprint-1" });
    expect(db.prepare("select msf_snapshot from game_sessions where id = ?").get(sessionId)).toEqual({ msf_snapshot: null });
  });

  it("applies the connection pragmas the schema depends on", () => {
    // foreign_keys is OFF by default in SQLite; the cascade below needs it.
    expect(db.prepare("pragma foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("pragma journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(db.prepare("pragma busy_timeout").get()).toEqual({ timeout: 5000 });
  });

  it("rolls a transaction back when the work throws", () => {
    const players = createPlayerStore(db);

    expect(() =>
      db.transaction(() => {
        players.create("Ada");
        throw new Error("boom");
      }),
    ).toThrow("boom");

    expect(players.list()).toEqual([]);
  });

  it("refuses a database written by a newer schema version", () => {
    db.exec(`pragma user_version = ${SCHEMA_VERSION + 1}`);
    db.close();

    expect(() => openDatabase({ path: databasePath() })).toThrow(/newer/i);

    // Reopen something valid so the afterEach close does not double-fail.
    db = openDatabase({ path: path.join(tempDir, "other.db") });
  });
});

/**
 * The shape of a database, as a comparable string: every table with its
 * columns, types, null-ness, defaults and primary-key position, plus the
 * indexes.
 *
 * Compared instead of `sqlite_master.sql` because that stores the CREATE
 * statement verbatim, so identical schemas written with different indentation
 * would not match — and `schema.ts` and the migration are, correctly, written
 * out separately.
 */
function describeShape(db: Db): string {
  const parts: string[] = [];

  const tables = db
    .prepare(
      "select name from sqlite_master where type = 'table' " +
        "and name not like 'sqlite_%' order by name",
    )
    .all();

  for (const table of tables) {
    const columns = db
      .prepare(`pragma table_info("${String(table.name)}")`)
      .all()
      .map(
        (column) =>
          `${String(column.name)} ${String(column.type)} ` +
          `notnull=${String(column.notnull)} ` +
          `default=${String(column.dflt_value)} pk=${String(column.pk)}`,
      );
    parts.push(`table ${String(table.name)}\n  ${columns.join("\n  ")}`);
  }

  const indexes = db
    .prepare(
      "select name, tbl_name from sqlite_master where type = 'index' " +
        "and name not like 'sqlite_%' order by name",
    )
    .all();

  for (const index of indexes) {
    parts.push(`index ${String(index.name)} on ${String(index.tbl_name)}`);
  }

  return parts.join("\n");
}

// A database at schema version 2, built the way one that shipped was: the
// three play tables, and the labelled keys and models with the settings row
// that selected among them.
const SCHEMA_V2_SQL = `
create table players (
    id          text primary key,
    name        text not null unique,
    created_at  text not null,
    updated_at  text not null
);

create table game_sessions (
    id                        text primary key,
    player_id                 text not null references players(id) on delete cascade,
    blueprint_id              text not null,
    ai_profile_id             text not null default 'default',
    mode                      text not null,
    current_location_id       text not null,
    current_talk_character_id text,
    time_remaining            integer not null,
    discovered_clues          text not null default '[]',
    outcome                   text,
    created_at                text not null,
    updated_at                text not null
);

create index game_sessions_player_id_idx on game_sessions(player_id);

create table game_events (
    id              text primary key,
    session_id      text not null references game_sessions(id) on delete cascade,
    sequence        integer not null,
    event_type      text not null,
    actor           text not null,
    payload         text,
    narration       text not null,
    narration_parts text not null default '[]'
                    check (json_valid(narration_parts)
                           and json_type(narration_parts) = 'array'
                           and json_array_length(narration_parts) > 0),
    model           text,
    created_at      text not null
);

create unique index game_events_session_sequence_idx
    on game_events(session_id, sequence);

create table ai_keys (
    label       text primary key,
    api_key     text not null,
    source      text not null check (source in ('env', 'user')),
    created_at  text not null,
    updated_at  text not null
);

create table ai_models (
    label       text primary key,
    model_id    text not null,
    source      text not null check (source in ('env', 'user')),
    created_at  text not null,
    updated_at  text not null
);

create table app_settings (
    id              text primary key check (id = 'singleton'),
    ai_mode         text not null default 'mock' check (ai_mode in ('mock', 'openrouter')),
    ai_key_label    text,
    ai_model_label  text,
    updated_at      text not null
);
`;

// The real upgrade, run end to end against a database that already has data in
// it. `planMigrations` below covers the planning; this covers the applying, and
// it is the only thing that can catch `schema.ts` and `MIGRATIONS` drifting
// apart — every other suite builds from scratch and takes the version-0 branch,
// so a migration that does not match the schema would never be executed.
describe("migrating a version 2 database", () => {
  let upgradedPath: string;
  let sessionId: string;

  beforeEach(async () => {
    upgradedPath = path.join(tempDir, "v2", "game.db");

    // Built through `openDatabase` so the file gets the same pragmas a real one
    // has, then emptied and rewritten to look like version 2. The tables are
    // dropped by enumeration rather than by name so this keeps working as the
    // current schema grows.
    const seeded = openDatabase({ path: upgradedPath });
    const existing = seeded
      .prepare(
        "select name from sqlite_master where type = 'table' " +
          "and name not like 'sqlite_%'",
      )
      .all();
    seeded.exec("pragma foreign_keys = off");
    for (const table of existing) {
      seeded.exec(`drop table "${String(table.name)}"`);
    }
    seeded.exec("pragma foreign_keys = on");
    seeded.exec(SCHEMA_V2_SQL);
    seeded.exec("pragma user_version = 2");

    const player = createPlayerStore(seeded).create("Ada");
    sessionId = crypto.randomUUID();
    seeded.prepare("insert into game_sessions (id, player_id, blueprint_id, ai_profile_id, mode, current_location_id, time_remaining, created_at, updated_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(sessionId, player.id, "blueprint-1", "default", "explore", "loc_hall", 20, new Date().toISOString(), new Date().toISOString());
    await createEventStore(seeded, player.id).insert(newEvent(sessionId, 1));
    const now = new Date().toISOString();
    seeded
      .prepare("insert into ai_keys (label, api_key, source, created_at, updated_at) values ('work', 'sk-old', 'user', ?, ?)")
      .run(now, now);
    seeded
      .prepare("insert into ai_models (label, model_id, source, created_at, updated_at) values ('work', 'v/m', 'user', ?, ?)")
      .run(now, now);
    seeded
      .prepare(
        "insert into app_settings (id, ai_mode, ai_key_label, ai_model_label, updated_at) " +
          "values ('singleton', 'openrouter', 'work', 'work', ?)",
      )
      .run(now);
    seeded.close();
  });

  it("steps it to the current version", () => {
    const upgraded = openDatabase({ path: upgradedPath });

    expect(upgraded.prepare("pragma user_version").get()).toEqual({ user_version: SCHEMA_VERSION });

    upgraded.close();
  });

  it("leaves it in the same shape as a fresh one, the old AI tables gone", () => {
    const upgraded = openDatabase({ path: upgradedPath });

    expect(describeShape(upgraded)).toBe(describeShape(db));
    expect(describeShape(upgraded)).not.toMatch(/ai_keys|ai_models|ai_mode/);

    upgraded.close();
  });

  it("keeps its players, sessions and events, and carries no choice over", async () => {
    const upgraded = openDatabase({ path: upgradedPath });

    const players = createPlayerStore(upgraded).list();
    expect(players.map((player) => player.name)).toEqual(["Ada"]);
    expect((await createSessionStore(upgraded, players[0].id).getById(sessionId))?.blueprint_id).toBe("blueprint-1");
    expect((await createEventStore(upgraded, players[0].id).listBySession(sessionId)).map((event) => event.sequence)).toEqual([1]);
    expect(upgraded.prepare("select count(*) as n from app_settings").get()).toEqual({ n: 0 });

    upgraded.close();
  });

  it("refuses a version 1 database, which has no step", () => {
    const old = openDatabase({ path: path.join(tempDir, "v1", "game.db") });
    old.exec("pragma user_version = 1");
    old.close();

    expect(() => openDatabase({ path: path.join(tempDir, "v1", "game.db") })).toThrow(/No migration to schema version 2/);
  });
});

// The upgrade path, which no other test can reach: every suite builds its
// database from scratch, so `migrate()` only ever takes the version-0 branch.
// These cover the branch that runs against a database someone has been playing
// on — the only databases that ever take it.
describe("planMigrations", () => {
  const step = (to: number): Migration => ({ to, sql: `-- to ${to}` });

  it("plans nothing when the database is already at the target", () => {
    expect(planMigrations(3, 3, [step(2), step(3)])).toEqual([]);
  });

  it("plans every version in the gap, in ascending order", () => {
    // Declared out of order, and with a step that is already applied.
    const migrations = [step(4), step(2), step(3)];

    expect(planMigrations(1, 4, migrations)).toEqual([step(2), step(3), step(4)]);
  });

  it("ignores steps at or below the current version", () => {
    expect(planMigrations(2, 3, [step(1), step(2), step(3)])).toEqual([step(3)]);
  });

  it("refuses to cross a gap rather than stamping a version nothing produced", () => {
    // The mistake this guards: `schema.ts` and `SCHEMA_VERSION` moved to 3,
    // but only the step to 2 was written.
    expect(() => planMigrations(1, 3, [step(2)])).toThrow(/No migration to schema version 3/);
  });

  it("names the first missing version, not the last", () => {
    expect(() => planMigrations(1, 4, [step(4)])).toThrow(/version 2/);
  });

  it("refuses an empty chain when there is any gap at all", () => {
    expect(() => planMigrations(1, 2, [])).toThrow(/No migration to schema version 2/);
  });
});

describe("player store", () => {
  it("creates, finds and lists profiles", () => {
    const players = createPlayerStore(db);
    const ada = players.create("Ada");

    expect(players.getById(ada.id)).toEqual(ada);
    expect(players.getByName("Ada")).toEqual(ada);
    expect(players.getById("nobody")).toBeNull();
    expect(players.getByName("Nobody")).toBeNull();

    players.create("Grace");
    expect(players.list().map((p) => p.name)).toEqual(["Ada", "Grace"]);
  });

  it("lists in insertion order when profiles share a timestamp", () => {
    // `created_at` has millisecond resolution, so profiles created in quick
    // succession really do collide — and the id is a random UUID, so without a
    // stable tiebreak the order of that collision is arbitrary. Forced here
    // rather than raced, so the assertion means the same thing every run.
    const players = createPlayerStore(db);
    const names = ["Ada", "Grace", "Barbara", "Katherine"];
    for (const name of names) players.create(name);

    db.prepare("update players set created_at = ?").run("2026-06-01T10:00:00.000Z");

    expect(players.list().map((p) => p.name)).toEqual(names);
  });

  it("rejects a duplicate name but ensures idempotently", () => {
    const players = createPlayerStore(db);
    const ada = players.create("Ada");

    expect(() => players.create("Ada")).toThrow();
    expect(players.ensure("Ada")).toEqual(ada);
    expect(players.ensure("  Ada  ")).toEqual(ada);
    expect(players.list()).toHaveLength(1);
  });

  it("rejects an empty name", () => {
    expect(() => createPlayerStore(db).create("   ")).toThrow(/must not be empty/);
  });
});

describe("session store", () => {
  it("round-trips a session, including the JSON-encoded clue array", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);

    const gameId = await sessions.create(newSession(player.id));
    const created = await sessions.getById(gameId);

    expect(created).toMatchObject({
      id: gameId,
      player_id: player.id,
      blueprint_id: "blueprint-1",
      ai_profile_id: "default",
      mode: "explore",
      current_location_id: "loc_hall",
      current_talk_character_id: null,
      time_remaining: 20,
      discovered_clues: [],
      outcome: null,
    });
    expect(Date.parse(created!.created_at)).not.toBeNaN();

    await sessions.update(gameId, {
      mode: "talk",
      current_talk_character_id: "char_mara",
      discovered_clues: ["clue_a", "clue_b"],
      time_remaining: 18,
      updated_at: "2026-06-01T10:00:00.000Z",
    });

    expect(await sessions.getById(gameId)).toMatchObject({
      mode: "talk",
      current_talk_character_id: "char_mara",
      discovered_clues: ["clue_a", "clue_b"],
      time_remaining: 18,
      updated_at: "2026-06-01T10:00:00.000Z",
      // untouched by the patch
      current_location_id: "loc_hall",
    });

    await sessions.update(gameId, { current_talk_character_id: null, outcome: "win" });
    expect(await sessions.getById(gameId)).toMatchObject({
      current_talk_character_id: null,
      outcome: "win",
    });
  });

  it("ignores an empty patch", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);
    const gameId = await sessions.create(newSession(player.id));

    await expect(sessions.update(gameId, {})).resolves.toBeUndefined();
    expect(await sessions.getById(gameId)).toMatchObject({ mode: "explore" });
  });

  it("lists only the player's own sessions", async () => {
    const players = createPlayerStore(db);
    const ada = players.create("Ada");
    const grace = players.create("Grace");

    const adaSessions = createSessionStore(db, ada.id);
    const graceSessions = createSessionStore(db, grace.id);

    const adaGame = await adaSessions.create(newSession(ada.id));
    await graceSessions.create(newSession(grace.id));

    expect((await adaSessions.listForPlayer()).map((s) => s.id)).toEqual([adaGame]);
    expect(await graceSessions.listForPlayer()).toHaveLength(1);
    expect((await graceSessions.listForPlayer())[0].id).not.toBe(adaGame);
  });

  it("hides another player's session and refuses to write to it", async () => {
    const players = createPlayerStore(db);
    const ada = players.create("Ada");
    const grace = players.create("Grace");

    const adaSessions = createSessionStore(db, ada.id);
    const graceSessions = createSessionStore(db, grace.id);
    const adaGame = await adaSessions.create(newSession(ada.id));

    expect(await graceSessions.getById(adaGame)).toBeNull();

    // A no-op: no error, no change.
    await graceSessions.update(adaGame, { mode: "ended", outcome: "lose" });
    expect(await adaSessions.getById(adaGame)).toMatchObject({
      mode: "explore",
      outcome: null,
    });

    await expect(graceSessions.create(newSession(ada.id))).rejects.toThrow(
      /another player/,
    );
  });
});

describe("event store", () => {
  it("allocates sequences and rebuilds history in order", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);
    const events = createEventStore(db, player.id);
    const gameId = await sessions.create(newSession(player.id));

    expect(await events.nextSequence(gameId)).toBe(1);

    await events.insert(newEvent(gameId, 1));
    expect(await events.nextSequence(gameId)).toBe(2);

    await events.insert({ ...newEvent(gameId, 2), payload: null, model: null });

    const history = await events.listBySession(gameId);
    expect(history.map((e) => e.sequence)).toEqual([1, 2]);
    expect(history[0]).toMatchObject({
      event_type: "move",
      actor: "narrator",
      narration: "You step into the garden.",
      payload: { location_id: "loc_garden" },
      model: "mock/runtime-default",
    });
    expect(history[0].narration_parts).toEqual([
      {
        text: "You step into the garden.",
        speaker: { kind: "narrator", key: "narrator", label: "Narrator" },
      },
    ]);
    expect(history[1]).toMatchObject({ payload: null, model: null });
  });

  it("rejects a duplicate sequence for the same session", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);
    const events = createEventStore(db, player.id);
    const gameId = await sessions.create(newSession(player.id));

    await events.insert(newEvent(gameId, 1));
    await expect(events.insert(newEvent(gameId, 1))).rejects.toThrow();
  });

  it("rejects an event with no narration parts", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);
    const events = createEventStore(db, player.id);
    const gameId = await sessions.create(newSession(player.id));

    await expect(
      events.insert({ ...newEvent(gameId, 1), narration_parts: [] }),
    ).rejects.toThrow();
  });

  it("scopes every operation to the owning player", async () => {
    const players = createPlayerStore(db);
    const ada = players.create("Ada");
    const grace = players.create("Grace");

    const adaSessions = createSessionStore(db, ada.id);
    const adaEvents = createEventStore(db, ada.id);
    const graceEvents = createEventStore(db, grace.id);

    const gameId = await adaSessions.create(newSession(ada.id));
    await adaEvents.insert(newEvent(gameId, 1));

    expect(await graceEvents.listBySession(gameId)).toEqual([]);
    expect(await graceEvents.nextSequence(gameId)).toBe(1);
    await expect(graceEvents.insert(newEvent(gameId, 2))).rejects.toThrow(
      /not available to this player/,
    );
  });

  it("deletes a session's events with the session", async () => {
    const player = createPlayerStore(db).create("Ada");
    const sessions = createSessionStore(db, player.id);
    const events = createEventStore(db, player.id);
    const gameId = await sessions.create(newSession(player.id));
    await events.insert(newEvent(gameId, 1));

    db.prepare("delete from game_sessions where id = ?").run(gameId);

    expect(
      db.prepare("select count(*) as total from game_events").get(),
    ).toEqual({ total: 0 });
  });
});
