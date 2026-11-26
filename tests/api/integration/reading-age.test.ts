import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import { MOCK_BLUEPRINT_ID, readStoredEvents, type ApiAuthContext } from "./helpers";

// The reading age is the profile's, read on every request: each prompt is
// written at it and each narrated event records it. This server logs every AI
// call (`AI_CALL_LOG`), so the prompts the mock was sent can be read back.
// That every prompt builder renders the age it is given is
// `tests/api/unit/reading-age.test.ts`.

const CASE_AGE = 10; // blueprints/clue-graph/mock-case.json

let server: OwnServer;
let logDir: string;
let callLog: string;

beforeAll(async () => {
  logDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-reading-age-"));
  callLog = path.join(logDir, "ai-calls.jsonl");
  server = await startOwnServer({ env: { AI_CALL_LOG: callLog } });
});

afterAll(async () => {
  await server?.stop();
  fs.rmSync(logDir, { recursive: true, force: true });
});

describe("the reading age", () => {
  let ada: ApiAuthContext;
  let grace: ApiAuthContext;

  beforeEach(async () => {
    ada = await server.createPlayer("reading-age-ada");
    grace = await server.createPlayer("reading-age-grace");
  });

  const request = (auth: ApiAuthContext, endpoint: string, body?: unknown) =>
    fetch(`${server.apiUrl}/${endpoint}`, {
      method: body === undefined ? "GET" : "POST",
      headers: auth.headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  async function setAge(auth: ApiAuthContext, age: number | null) {
    const res = await request(auth, "profile-settings", { reading_age: age });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reading_age: age });
  }

  async function start(auth: ApiAuthContext) {
    const res = await request(auth, "game-start", { blueprint_id: MOCK_BLUEPRINT_ID });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect((await request(auth, "game-enter", { game_id: body.game_id })).status).toBe(200);
    return { gameId: body.game_id as string, readingAge: body.reading_age as number, startPayload: body.narration_events[0].payload };
  }

  async function play(auth: ApiAuthContext, gameId: string, input: string) {
    const res = await request(auth, "game-turn", { game_id: gameId, input });
    expect(res.status).toBe(200);
    return res.json();
  }

  async function resumedAge(auth: ApiAuthContext, gameId: string): Promise<number> {
    const res = await request(auth, `game-get?game_id=${gameId}`);
    expect(res.status).toBe(200);
    return (await res.json()).reading_age;
  }

  /** The reader's age every prompt this game sent at an endpoint was written for, in call order. */
  function promptAges(gameId: string, endpoint: string): number[] {
    return fs
      .readFileSync(callLog, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((call) => call.game_id === gameId && call.endpoint === endpoint)
      .map((call) => Number(String(call.prompt).match(/The reader is (\d+) years old/)?.[1]));
  }

  /** Each stored event's type and the age its payload records. */
  const eventAges = (gameId: string) =>
    readStoredEvents(gameId, server.database()).map((event) => [event.event_type, event.payload?.reading_age ?? null]);

  it("writes a game at the profile's age, not its case's, and records it on each narrated event", async () => {
    await setAge(ada, 8);
    const game = await start(ada);
    await play(ada, game.gameId, "search");

    expect(game.readingAge).toBe(8);
    expect(game.startPayload.reading_age).toBe(8);
    expect(promptAges(game.gameId, "game-start")).toEqual([8]);
    expect(promptAges(game.gameId, "game-enter")).toEqual([8]);
    expect(promptAges(game.gameId, "game-turn")).toEqual([8]);
    expect(eventAges(game.gameId)).toEqual([
      ["start", 8],
      ["move", 8],
      ["search", 8],
    ]);
    expect(await resumedAge(ada, game.gameId)).toBe(8);
  });

  it("writes the next turn at a changed age, and leaves earlier events at theirs", async () => {
    await setAge(ada, 8);
    const game = await start(ada);
    await play(ada, game.gameId, "search");

    await setAge(ada, 6);
    expect(await resumedAge(ada, game.gameId)).toBe(6);
    await play(ada, game.gameId, "go to the living room");

    expect(promptAges(game.gameId, "game-turn")).toEqual([8, 6]);
    expect(eventAges(game.gameId)).toEqual([
      ["start", 8],
      ["move", 8],
      ["search", 8],
      ["move", 6],
    ]);
  });

  it("records no age on a line the engine wrote", async () => {
    await setAge(ada, 9);
    const game = await start(ada);
    await play(ada, game.gameId, "help");
    await play(ada, game.gameId, "dance");

    expect(eventAges(game.gameId).slice(2)).toEqual([
      ["no_turn_line", null],
      ["no_turn_line", null],
    ]);
  });

  it("plays a profile with no age at its case's age", async () => {
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: null });

    const game = await start(ada);
    await play(ada, game.gameId, "search");

    expect(game.readingAge).toBe(CASE_AGE);
    expect(promptAges(game.gameId, "game-turn")).toEqual([CASE_AGE]);
    expect(eventAges(game.gameId).map(([, age]) => age)).toEqual([CASE_AGE, CASE_AGE, CASE_AGE]);
  });

  it("leaves every other profile at its own age", async () => {
    await setAge(ada, 11);
    await setAge(grace, 7);

    expect((await start(grace)).readingAge).toBe(7);
    expect((await start(ada)).readingAge).toBe(11);
  });

  it("refuses an age outside the range the narrator writes for", async () => {
    for (const age of [5, 12]) {
      const res = await request(ada, "profile-settings", { reading_age: age });
      expect(res.status).toBe(400);
      expect((await res.json()).details.field).toBe("reading_age");
    }
    expect(await (await request(ada, "profile-settings")).json()).toEqual({ reading_age: null });
  });
});
