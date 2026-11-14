// Replaying through the game server: what the harness seeds, where, and what it
// asks. A small HTTP server stands in for the game's, so this needs no build and
// no model, and the database it seeds is a real one with the real schema, in a
// temporary config root of the test's own.

import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { openDatabase } from "../../../packages/game-engine/src/db/client.ts";
import type { TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { ServerNarrator } from "../../../evaluation/runtime/lib/replay-server.ts";
import type { StartServer, ThrowawayServer } from "../../../evaluation/runtime/lib/replay-server.ts";
import { seedSessionWithHistory } from "../../../evaluation/runtime/lib/seed.ts";

const REPO_ROOT = process.cwd();
const MOCK_BLUEPRINT = path.join(REPO_ROOT, "blueprints", "mock-blueprint.json");
const blueprint = JSON.parse(fs.readFileSync(MOCK_BLUEPRINT, "utf8"));

let scratch = "";

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-replay-server-"));
});

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

interface Seen {
  calls: Array<{ endpoint: string; body: Record<string, unknown> }>;
  started: number;
  stopped: number;
  servers: ThrowawayServer[];
}

/** A stand-in game server on the requested port, over a real database in its own config root. */
function fakeServer(answer: (endpoint: string) => { status: number; body: unknown } = defaultAnswer): { start: StartServer; seen: Seen } {
  const seen: Seen = { calls: [], started: 0, stopped: 0, servers: [] };
  const start: StartServer = async ({ port }) => {
    const configRoot = fs.mkdtempSync(path.join(scratch, "root-"));
    const databaseFile = path.join(configRoot, "database", "test", "game.db");
    openDatabase({ path: databaseFile }).close();
    const server = http.createServer((request, response) => {
      let text = "";
      request.on("data", (chunk) => (text += chunk));
      request.on("end", () => {
        const body = text ? JSON.parse(text) : {};
        const endpoint = String(request.url).replace(/^\/api\//, "");
        if (endpoint === "player") {
          const db = openDatabase({ path: databaseFile });
          const now = new Date().toISOString();
          db.prepare("insert into players (id, name, created_at, updated_at) values (?, ?, ?, ?)").run(`id-${body.name}`, body.name, now, now);
          db.close();
          response.writeHead(200, { "content-type": "application/json", "set-cookie": "mystery-player-id-x=1; Path=/" });
          response.end(JSON.stringify({ player: { id: `id-${body.name}`, name: body.name } }));
          return;
        }
        seen.calls.push({ endpoint, body });
        const reply = answer(endpoint);
        response.writeHead(reply.status, { "content-type": "application/json" });
        response.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
    seen.started += 1;
    const running: ThrowawayServer = {
      url: `http://127.0.0.1:${port}`,
      configRoot,
      databaseFile,
      stop: async () => {
        seen.stopped += 1;
        await new Promise((resolve) => server.close(resolve));
      },
    };
    seen.servers.push(running);
    return running;
  };
  return { start, seen };
}

function defaultAnswer(endpoint: string) {
  const parts = [{ text: "Hello there.", speaker: { kind: "character", key: "character:alice", label: "Alice" } }];
  return endpoint === "game-start"
    ? { status: 200, body: { narration_events: [{ narration_parts: parts }] } }
    : { status: 200, body: { kind: "turn", events: [{ event_type: "ask", narration_parts: parts }] } };
}

const askCase: TurnCase = {
  id: "ask-alice",
  blueprint: { path: "blueprints/mock-blueprint.json" },
  given: {
    mode: "talk",
    location_id: "loc-kitchen",
    talk_character_id: "char-alice",
    time_remaining: 7,
    discovered_clues: ["clue-crumb"],
    history: [
      { event_type: "talk", narration: "You step closer.", payload: { character_id: "char-alice" } },
      { event_type: "ask", narration: '"Hm," says Alice.', payload: { player_input: "Hi" } },
    ],
  },
  action: { type: "ask", player_input: "Then why are your hands shaking?" },
};

const request = (testCase: TurnCase, aiProfile = "mock", blueprintPath = MOCK_BLUEPRINT) => ({ testCase, blueprint, blueprintPath, aiProfile });

const narrators: ServerNarrator[] = [];

function narrator(start: StartServer, env: NodeJS.ProcessEnv = {}): ServerNarrator {
  const made = new ServerNarrator({ repoRoot: REPO_ROOT, start, env });
  narrators.push(made);
  return made;
}

afterEach(async () => {
  await Promise.all(narrators.splice(0).map((made) => made.stop()));
});

describe("replaying through a throwaway server", () => {
  it("seeds the case's session and history into the server's own database, then plays the line", async () => {
    const { start, seen } = fakeServer();
    const collected = await narrator(start).replay(request(askCase, "free-ish"));

    expect(collected.response.narration_text).toBe("Hello there.");
    expect(collected.model).toBe("free-ish");
    expect(collected.call).toBeNull();
    expect(seen.calls).toHaveLength(1);
    expect(seen.calls[0].endpoint).toBe("game-turn");
    expect(seen.calls[0].body.input).toBe("Then why are your hands shaking?");

    const db = openDatabase({ path: seen.servers[0].databaseFile, readonly: true });
    const session = db.prepare("select * from game_sessions").get() as Record<string, unknown>;
    expect(session).toMatchObject({
      id: seen.calls[0].body.game_id,
      blueprint_id: blueprint.id,
      ai_profile_id: "free-ish",
      mode: "talk",
      current_location_id: "loc-kitchen",
      current_talk_character_id: "char-alice",
      time_remaining: 7,
    });
    const events = db.prepare("select sequence, event_type, narration from game_events order by sequence").all();
    expect(events).toEqual([
      { sequence: 1, event_type: "talk", narration: "You step closer." },
      { sequence: 2, event_type: "ask", narration: '"Hm," says Alice.' },
    ]);
    db.close();
  });

  it("starts one server for a whole run, and stops it once", async () => {
    const { start, seen } = fakeServer();
    const made = narrator(start);
    await Promise.all([made.replay(request(askCase)), made.replay(request(askCase))]);
    expect(seen.started).toBe(1);
    await made.stop();
    await made.stop();
    expect(seen.stopped).toBe(1);
  });

  it("seeds nothing for a start action, which creates its own session", async () => {
    const { start, seen } = fakeServer();
    const startCase: TurnCase = { id: "intro", blueprint: askCase.blueprint, given: {}, action: { type: "start" } };
    const collected = await narrator(start).replay(request(startCase, "mock"));
    expect(seen.calls[0]).toMatchObject({ endpoint: "game-start", body: { blueprint_id: blueprint.id, ai_profile: "mock" } });
    expect(collected.response.narration_text).toBe("Hello there.");
    const db = openDatabase({ path: seen.servers[0].databaseFile, readonly: true });
    expect(db.prepare("select count(*) as n from game_sessions").get()).toEqual({ n: 0 });
    db.close();
  });

  it("gives the server a blueprint that is not the repo's", async () => {
    const { start, seen } = fakeServer();
    const outside = path.join(scratch, "elsewhere", "mine.json");
    fs.mkdirSync(path.dirname(outside), { recursive: true });
    fs.copyFileSync(MOCK_BLUEPRINT, outside);
    const made = narrator(start);
    await made.replay(request(askCase, "mock", outside));
    expect(fs.existsSync(path.join(seen.servers[0].configRoot, "blueprints", "mine.json"))).toBe(true);
    await made.replay(request(askCase, "mock", MOCK_BLUEPRINT));
    expect(fs.readdirSync(path.join(seen.servers[0].configRoot, "blueprints"))).toEqual(["mine.json"]);
  });

  it("links a file-backed profile from the operator's config root, leaving the key in its file", async () => {
    const operator = fs.mkdtempSync(path.join(scratch, "operator-"));
    fs.writeFileSync(path.join(operator, ".env.ai.free.local"), "AI_PROVIDER=openrouter\n");
    fs.writeFileSync(path.join(operator, ".env.local"), "OPENROUTER_API_KEY=key\n");
    const { start, seen } = fakeServer();
    await narrator(start, { MYSTERY_CONFIG_ROOT: operator }).replay(request(askCase, "free"));
    const linked = path.join(seen.servers[0].configRoot, ".env.ai.free.local");
    expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(linked)).toBe(fs.realpathSync(path.join(operator, ".env.ai.free.local")));
    expect(fs.lstatSync(path.join(seen.servers[0].configRoot, ".env.local")).isSymbolicLink()).toBe(true);
  });

  it("links nothing for a profile that needs no file", async () => {
    const { start, seen } = fakeServer();
    await narrator(start, { MYSTERY_CONFIG_ROOT: scratch }).replay(request(askCase, "mock"));
    expect(fs.readdirSync(seen.servers[0].configRoot).filter((name) => name.startsWith(".env"))).toEqual([]);
  });

  it("fails a turn the server refuses, naming the endpoint and the status", async () => {
    const { start } = fakeServer(() => ({ status: 400, body: { error: "Invalid ai_profile" } }));
    await expect(narrator(start).replay(request(askCase, "nope"))).rejects.toThrow(/game-turn failed: HTTP 400.*Invalid ai_profile/);
  });

  it("fails a line the server did not play as the case's action", async () => {
    const { start } = fakeServer(() => ({ status: 200, body: { kind: "refused", hint: "try again" } }));
    await expect(narrator(start).replay(request(askCase))).rejects.toThrow(/did not play.*refused.*try again/);
  });

  it("refuses a case a typed line cannot carry", async () => {
    const { start, seen } = fakeServer();
    const accuse: TurnCase = { ...askCase, action: { type: "accuse", accusation_history_mode: "full" } };
    await expect(narrator(start).replay(request(accuse))).rejects.toThrow(/accusation_history_mode/);
    expect(seen.started).toBe(0);
  });
});

describe("a server that cannot start", () => {
  it("fails every replay with the start error, and stops without throwing it again", async () => {
    const made = narrator(async () => {
      throw new Error("port taken");
    });
    await expect(made.replay(request(askCase))).rejects.toThrow("port taken");
    await expect(made.stop()).resolves.toBeUndefined();
  });
});

describe("seedSessionWithHistory", () => {
  it("refuses a case without the state it must seed", () => {
    expect(() =>
      seedSessionWithHistory({ databaseFile: path.join(scratch, "never.db"), blueprint, given: { mode: "talk" }, aiProfile: "mock", playerName: "x" }),
    ).toThrow(/needs given.mode/);
    expect(fs.existsSync(path.join(scratch, "never.db"))).toBe(false);
  });

  it("names the profile it could not find", () => {
    const databaseFile = path.join(scratch, "empty", "game.db");
    expect(() =>
      seedSessionWithHistory({ databaseFile, blueprint, given: { mode: "explore", location_id: "l", time_remaining: 1 }, aiProfile: "mock", playerName: "ghost" }),
    ).toThrow(/no profile named ghost/);
  });
});
