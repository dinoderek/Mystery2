// A mock-AI playtest on `prod`, end to end: the real launcher (`scripts/dev.mjs
// --db prod`, what `npm run prod` runs) serves the game from a temporary config
// root, two profiles play two games over HTTP, the launcher is stopped by
// signal twice, and then `./dev sessions`, `./dev sessions bundle` and
// `./dev eval judge game` run on what the playtest left behind, the judges on
// the stub binding the trace tests use. A server exiting by itself is left to
// the launcher's unit test (`tests/api/unit/playtest-recording.test.ts`): Vite's
// dev server does not. Each assertion names the objective it proves
// (`docs/local-infrastructure.md`, "Playtest bundles").
//
// Nothing here may touch a real database: every path is asserted to be outside
// the checkout and the operator's config root before it is used.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";

import Database from "better-sqlite3";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readResult } from "../../../evaluation/core/result.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import { createTestConfigRoot } from "../../../scripts/lib/test-server.mjs";
import { resolveLocalConfigRoot } from "../../../scripts/local-config.mjs";
import { MOCK_CASE_ID } from "../../testkit/src/mock-case.ts";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const MOCK_JUDGE = path.join(REPO_ROOT, "tests/api/unit/trace-mock-judge.mjs");
/** Where the operator's own databases and bundles live, resolved before anything here changes the environment. */
const OPERATOR_ROOT = resolveLocalConfigRoot(REPO_ROOT, process.env);
const READY_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;

/**
 * A time zone where it is about noon now. Every command runs in it, so the
 * bundle folder, named by the local date, cannot change between the two
 * launches by crossing midnight.
 */
function noonTimeZone(now: Date): string {
  const offset = 12 - now.getUTCHours();
  return offset === 0 ? "Etc/GMT" : `Etc/GMT${offset > 0 ? "-" : "+"}${Math.abs(offset)}`;
}
const TIME_ZONE = noonTimeZone(new Date());
/** Today in that zone, as the bundle folder is named. */
const TODAY = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

let configRoot = "";

/** Fails unless `file` is under the temporary config root, and so in neither the checkout nor the operator's root. */
function expectIsolated(file: string, what: string) {
  const inside = (dir: string) => {
    const relative = path.relative(dir, file);
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  };
  expect(inside(configRoot), `${what} (${file}) is under the test's config root`).toBe(true);
  expect(inside(REPO_ROOT), `${what} (${file}) is outside the checkout`).toBe(false);
  expect(inside(OPERATOR_ROOT), `${what} (${file}) is outside the operator's config root`).toBe(false);
}

/**
 * The environment every command here runs with: the temporary config root and
 * nothing of the operator's, so no exported database name, call log or AI can
 * reach it. Mock narrates, since the root has no `ai.json`; the live backends
 * point nowhere, as in the suites.
 */
function commandEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PATH: process.env.PATH ?? "",
    ...(process.env.HOME ? { HOME: process.env.HOME } : {}),
    TZ: TIME_ZONE,
    MYSTERY_CONFIG_ROOT: configRoot,
    OPENROUTER_URL: "http://127.0.0.1:9/unreachable",
    CLAUDE_CLI_PATH: "/nonexistent/claude-cli-disabled-in-tests",
    ...extra,
  };
}

