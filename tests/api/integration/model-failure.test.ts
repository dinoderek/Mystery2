import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  patchStoredSession,
  readStoredEvents,
  readStoredSession,
  setupApiTestAuth,
  TEST_CONFIG_ROOT,
  testDatabase,
  type ApiAuthContext,
} from "./helpers";

// A model call that fails writes nothing. The narrator here is a live profile
// pointed at the suite's unreachable OpenRouter URL, so the call fails after
// the request has been accepted. Only this file writes the `paid` profile:
// test files run in parallel, and a second writer could remove it mid-test.

const PAID_ENV_PATH = path.join(TEST_CONFIG_ROOT, ".env.ai.paid.local");

describe("a failed model call", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("model-failure");
    fs.writeFileSync(
      PAID_ENV_PATH,
      ["AI_PROVIDER=openrouter", "OPENROUTER_API_KEY=test-key", "AI_MODEL=test/unreachable"].join("\n") + "\n",
    );
  });

  afterEach(() => {
    fs.rmSync(PAID_ENV_PATH, { force: true });
  });

  function storedSessionCount(): number {
    const row = testDatabase()
      .prepare("select count(*) as n from game_sessions where player_id = ?")
      .get(auth.id);
    return Number(row?.n);
  }

  it("leaves no session and no events behind when starting a game", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID, ai_profile: "paid" }),
    });

    expect(res.status).toBe(500);
    expect(storedSessionCount()).toBe(0);
    const orphanEvents = testDatabase()
      .prepare(
        `select count(*) as n from game_events
          where session_id not in (select id from game_sessions)`,
      )
      .get();
    expect(Number(orphanEvents?.n)).toBe(0);
  });

  it("leaves the session and its events as they were when playing a turn", async () => {
    const start = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    const { game_id: gameId } = await start.json();
    // The game began under the mock; its next turn reaches the live profile.
    patchStoredSession(gameId, { ai_profile_id: "paid" });
    const before = readStoredSession(gameId);
    const eventsBefore = readStoredEvents(gameId);

    const res = await fetch(`${API_URL}/game-turn`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, input: "search" }),
    });

    expect(res.status).toBe(503);
    expect((await res.json()).details).toMatchObject({ retriable: true });
    expect(readStoredSession(gameId)).toEqual(before);
    expect(readStoredEvents(gameId)).toEqual(eventsBefore);
  });
});
