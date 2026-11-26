import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import { USAGE, main } from "../../../scripts/dev-cli.mjs";
import { snapshotDatabase } from "../../../scripts/lib/database-snapshot.mjs";
import { SESSIONS_USAGE } from "../../../scripts/lib/dev-sessions.mjs";
import {
  beginRecording,
  finishRecording,
  localDate,
  notesHeading,
  planRecording,
  playedOn,
  resolvePlaytestDir,
  runBundle,
  updateNotes,
  writeBundle,
} from "../../../scripts/lib/playtest-recording.mjs";
import { createGameDatabase } from "./trace-database-fixture.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const DRIVER = path.join(__dirname, "playtest-launcher-driver.mjs");
/** The local day the fixture's game was played on (it starts at 2026-06-02T00:00Z). */
const DATE = localDate(new Date("2026-06-02T00:00:00Z"));

let configRoot: string;
let env: Record<string, string>;

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "playtest-recording-"));
  env = { MYSTERY_CONFIG_ROOT: configRoot };
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

const bundleDir = () => path.join(configRoot, "playtests", DATE);
const prodDir = () => path.join(configRoot, "database", "prod");

/** A `prod` database in the temporary config root, with the fixture's one game. */
function createProd() {
  return createGameDatabase(prodDir());
}

/** Adds a game to a database, by default 30 seconds after the fixture's, so on the same local day. */
function addGame(file: string, id: string, outcome: string | null = "solved", startedAt = "2026-06-02T00:00:30Z") {
  const db = openDatabase({ path: file });
  try {
    db.prepare(
      `insert into game_sessions (id, player_id, blueprint_id, mode, current_location_id, time_remaining, outcome,
                                   created_at, updated_at, clue_graph_snapshot)
       values (?, 'player-1', 'case-b', 'explore', 'loc', 5, ?, ?, ?, ?)`,
    ).run(id, outcome, startedAt, startedAt, JSON.stringify({ metadata: { title: "The Second Case" } }));
  } finally {
    db.close();
  }
}

describe("whether a run records", () => {
  it("records on prod, into <config root>/playtests/<date>/, with the call log there and colour forced", () => {
    const recording = planRecording({ root: REPO_ROOT, env, databaseName: "prod", date: DATE });
    expect(recording).toEqual({
      dir: bundleDir(),
      serverLog: path.join(bundleDir(), "server.log"),
      databaseFile: path.join(prodDir(), "game.db"),
      env: { ...env, AI_CALL_LOG: path.join(bundleDir(), "ai-calls.jsonl"), FORCE_COLOR: "1" },
    });
  });

  it("records nothing on any other database", () => {
    for (const databaseName of ["main", "test", "feature-x", "prod-copy"]) {
      expect(planRecording({ root: REPO_ROOT, env, databaseName, date: DATE }), databaseName).toBeNull();
    }
  });

  it("keeps an AI_CALL_LOG already set, but not a blank one", () => {
    const preset = planRecording({ root: REPO_ROOT, env: { ...env, AI_CALL_LOG: "/elsewhere/calls.jsonl" }, databaseName: "prod", date: DATE });
    expect(preset?.env.AI_CALL_LOG).toBe("/elsewhere/calls.jsonl");
    const blank = planRecording({ root: REPO_ROOT, env: { ...env, AI_CALL_LOG: "  " }, databaseName: "prod", date: DATE });
    expect(blank?.env.AI_CALL_LOG).toBe(path.join(bundleDir(), "ai-calls.jsonl"));
  });

  it("names the folder by the local date", () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe("2026-12-31");
  });

  it("puts the bundle outside the checkout when a config root is set", () => {
    const dir = resolvePlaytestDir(REPO_ROOT, env, DATE);
    const relative = path.relative(REPO_ROOT, dir);
    expect(relative.startsWith("..") || path.isAbsolute(relative)).toBe(true);
    expect(dir.startsWith(configRoot)).toBe(true);
  });

  it("would put it in the checkout's gitignored playtests/ without one", () => {
    const dir = resolvePlaytestDir(REPO_ROOT, {}, DATE);
    expect(dir).toBe(path.join(REPO_ROOT, "playtests", DATE));
    for (const file of ["server.log", "game.db", "notes.md", "ai-calls.jsonl"]) {
      const result = spawnSync("git", ["check-ignore", "-q", path.join("playtests", DATE, file)], { cwd: REPO_ROOT });
      expect(result.status, file).toBe(0);
    }
  });

  it("says where it records, and warns when that is inside the checkout", () => {
    const outside: string[] = [];
    beginRecording({ dir: bundleDir() } as never, { root: REPO_ROOT, env, log: (line: string) => outside.push(line) });
    expect(fs.statSync(bundleDir()).isDirectory()).toBe(true);
    expect(outside).toEqual([`Recording this playtest in ${bundleDir()}`]);

    const inside: string[] = [];
    const dir = path.join(configRoot, "inside");
    beginRecording({ dir } as never, { root: configRoot, env: {}, log: (line: string) => inside.push(line) });
    expect(inside[1]).toContain("set MYSTERY_CONFIG_ROOT");
  });
});

