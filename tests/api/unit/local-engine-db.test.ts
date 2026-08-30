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
  SCHEMA_VERSION,
  type Db,
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
      db.prepare("select name from sqlite_master where type = 'table'").all(),
    ).toEqual(
      expect.arrayContaining([
        { name: "players" },
        { name: "game_sessions" },
        { name: "game_events" },
      ]),
    );
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
