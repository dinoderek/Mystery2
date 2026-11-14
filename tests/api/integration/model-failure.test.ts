import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import {
  MOCK_BLUEPRINT_ID,
  patchStoredSession,
  readStoredEvents,
  readStoredSession,
  type ApiAuthContext,
} from "./helpers";

// A model call that fails writes nothing. The narrator here is a live AI
// pointed at the suite's unreachable OpenRouter URL, so the call fails after
// the request has been accepted. A server reads `ai.json` only at start, and
// the suite's has none, so this file starts a server of its own with one.

let server: OwnServer;
let auth: ApiAuthContext;

beforeAll(async () => {
  server = await startOwnServer({
    aiConfig: { ais: { paid: { backend: "openrouter", model: "test/unreachable", key: "test-key" } } },
  });
});

afterAll(async () => {
  await server?.stop();
});

describe("a failed model call", () => {
  beforeEach(async () => {
    auth = await server.createPlayer("model-failure");
  });

  function storedSessionCount(): number {
    const row = server
      .database()
      .prepare("select count(*) as n from game_sessions where player_id = ?")
      .get(auth.id);
    return Number(row?.n);
  }

  it("leaves no session and no events behind when starting a game", async () => {
    const res = await fetch(`${server.apiUrl}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID, ai_profile: "paid" }),
    });

    expect(res.status).toBe(500);
    expect(storedSessionCount()).toBe(0);
    const orphanEvents = server
      .database()
      .prepare(
        `select count(*) as n from game_events
          where session_id not in (select id from game_sessions)`,
      )
      .get();
    expect(Number(orphanEvents?.n)).toBe(0);
  });

  it("leaves the session and its events as they were when playing a turn", async () => {
    const start = await fetch(`${server.apiUrl}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    const { game_id: gameId } = await start.json();
    // The game began under the mock; its next turn reaches the live AI.
    const db = server.database();
    patchStoredSession(gameId, { ai_profile_id: "paid" }, db);
    const before = readStoredSession(gameId, db);
    const eventsBefore = readStoredEvents(gameId, db);

    const res = await fetch(`${server.apiUrl}/game-turn`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, input: "search" }),
    });

    expect(res.status).toBe(503);
    expect((await res.json()).details).toMatchObject({ retriable: true });
    expect(readStoredSession(gameId, db)).toEqual(before);
    expect(readStoredEvents(gameId, db)).toEqual(eventsBefore);
  });
});