describe("the snapshot", () => {
  it("holds a game still only in the -wal, which a file copy misses", async () => {
    const source = path.join(configRoot, "live.db");
    const writer = new Database(source);
    try {
      writer.pragma("journal_mode = WAL");
      writer.pragma("wal_autocheckpoint = 0");
      writer.exec("create table games (id text primary key)");
      writer.pragma("wal_checkpoint(TRUNCATE)");
      writer.prepare("insert into games (id) values (?)").run("written-not-checkpointed");
      expect(fs.statSync(`${source}-wal`).size).toBeGreaterThan(0);

      const copied = path.join(configRoot, "copied.db");
      fs.copyFileSync(source, copied);
      const snapshot = path.join(configRoot, "snapshot", "game.db");
      await snapshotDatabase(source, snapshot);

      const ids = (file: string) => {
        const db = new Database(file, { readonly: true });
        try {
          return db.prepare("select id from games").all();
        } finally {
          db.close();
        }
      };
      expect(ids(copied)).toEqual([]);
      expect(ids(snapshot)).toEqual([{ id: "written-not-checkpointed" }]);
    } finally {
      writer.close();
    }
  });

  it("replaces an earlier snapshot that day", async () => {
    const { databasePath } = createProd();
    await writeBundle({ dir: bundleDir(), databaseFile: databasePath, log: () => {} });
    addGame(databasePath, "session-later");
    await writeBundle({ dir: bundleDir(), databaseFile: databasePath, log: () => {} });

    const db = new Database(path.join(bundleDir(), "game.db"), { readonly: true });
    try {
      expect(db.prepare("select count(*) as n from game_sessions").get()).toEqual({ n: 2 });
    } finally {
      db.close();
    }
  });

  it("is skipped, and said, when prod does not exist yet", async () => {
    const lines: string[] = [];
    const result = await writeBundle({ dir: bundleDir(), databaseFile: path.join(prodDir(), "game.db"), log: (line: string) => lines.push(line) });
    expect(result).toEqual({ snapshot: false, added: 0 });
    expect(fs.existsSync(path.join(bundleDir(), "game.db"))).toBe(false);
    expect(lines.join("\n")).toContain("no game was started");
  });

  it("logs a failure once, naming the file, and lets the launcher carry on", async () => {
    const { databasePath } = createProd();
    // A file where the folder should be: nothing can be written into it.
    fs.mkdirSync(path.dirname(bundleDir()), { recursive: true });
    fs.writeFileSync(bundleDir(), "");
    const errors: string[] = [];
    const ok = await finishRecording({ dir: bundleDir(), databaseFile: databasePath } as never, { log: () => {}, err: (line: string) => errors.push(line) });
    expect(ok).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain(path.join(bundleDir(), "game.db"));
  });
});