/** Runs `./dev <args>` to completion. */
function dev(args: string[], extra: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "dev"), ...args], {
    cwd: REPO_ROOT,
    env: commandEnv(extra),
    encoding: "utf8",
    timeout: 120_000,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

interface Launcher {
  child: ChildProcess;
  url: string;
  /** Everything the launcher printed so far, colour codes removed. */
  output(): string;
  /** Sends the signal to the launcher alone, as `kill` does, and resolves to its exit status. */
  stop(signal: NodeJS.Signals): Promise<number | null>;
}

const launched: ChildProcess[] = [];

/** Starts `scripts/dev.mjs --db prod` and resolves once its server answers. */
async function launch(): Promise<Launcher> {
  // Its own process group, so cleanup can reach the server should a test fail
  // before the launcher stops it; stdin stays open, as a terminal's would.
  const child = spawn(process.execPath, ["scripts/dev.mjs", "--db", "prod"], {
    cwd: REPO_ROOT,
    env: commandEnv(),
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  launched.push(child);
  let text = "";
  child.stdout!.on("data", (chunk) => (text += chunk));
  child.stderr!.on("data", (chunk) => (text += chunk));
  const closed = new Promise<number | null>((resolve) => child.on("close", (status) => resolve(status)));
  const output = () => stripVTControlCharacters(text);

  const deadline = Date.now() + READY_TIMEOUT_MS;
  let url: string | null = null;
  while (url === null) {
    const local = /Local:\s+(http:\/\/\S+?)\/?\s/.exec(output());
    if (local) url = local[1];
    else if (child.exitCode !== null || Date.now() > deadline) throw new Error(`The launcher never served the game:\n${output()}`);
    else await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await waitForApi(url, output);

  return {
    child,
    url,
    output,
    async stop(signal) {
      child.kill(signal);
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`The launcher did not stop on ${signal}:\n${output()}`)), STOP_TIMEOUT_MS),
      );
      return Promise.race([closed, timeout]);
    },
  };
}

async function waitForApi(url: string, output: () => string) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${url}/api/players`)).ok) return;
    } catch {
      // Not answering yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`The game's API never answered at ${url}:\n${output()}`);
}

/** A profile on the launched server, and the requests it makes. */
class Player {
  private readonly apiUrl: string;
  readonly name: string;
  private readonly cookie: string;

  private constructor(apiUrl: string, name: string, cookie: string) {
    this.apiUrl = apiUrl;
    this.name = name;
    this.cookie = cookie;
  }

