// Extracting a played game opens the play database read-only: the file's
// schema version and bytes are as they were afterwards, and a database from an
// older schema is not migrated.

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SCHEMA_VERSION, openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import {
  createLocalTraceSource,
  extractSessionTrace,
} from "../../../evaluation/trace/lib/datasource.ts";
import { createGameDatabase } from "./trace-database-fixture.ts";

let scratch = "";

afterEach(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  scratch = "";
});

function makeScratch(): string {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "trace-datasource-"));
  return scratch;
}

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

/** The schema version, and the tables, of a database opened without writing to it. */
function inspect(file: string): { version: number; tables: string[] } {
  const db = openDatabase({ path: file, readonly: true });
  try {
    const version = Number((db.prepare("pragma user_version").get() as { user_version: number }).user_version);
    const tables = db
      .prepare("select name from sqlite_master where type = 'table' order by name")
      .all()
      .map((row) => String(row.name));
    return { version, tables };
  } finally {
    db.close();
  }
}

async function extract(game: ReturnType<typeof createGameDatabase>) {
  const source = createLocalTraceSource({ databasePath: game.databasePath, repoRoot: game.root, env: {} });
  try {
    return await extractSessionTrace(source, game.sessionId, { extractedAt: "2026-06-02T00:00:00Z" });
  } finally {
    source.close?.();
  }
}

describe("extraction from a database the test made", () => {
  it("reads the session, its events in order and the blueprint it was played on", async () => {
    const game = createGameDatabase(makeScratch());
    const trace = await extract(game);

    expect(trace.session.id).toBe(game.sessionId);
    expect(trace.session.blueprint_id).toBe(game.blueprintId);
    expect(trace.events.map((event) => event.sequence)).toEqual([1, 2]);
    expect(trace.events[1].payload).toEqual({ location_id: "kitchen", search_query: "the counter" });
    expect((trace.blueprint as unknown as { id: string }).id).toBe(game.blueprintId);
    expect(trace.source).toEqual({ kind: "local", database: path.resolve(game.databasePath) });
  });

  it("leaves the database file as it was", async () => {
    const game = createGameDatabase(makeScratch());
    const before = { bytes: sha256(game.databasePath), ...inspect(game.databasePath) };

    await extract(game);

    expect({ bytes: sha256(game.databasePath), ...inspect(game.databasePath) }).toEqual(before);
    expect(before.version).toBeGreaterThan(0);
  });

  it("does not migrate a database from an older schema", async () => {
    const game = createGameDatabase(makeScratch());
    const db = openDatabase({ path: game.databasePath });
    // What a version-2 database held: the labelled key and model tables.
    db.exec(
      "alter table players drop column reading_age; alter table game_sessions drop column reading_age; alter table game_sessions drop column clue_graph_snapshot; alter table game_sessions drop column msf_snapshot; create table ai_keys (label text primary key); create table ai_models (label text primary key); pragma user_version = 2;",
    );
    db.close();
    const before = { bytes: sha256(game.databasePath), ...inspect(game.databasePath) };
    expect(before.version).toBe(2);
    expect(before.tables).toContain("ai_keys");

    // The control: opening it the way the game does would bring it forward.
    const copy = path.join(scratch, "copy.db");
    fs.copyFileSync(game.databasePath, copy);
    openDatabase({ path: copy }).close();
    expect(inspect(copy).version).toBe(SCHEMA_VERSION);

    const trace = await extract(game);

    expect(trace.events).toHaveLength(2);
    expect({ bytes: sha256(game.databasePath), ...inspect(game.databasePath) }).toEqual(before);
  });

  it("records the model the events carry, whatever the session's AI name and the current settings say", async () => {
    // A browser game is stored as `default`. Resolving that name again now,
    // with no ai.json and nothing chosen, would give mock.
    const game = createGameDatabase(makeScratch(), { profileId: "default", eventModel: "vendor/model-x" });

    const trace = await extract(game);

    expect(trace.session.ai_profile_id).toBe("default");
    expect(trace.ai_profile).toEqual({ id: "default", model: "vendor/model-x" });
  });

  it("reads a game at the age it was narrated for", async () => {
    const game = createGameDatabase(makeScratch());
    const caseAge = ((await extract(game)).blueprint as unknown as { metadata: { target_age: number } }).metadata.target_age;
    const playedAge = caseAge === 6 ? 7 : 6;

    const db = openDatabase({ path: game.databasePath });
    db.prepare("update game_sessions set reading_age = ? where id = ?").run(playedAge, game.sessionId);
    db.close();

    const trace = await extract(game);
    expect((trace.blueprint as unknown as { metadata: { target_age: number } }).metadata.target_age).toBe(playedAge);
  });

  it("names a missing database and creates nothing", () => {
    const dir = makeScratch();
    const missing = path.join(dir, "nowhere", "game.db");

    expect(() => createLocalTraceSource({ databasePath: missing, repoRoot: dir, env: {} })).toThrow(
      /no game database at .*nowhere/,
    );
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("reports a session the database does not have", async () => {
    const game = createGameDatabase(makeScratch());
    const source = createLocalTraceSource({ databasePath: game.databasePath, repoRoot: game.root, env: {} });
    try {
      await expect(extractSessionTrace(source, "no-such-session")).rejects.toThrow(/not found/);
    } finally {
      source.close?.();
    }
  });
});