describe("notes.md", () => {
  it("heads each game with its id, profile, case and outcome, oldest first", async () => {
    const { databasePath, sessionId, blueprintId } = createProd();
    addGame(databasePath, "session-later", null);
    const result = await writeBundle({ dir: bundleDir(), databaseFile: databasePath, log: () => {} });

    expect(result).toEqual({ snapshot: true, added: 2 });
    const notes = fs.readFileSync(path.join(bundleDir(), "notes.md"), "utf8");
    expect(notes.startsWith(`# Playtest ${DATE}\n`)).toBe(true);
    const headings = notes.split("\n").filter((line) => line.startsWith("## "));
    expect(headings).toEqual([
      expect.stringMatching(new RegExp(`^## ${sessionId} · Tester · Mock Case \\(${blueprintId}\\) · unfinished$`)),
      "## session-later · Tester · The Second Case (case-b) · unfinished",
    ]);
  });

  it("heads only the games played on the folder's day", async () => {
    const { databasePath, sessionId } = createProd();
    addGame(databasePath, "session-weeks-ago", "solved", "2026-05-01T12:00:00Z");
    await writeBundle({ dir: bundleDir(), databaseFile: databasePath, log: () => {} });
    const notes = fs.readFileSync(path.join(bundleDir(), "notes.md"), "utf8");
    expect(notes).toContain(`## ${sessionId} `);
    expect(notes).not.toContain("session-weeks-ago");
  });

  it("counts a game on every day its span touches", () => {
    const row = { session_id: "s", profile: "Ada", blueprint_id: "b", case_title: null, reading_age: null, turns: 1, outcome: null, duration_seconds: 2 * 86_400 };
    const startedAt = new Date(2026, 6, 1, 20).toISOString();
    expect(playedOn({ ...row, started_at: startedAt }, "2026-06-30")).toBe(false);
    for (const date of ["2026-07-01", "2026-07-02", "2026-07-03"]) expect(playedOn({ ...row, started_at: startedAt }, date), date).toBe(true);
    expect(playedOn({ ...row, started_at: startedAt }, "2026-07-04")).toBe(false);
    expect(playedOn({ ...row, started_at: startedAt, duration_seconds: null }, "2026-07-02")).toBe(false);
  });

  it("adds only the new game the second time, and keeps what the parent wrote", () => {
    const file = path.join(configRoot, "notes.md");
    const row = (id: string, startedAt: string, outcome: string | null) => ({
      session_id: id,
      profile: "Ada",
      blueprint_id: "case-b",
      case_title: "The Missing Jar",
      reading_age: 9,
      turns: 3,
      outcome,
      started_at: startedAt,
      duration_seconds: 60,
    });
    const first = row("s-1", "2026-07-04T10:00:00Z", "solved");
    expect(updateNotes(file, [first], DATE)).toBe(1);

    const parentWrote = "She hesitated at the pantry, then asked for help.";
    fs.appendFileSync(file, `\n${parentWrote}`);
    const before = fs.readFileSync(file, "utf8");

    const second = row("s-2", "2026-07-04T11:00:00Z", null);
    expect(updateNotes(file, [second, first], DATE)).toBe(1);
    const after = fs.readFileSync(file, "utf8");

    expect(after.startsWith(before)).toBe(true);
    expect(after).toContain(parentWrote);
    expect(after.split("\n").filter((line) => line.startsWith("## "))).toEqual([notesHeading(first), notesHeading(second)]);
    expect(updateNotes(file, [second, first], DATE)).toBe(0);
    expect(fs.readFileSync(file, "utf8")).toBe(after);
  });
});