  static async create(url: string, name: string, readingAge: number): Promise<Player> {
    const response = await fetch(`${url}/api/player`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, reading_age: readingAge }),
    });
    expect(response.status, `create profile ${name}`).toBe(200);
    const cookie = (response.headers.get("set-cookie") ?? "").split(";")[0];
    return new Player(`${url}/api`, name, cookie);
  }

  /** The same profile on a server started again: the cookie names the database, which has not changed. */
  on(url: string): Player {
    return new Player(`${url}/api`, this.name, this.cookie);
  }

  async post(endpoint: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const response = await fetch(`${this.apiUrl}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: this.cookie },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status, `${this.name} ${endpoint} ${JSON.stringify(body)}: ${JSON.stringify(payload)}`).toBe(200);
    return payload;
  }

  async startGame(): Promise<string> {
    const { game_id: gameId } = await this.post("game-start", { blueprint_id: MOCK_CASE_ID });
    await this.post("game-enter", { game_id: gameId });
    return gameId as string;
  }

  async play(gameId: string, lines: string[]): Promise<Record<string, unknown>> {
    let last: Record<string, unknown> = {};
    for (const input of lines) last = await this.post("game-turn", { game_id: gameId, input });
    return last;
  }
}

interface CallLine {
  game_id: string | null;
  endpoint: string | null;
  request_id: string | null;
  latency_ms: unknown;
  [field: string]: unknown;
}

function readCallLog(file: string): CallLine[] {
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as CallLine);
}

/**
 * A snapshot's events, read from a copy in memory as `./dev sessions` reads a
 * snapshot: a read-only connection to the file would leave a `-wal` and `-shm`
 * in the bundle.
 */
function readEvents(databaseFile: string): Array<{ session_id: string; event_type: string; request_id: string | null }> {
  const bytes = fs.readFileSync(databaseFile);
  // The header's WAL marks, which an in-memory database cannot honour.
  bytes[18] = 1;
  bytes[19] = 1;
  const db = new Database(bytes);
  try {
    return db.prepare("select session_id, event_type, request_id from game_events order by session_id, sequence").all() as never;
  } finally {
    db.close();
  }
}

const notesHeadings = (file: string) =>
  fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("## "));

/** The parent run a batch wrote under `outputRoot`, and each game's result and child result by id. */
async function readBatch(outputRoot: string) {
  const [day] = fs.readdirSync(outputRoot);
  const [name] = fs.readdirSync(path.join(outputRoot, day));
  const dir = path.join(outputRoot, day, name);
  const index = readRunIndex(dir);
  const games = await Promise.all(
    index.subjects.map(async (subject) => {
      const subjectDir = path.join(dir, subject.dir);
      const judgeRoot = path.join(subjectDir, "judge");
      const [childDay] = fs.readdirSync(judgeRoot);
      const [childName] = fs.readdirSync(path.join(judgeRoot, childDay));
      const childDir = path.join(judgeRoot, childDay, childName);
      const [childSubject] = readRunIndex(childDir).subjects;
      return {
        id: subject.id,
        result: await readResult(path.join(subjectDir, "result.json")),
        child: await readResult(path.join(childDir, childSubject.dir, "result.json")),
      };
    }),
  );
  return { index, games: Object.fromEntries(games.map((game) => [game.id, game])) };
}

beforeAll(() => {
  configRoot = createTestConfigRoot();
});

afterAll(() => {
  // The whole group, even when the launcher has exited: a server it left
  // running would keep the port.
  for (const child of launched) {
    try {
      if (child.pid) process.kill(-child.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
  fs.rmSync(configRoot, { recursive: true, force: true });
});

describe("a mock-AI playtest on prod", () => {
  it("is recorded, bundled on SIGINT and SIGTERM, listed and judged (O1–O5)", { timeout: 300_000 }, async () => {
    const prodFile = path.join(configRoot, "database", "prod", "game.db");
    expectIsolated(prodFile, "the prod database");

    // O2: a run on prod records with no flag, into <config root>/playtests/<date>/.
    const first = await launch();
    const recordingLine = /Recording this playtest in (\S+)/.exec(first.output());
    expect(recordingLine, "O2: the launcher says where it records").not.toBeNull();
    const bundle = recordingLine![1];
    expectIsolated(bundle, "O2: the bundle folder");
    expect(path.dirname(bundle), "O2: the bundle is under <config root>/playtests/").toBe(path.join(configRoot, "playtests"));
    expect(path.basename(bundle), "O2: the folder is named by the local date").toBe(TODAY);
    expect(first.output(), "O2: on the prod database").toContain(`Database: prod (${prodFile})`);
    expect(first.output(), "O2: the bundle is not in the checkout").not.toContain("That is inside the checkout");
    const date = path.basename(bundle);
    const file = (name: string) => path.join(bundle, name);

    // Two profiles: Ada wins, Ben starts and is stopped part way, with a line the game refuses.
    const ada = await Player.create(first.url, "Ada", 8);
    const ben = await Player.create(first.url, "Ben", 10);
    const won = await ada.startGame();
    const wonEnd = await ada.play(won, ["search", "inspect the pantry shelf", "go to the Living Room", "search", "accuse", "I think it was Alice, because of the empty cookie jar."]);
    expect(wonEnd.result, "Ada's game is won").toBe("win");
    const lost = await ben.startGame();
    await ben.play(lost, ["accuse Bob took the cookies", "It was Bob"]);

    // O2: the call log and the server's output are in the folder while it runs, and still on the terminal.
    expect(fs.existsSync(file("ai-calls.jsonl")), "O2: ai-calls.jsonl is written while the server runs").toBe(true);
    const serverLog = () => fs.readFileSync(file("server.log"), "utf8");
    expect(serverLog(), "O2: server.log holds the server's output").toMatch(/ready in \d+ ms/);
    expect(first.output(), "O2: the terminal still shows the server's output").toMatch(/ready in \d+ ms/);
    expect(serverLog(), "O2: server.log has no colour codes").toBe(stripVTControlCharacters(serverLog()));

    // O3: SIGINT to the launcher stops the server and leaves the snapshot and notes beside them.
    expect(await first.stop("SIGINT"), "O3: the launcher exits with the server's status on SIGINT").toBe(130);
    expect(first.output(), "O3: the bundle is written on SIGINT").toContain(`Playtest bundle: ${file("game.db")}, 2 new games`);
    const afterSigint = readEvents(file("game.db"));
    const headings = notesHeadings(file("notes.md"));
    expect(headings, "O3: notes.md heads each game with id, profile, case and outcome").toEqual([
      expect.stringMatching(new RegExp(`^## ${won} · Ada · .*\\(${MOCK_CASE_ID}\\) · win$`)),
      expect.stringMatching(new RegExp(`^## ${lost} · Ben · .*\\(${MOCK_CASE_ID}\\) · unfinished$`)),
    ]);

    // O3: started again the same day, Ben loses; SIGTERM leaves a fresh snapshot, logs appended.
    const second = await launch();
    expect(second.output(), "O2: the second run records into the same folder").toContain(`Recording this playtest in ${bundle}`);
    const lostEnd = await ben.on(second.url).play(lost, ["accuse It was definitely Bob", "accuse Bob, I am sure"]);
    expect(lostEnd.result, "Ben's game is lost").toBe("lose");
    expect(await second.stop("SIGTERM"), "O3: the launcher exits with the server's status on SIGTERM").toBe(143);
    expect(second.output(), "O3: the bundle is written on SIGTERM").toContain(`Playtest bundle: ${file("game.db")}, 0 new games`);
    expect(serverLog().match(/ready in \d+ ms/g), "O2: server.log is appended to on a second run").toHaveLength(2);
    const events = readEvents(file("game.db"));
    const eventsOf = (all: typeof events, id: string) => all.filter((event) => event.session_id === id);
    expect(eventsOf(afterSigint, lost).length, "O3: the SIGINT snapshot holds Ben's first turns").toBeGreaterThan(0);
    expect(eventsOf(events, lost).slice(0, eventsOf(afterSigint, lost).length), "O3: the SIGTERM snapshot replaces it").toEqual(eventsOf(afterSigint, lost));
    expect(eventsOf(events, lost).length, "O3: the SIGTERM snapshot holds Ben's last turns").toBeGreaterThan(eventsOf(afterSigint, lost).length);
    expect(notesHeadings(file("notes.md")), "O3: notes.md keeps its headings and adds none for known games").toEqual(headings);

    // O3: `./dev sessions bundle` writes the same by hand.
    fs.rmSync(file("game.db"));
    fs.rmSync(file("notes.md"));
    const byHand = dev(["sessions", "bundle", date]);
    expect(byHand.status, `O3: sessions bundle succeeds: ${byHand.stderr}`).toBe(0);
    expect(readEvents(file("game.db")), "O3: sessions bundle writes the same snapshot").toEqual(events);
    expect(notesHeadings(file("notes.md")).map((line) => line.split(" · ").slice(0, 2).join(" · ")), "O3: sessions bundle heads both games").toEqual([
      `## ${won} · Ada`,
      `## ${lost} · Ben`,
    ]);
    expect(fs.readdirSync(bundle).sort(), "O3: the folder is a self-contained bundle").toEqual(["ai-calls.jsonl", "game.db", "notes.md", "server.log"]);

    // O1: `./dev sessions` lists both games.
    const listed = dev(["sessions", "--database", "prod", "--json"]);
    expect(listed.status, `O1: sessions --database prod --json succeeds: ${listed.stderr}`).toBe(0);
    const rows = JSON.parse(listed.stdout) as Array<Record<string, unknown>>;
    const turnsOf = (id: string) => events.filter((event) => event.session_id === id && event.event_type !== "no_turn_line").length;
    expect(rows, "O1: one row per game, newest first, with id, profile, case, age, turns, outcome, start and duration").toEqual([
      expect.objectContaining({ session_id: lost, profile: "Ben", blueprint_id: MOCK_CASE_ID, case_title: expect.any(String), reading_age: 10, turns: turnsOf(lost), outcome: "lose", started_at: expect.any(String), duration_seconds: expect.any(Number) }),
      expect.objectContaining({ session_id: won, profile: "Ada", blueprint_id: MOCK_CASE_ID, case_title: expect.any(String), reading_age: 8, turns: turnsOf(won), outcome: "win", started_at: expect.any(String), duration_seconds: expect.any(Number) }),
    ]);
    expect(turnsOf(lost), "O1: a refused line is not a turn").toBeLessThan(events.filter((event) => event.session_id === lost).length);
    const table = dev(["sessions", "--database", file("game.db")]);
    expect(table.status, "O1: sessions --database <file> succeeds").toBe(0);
    expect(table.stdout, "O1: the table has its columns").toMatch(/^SESSION\s+PROFILE\s+CASE\s+AGE\s+TURNS\s+OUTCOME\s+STARTED \(UTC\)\s+DURATION/);
    for (const id of [won, lost]) expect(table.stdout, `O1: the table lists ${id}`).toContain(id);
    const ids = (args: string[]) => (JSON.parse(dev(["sessions", "--database", file("game.db"), "--json", ...args]).stdout) as Array<{ session_id: string }>).map((row) => row.session_id);
    expect(ids(["--profile", "Ada"]), "O1: --profile filters by profile").toEqual([won]);
    const startDay = String(rows[1].started_at).slice(0, 10);
    expect(ids(["--since", startDay]).sort(), "O1: --since keeps games started that day").toEqual([won, lost].sort());
    expect(ids(["--since", "2999-01-01"]), "O1: --since drops earlier games").toEqual([]);

    // O4: every call behind a turn joins to its event by request_id, with its duration, tokens and cost.
    const calls = readCallLog(file("ai-calls.jsonl"));
    const turnCalls = calls.filter((call) => call.endpoint === "game-turn");
    for (const id of [won, lost]) expect(turnCalls.some((call) => call.game_id === id), `O4: the call log holds ${id}'s turns`).toBe(true);
    for (const call of turnCalls) {
      expect(call.request_id, `O4: every turn's call has a request_id (${call.game_id})`).toEqual(expect.any(String));
      const joined = events.filter((event) => event.request_id === call.request_id && event.session_id === call.game_id);
      expect(joined.length, `O4: call ${call.request_id} (${call.game_id}) joins to its event`).toBeGreaterThan(0);
      expect(call.latency_ms, `O4: call ${call.request_id} has latency_ms`).toEqual(expect.any(Number));
      for (const field of ["input_tokens", "output_tokens", "cost_usd"]) {
        expect(Object.hasOwn(call, field), `O4: call ${call.request_id} carries ${field} (null under mock)`).toBe(true);
      }
    }

    // O5: one command judges every game, writing one parent run with a child per game.
    const config = path.join(configRoot, "evaluation.json");
    fs.writeFileSync(config, JSON.stringify({ "game-judge": { cmd: process.execPath, args: [MOCK_JUDGE, "{{system_prompt_file}}", "{{user_message_file}}"], extract_path: "result", timeout_ms: 30_000, retries: 0 } }));
    const judgeRuns = path.join(configRoot, "eval-runs");
    expectIsolated(judgeRuns, "O5: the judge runs");
    const judge = async (label: string, args: string[]) => {
      const outputRoot = path.join(judgeRuns, label);
      const run = dev(["eval", "judge", "game", ...args, "--config", config, "--output-root", outputRoot, "--quiet"], { MOCK_JUDGE_MODE: "pass", EVAL_HEARTBEAT_MS: "60000" });
      expect(run.status, `O5: judge game ${label} exits by the core rule: ${run.stdout}\n${run.stderr}`).toBe(0);
      const batch = await readBatch(outputRoot);
      expect(Object.keys(batch.games).sort(), `O5: ${label} judges every game`).toEqual([won, lost].sort());
      for (const game of Object.values(batch.games)) {
        expect(game.child.run.parent_run, `O5: ${label}: ${game.id}'s child run names the batch as its parent`).toBe(batch.index.run.id);
        expect(game.result.verdicts.some((verdict) => verdict.tier === "judge" && verdict.status === "pass"), `O5: ${label}: ${game.id} was judged`).toBe(true);
      }
      return batch;
    };

    const bundled = await judge("bundle", ["--bundle", bundle]);
    for (const id of [won, lost]) {
      const joined = calls.filter((call) => call.game_id === id && events.some((event) => event.session_id === id && event.request_id === call.request_id));
      expect(bundled.games[id].result.production?.calls.length, `O4/O5: --bundle attaches ${id}'s calls, joined by request_id`).toBe(joined.length);
    }
    await judge("ids", [won, lost, "--database", file("game.db")]);
    await judge("since", ["--since", startDay, "--database", "prod"]);
  });
});
