import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import {
  formatSessionsTable,
  listSessions,
  parseSessionsArgs,
  resolveSessionsDatabase,
  runSessions,
} from "../../../scripts/lib/dev-sessions.mjs";
import { createGameDatabase, PLAYED_AT } from "./trace-database-fixture.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SNAPSHOT = JSON.stringify({ metadata: { title: "The Missing Jar" } });
const PARTS = JSON.stringify([{ text: "x", speaker: { kind: "narrator" } }]);

let scratch: string;
let file: string;

beforeEach(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "dev-sessions-"));
  file = createGameDatabase(scratch).databasePath;
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

interface SessionSeed {
  id: string;
  player: string;
  startedAt: string;
  outcome?: string | null;
  /** [event_type, created_at, the reading age it records] in sequence order. */
  events: Array<[string, string, number?]>;
}

/** Adds a player (if new) and a session with events to the fixture database. */
function seed({ id, player, startedAt, outcome = null, events }: SessionSeed): void {
  const db = openDatabase({ path: file });
  try {
    db.prepare("insert or ignore into players (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(player, player, startedAt, startedAt);
    db.prepare(
      `insert into game_sessions (id, player_id, blueprint_id, mode, current_location_id, time_remaining, outcome,
                                   created_at, updated_at, clue_graph_snapshot)
       values (?, ?, 'case-b', 'explore', 'loc', 5, ?, ?, ?, ?)`,
    ).run(id, player, outcome, startedAt, startedAt, SNAPSHOT);
    events.forEach(([type, at, age], index) => {
      db.prepare(
        `insert into game_events (id, session_id, sequence, event_type, actor, payload, narration, narration_parts, created_at)
         values (?, ?, ?, ?, 'player', ?, 'n', ?, ?)`,
      ).run(`${id}-e${index}`, id, index + 1, type, age === undefined ? null : JSON.stringify({ reading_age: age }), PARTS, at);
    });
  } finally {
    db.close();
  }
}

interface Row {
  session_id: string;
}

const digest = (target: string) => createHash("sha256").update(fs.readFileSync(target)).digest("hex");

describe("listSessions", () => {
  it("carries every field of a game", async () => {
    seed({
      id: "s-full",
      player: "Ada",
      startedAt: "2026-07-01T10:00:00.000Z",
      outcome: "solved",
      // The age changed mid-game: the latest narrated event's is the game's now.
      events: [["start", "2026-07-01T10:00:00.000Z", 7], ["search", "2026-07-01T10:05:30.000Z", 9], ["talk", "2026-07-01T10:12:05.000Z"]],
    });

    const rows = await listSessions(file);

    expect(rows.find((row: Row) => row.session_id === "s-full")).toEqual({
      session_id: "s-full",
      profile: "Ada",
      blueprint_id: "case-b",
      case_title: "The Missing Jar",
      reading_age: 9,
      turns: 3,
      outcome: "solved",
      started_at: "2026-07-01T10:00:00.000Z",
      duration_seconds: 725,
    });
  });

  it("lists the fixture game with a null outcome, at the age its narrated event records", async () => {
    const [row] = await listSessions(file);

    expect(row).toMatchObject({ session_id: "session-under-test", profile: "Tester", outcome: null, reading_age: PLAYED_AT, turns: 2 });
  });

  it("leaves no_turn_line and age_change out of the turns but not out of the duration", async () => {
    seed({
      id: "s-refused",
      player: "Ada",
      startedAt: "2026-07-02T10:00:00.000Z",
      events: [["start", "2026-07-02T10:00:00.000Z"], ["no_turn_line", "2026-07-02T10:01:00.000Z"], ["search", "2026-07-02T10:02:00.000Z"], ["age_change", "2026-07-02T10:03:00.000Z"]],
    });

    const row = (await listSessions(file)).find((candidate: Row) => candidate.session_id === "s-refused");

    expect(row?.turns).toBe(2);
    expect(row?.duration_seconds).toBe(180);
  });

  it("has no duration for a game without events", async () => {
    seed({ id: "s-empty", player: "Ada", startedAt: "2026-07-03T10:00:00.000Z", events: [] });

    const row = (await listSessions(file)).find((candidate: Row) => candidate.session_id === "s-empty");

    expect(row).toMatchObject({ turns: 0, duration_seconds: null });
  });

  it("lists newest first", async () => {
    seed({ id: "s-new", player: "Ada", startedAt: "2026-08-01T00:00:00.000Z", events: [] });

    expect((await listSessions(file)).map((row: Row) => row.session_id)).toEqual(["s-new", "session-under-test"]);
  });

  it("keeps games started on or after --since, by date or by timestamp", async () => {
    seed({ id: "s-jul", player: "Ada", startedAt: "2026-07-01T10:00:00.000Z", events: [] });
    seed({ id: "s-aug", player: "Ada", startedAt: "2026-08-01T10:00:00.000Z", events: [] });

    const ids = async (since: string) => (await listSessions(file, { since })).map((row: Row) => row.session_id);

    expect(await ids("2026-07-01")).toEqual(["s-aug", "s-jul"]);
    expect(await ids("2026-07-02")).toEqual(["s-aug"]);
    expect(await ids("2026-08-01T10:00:00Z")).toEqual(["s-aug"]);
    expect(await ids("2026-08-01T10:00:01Z")).toEqual([]);
    await expect(listSessions(file, { since: "last week" })).rejects.toThrow(/--since/);
  });

  it("keeps one profile's games with --profile", async () => {
    seed({ id: "s-ada", player: "Ada", startedAt: "2026-07-01T10:00:00.000Z", events: [] });

    expect((await listSessions(file, { profile: "Ada" })).map((row: Row) => row.session_id)).toEqual(["s-ada"]);
    expect(await listSessions(file, { profile: "Nobody" })).toEqual([]);
  });

  it("names a missing file in the error", async () => {
    const missing = path.join(scratch, "absent", "game.db");

    await expect(listSessions(missing)).rejects.toThrow(missing);
    expect(fs.existsSync(path.dirname(missing))).toBe(false);
  });

  it("returns an empty list for a database with no games", async () => {
    const empty = path.join(scratch, "empty.db");
    openDatabase({ path: empty }).close();

    expect(await listSessions(empty)).toEqual([]);
  });

  it("reads a database as it finds it, without writing or migrating it", async () => {
    const before = digest(file);
    const stat = fs.statSync(file);
    const version = () => {
      const db = openDatabase({ path: file, readonly: true });
      try {
        return db.prepare("pragma user_version").get();
      } finally {
        db.close();
      }
    };
    const versionBefore = version();

    await listSessions(file);

    expect(digest(file)).toBe(before);
    expect(fs.statSync(file).mtimeMs).toBe(stat.mtimeMs);
    expect(version()).toEqual(versionBefore);
  });

  it("leaves the folder as it found it: no -wal or -shm, and a read-only folder still lists", async () => {
    const folder = path.dirname(file);
    expect(fs.readdirSync(folder)).toEqual(["game.db"]);

    await listSessions(file);
    expect(fs.readdirSync(folder)).toEqual(["game.db"]);

    fs.chmodSync(folder, 0o555);
    try {
      expect(await listSessions(file)).toHaveLength(1);
    } finally {
      fs.chmodSync(folder, 0o755);
    }
  });

  it("reads a game being played, and leaves its files alone", async () => {
    const writer = openDatabase({ path: file });
    try {
      writer.prepare("insert into game_sessions (id, player_id, blueprint_id, mode, current_location_id, time_remaining, created_at, updated_at) values ('s-live', 'player-1', 'b', 'explore', 'l', 1, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z')").run();
      const before = fs.readdirSync(path.dirname(file)).sort();

      expect((await listSessions(file)).map((row: Row) => row.session_id)).toContain("s-live");
      expect(fs.readdirSync(path.dirname(file)).sort()).toEqual(before);
    } finally {
      writer.close();
    }
  });

  it("names the file when it is not a database", async () => {
    const notes = path.join(scratch, "notes.db");
    fs.writeFileSync(notes, "just some notes, not a database at all".repeat(10));

    await expect(listSessions(notes)).rejects.toThrow(new RegExp(`could not read ${notes}`));
  });

  it("lists a database from before reading ages", async () => {
    const old = path.join(scratch, "old.db");
    const db = openDatabase({ path: old });
    db.exec("alter table game_sessions drop column reading_age");
    db.prepare("insert into players (id, name, created_at, updated_at) values ('p', 'Ada', 't', 't')").run();
    db.prepare(
      `insert into game_sessions (id, player_id, blueprint_id, mode, current_location_id, time_remaining, created_at, updated_at)
       values ('s-old', 'p', 'b', 'explore', 'l', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    ).run();
    db.close();

    expect(await listSessions(old)).toMatchObject([{ session_id: "s-old", reading_age: null, case_title: null }]);
  });
});

describe("the table and --json", () => {
  it("prints the same rows both ways", async () => {
    seed({
      id: "s-ada",
      player: "Ada",
      startedAt: "2026-07-01T10:00:00.000Z",
      outcome: "solved",
      events: [["start", "2026-07-01T10:00:00.000Z", 8], ["search", "2026-07-01T10:03:05.000Z", 8]],
    });
    const out: string[] = [];
    const context = { root: REPO_ROOT, out: (text: string) => out.push(text), err: () => {}, env: {} };

    expect(await runSessions(["--database", file, "--json"], context)).toBe(0);
    expect(await runSessions(["--database", file], context)).toBe(0);

    const rows = JSON.parse(out[0]);
    expect(rows).toEqual(await listSessions(file));
    expect(out[1]).toBe(formatSessionsTable(rows));
    const line = out[1].split("\n").find((candidate) => candidate.startsWith("s-ada"));
    expect(line).toMatch(/^s-ada\s+Ada\s+case-b The Missing Jar\s+8\s+2\s+solved\s+2026-07-01 10:00\s+3m05s$/);
  });

  it("prints an empty list as [] with --json and as a note otherwise", async () => {
    const empty = path.join(scratch, "empty.db");
    openDatabase({ path: empty }).close();
    const out: string[] = [];
    const context = { root: REPO_ROOT, out: (text: string) => out.push(text), err: () => {}, env: {} };

    await runSessions(["--database", empty, "--json"], context);
    await runSessions(["--database", empty], context);

    expect(JSON.parse(out[0])).toEqual([]);
    expect(out[1]).toBe("No games.");
  });

  it("exits 1 naming the path when the file is missing, and 2 on a usage error", async () => {
    const missing = path.join(scratch, "absent.db");
    const err: string[] = [];
    const context = { root: REPO_ROOT, out: () => {}, err: (text: string) => err.push(text), env: {} };

    expect(await runSessions(["--database", missing], context)).toBe(1);
    expect(err[0]).toContain(missing);
    expect(await runSessions(["--bogus"], context)).toBe(2);
    expect(await runSessions(["--since"], context)).toBe(2);
    expect(await runSessions(["--since", "last week"], context)).toBe(2);
    expect(err.at(-1)).toContain("Usage: ./dev sessions");
    expect(await runSessions(["bundle"], context)).toBe(2);
  });

  it("runs from the executable with no server", () => {
    const result = spawnSync(path.join(REPO_ROOT, "dev"), ["sessions", "--database", file, "--json"], { encoding: "utf8" });

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toHaveLength(1);
  });
});

describe("which database", () => {
  const root = REPO_ROOT;

  it("resolves a name under the config root", () => {
    const env = { MYSTERY_CONFIG_ROOT: scratch };

    expect(resolveSessionsDatabase("prod", { root, env })).toBe(path.join(scratch, "database", "prod", "game.db"));
  });

  it("opens a path, or anything ending in .db, as a file", () => {
    const env = { MYSTERY_CONFIG_ROOT: scratch };

    expect(resolveSessionsDatabase(file, { root, env })).toBe(file);
    expect(resolveSessionsDatabase("snapshots/day.db", { root, env })).toBe(path.resolve("snapshots/day.db"));
    expect(resolveSessionsDatabase("copy.db", { root, env })).toBe(path.resolve("copy.db"));
  });

  it("defaults to this checkout's database, honouring MYSTERY_DATABASE and MYSTERY_CONFIG_ROOT", () => {
    const env = { MYSTERY_CONFIG_ROOT: scratch, MYSTERY_DATABASE: "mine" };

    expect(resolveSessionsDatabase(null, { root, env })).toBe(path.join(scratch, "database", "mine", "game.db"));
  });

  it("refuses an invalid database name", () => {
    expect(() => resolveSessionsDatabase("..", { root, env: {} })).toThrow(/Invalid database name/);
  });

  it("parses the flags", () => {
    expect(parseSessionsArgs(["--since", "2026-07-01", "--profile", "Ada", "--database", "prod", "--json"])).toEqual({
      since: "2026-07-01",
      profile: "Ada",
      database: "prod",
      json: true,
    });
  });
});