describe("./dev sessions bundle", () => {
  const run = async (args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const status = await main(["sessions", "bundle", ...args], {
      root: REPO_ROOT,
      out: (text: string) => out.push(text),
      err: (text: string) => err.push(text),
      env,
      execute: () => {
        throw new Error("bundle runs no command");
      },
    });
    return { status, out: out.join("\n"), err: err.join("\n") };
  };

  it("writes the snapshot and notes into that day's folder", async () => {
    const { sessionId } = createProd();
    const result = await run([DATE]);
    expect(result.status).toBe(0);
    expect(fs.existsSync(path.join(bundleDir(), "game.db"))).toBe(true);
    expect(fs.readFileSync(path.join(bundleDir(), "notes.md"), "utf8")).toContain(`## ${sessionId} `);
  });

  it("defaults to today", async () => {
    createProd();
    const now = new Date(2026, 2, 9, 12);
    const status = await runBundle([], { root: REPO_ROOT, out: () => {}, err: () => {}, env, now });
    expect(status).toBe(0);
    expect(fs.existsSync(path.join(configRoot, "playtests", "2026-03-09", "game.db"))).toBe(true);
  });

  it("refuses a date that is not one, and says when there is no prod database", async () => {
    for (const bad of [["2026-02-30"], ["July"], [DATE, "extra"]]) {
      const result = await run(bad);
      expect(result.status, bad.join(" ")).toBe(2);
      expect(result.err).toContain("YYYY-MM-DD");
    }
    const missing = await run([DATE]);
    expect(missing.status).toBe(1);
    expect(missing.out).toContain(path.join(prodDir(), "game.db"));
    expect(fs.existsSync(bundleDir())).toBe(false);
  });

  it("is in ./dev's usage and the sessions usage", () => {
    expect(USAGE).toContain("sessions bundle [<date>]");
    expect(SESSIONS_USAGE).toContain("bundle [<date>]");
  });
});

describe("a recorded launcher run", () => {
  /** Runs the driver against the temporary config root; `signal` is sent once the stand-in is up. */
  function launch(mode: "exit" | "wait", signal?: NodeJS.Signals) {
    const child = spawn(process.execPath, [DRIVER], {
      cwd: REPO_ROOT,
      // The same time zone as this process, so both agree on the fixture game's local day.
      env: { PATH: process.env.PATH, ...(process.env.TZ ? { TZ: process.env.TZ } : {}), ...env, MYSTERY_DATABASE: "prod", PLAYTEST_DATE: DATE, STAND_IN_MODE: mode },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (signal && stdout.includes("stand-in ready")) {
        child.kill(signal);
        signal = undefined;
      }
    });
    child.stderr.on("data", (chunk) => (stderr += chunk));
    return new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve) =>
      child.on("close", (status) => resolve({ status, stdout, stderr })),
    );
  }

  function expectBundle(result: { stdout: string; stderr: string }, sessionId: string) {
    const log = fs.readFileSync(path.join(bundleDir(), "server.log"), "utf8");
    expect(log).toContain("stand-in stdout FORCE_COLOR=1");
    expect(log).toContain("stand-in stderr red\n");
    expect(result.stdout).toContain("stand-in stdout");
    expect(result.stderr).toContain("stand-in stderr \u001b[31mred");
    expect(fs.readFileSync(path.join(bundleDir(), "ai-calls.jsonl"), "utf8")).toContain("stand-in");
    expect(fs.existsSync(path.join(bundleDir(), "game.db"))).toBe(true);
    expect(fs.readFileSync(path.join(bundleDir(), "notes.md"), "utf8")).toContain(`## ${sessionId} `);
    return log;
  }

  it("tees both streams, and bundles after the server exits by itself, keeping its status", async () => {
    const { sessionId } = createProd();
    const result = await launch("exit");
    expect(result.status).toBe(3);
    expectBundle(result, sessionId);
  });

  it.each(["SIGINT", "SIGTERM"] as const)("forwards %s to the server, waits for it, then bundles", async (signal) => {
    const { sessionId } = createProd();
    const result = await launch("wait", signal);
    expect(result.status).toBe(7);
    const log = expectBundle(result, sessionId);
    expect(log).toContain(`stand-in got ${signal}`);
  });

  it("appends to the day's logs when started again", async () => {
    createProd();
    await launch("exit");
    await launch("exit");
    const log = fs.readFileSync(path.join(bundleDir(), "server.log"), "utf8");
    expect(log.match(/stand-in stdout/g)).toHaveLength(2);
    expect(fs.readFileSync(path.join(bundleDir(), "ai-calls.jsonl"), "utf8").trim().split("\n")).toHaveLength(2);
  });
});
