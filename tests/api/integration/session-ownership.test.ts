import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  readStoredSession,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

// Ownership is `where player_id = ?` in the engine's repositories, with
// nothing underneath to catch a query that forgets. These assertions go
// through the API, which is the only way in.

describe("session ownership", () => {
  let playerA: ApiAuthContext;
  let playerB: ApiAuthContext;

  beforeEach(async () => {
    playerA = await setupApiTestAuth("ownership-a");
    playerB = await setupApiTestAuth("ownership-b");
  });

  async function startSessionFor(auth: ApiAuthContext): Promise<string> {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).game_id as string;
  }

  it("lets the owner read a session and its transcript", async () => {
    const gameId = await startSessionFor(playerA);

    const res = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: playerA.headers,
    });
    expect(res.status).toBe(200);
    expect((await res.json()).narration_events.length).toBeGreaterThan(0);

    expect(readStoredSession(gameId)).toMatchObject({ mode: "explore" });
    expect(readStoredEvents(gameId).length).toBeGreaterThan(0);
  });

  it("hides another player's session from every endpoint that reads one", async () => {
    const gameId = await startSessionFor(playerA);

    const get = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers: playerB.headers,
    });
    expect(get.status).toBe(404);

    const enter = await fetch(`${API_URL}/game-enter`, {
      method: "POST",
      headers: playerB.headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(enter.status).toBe(400);

    const catalog = await fetch(`${API_URL}/game-sessions-list`, {
      headers: playerB.headers,
    });
    expect(catalog.status).toBe(200);
    expect((await catalog.json()).counts).toEqual({ in_progress: 0, completed: 0 });
  });

  it("refuses a write to another player's session and leaves it untouched", async () => {
    const gameId = await startSessionFor(playerA);
    const before = readStoredSession(gameId);

    const move = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers: playerB.headers,
      body: JSON.stringify({ game_id: gameId, destination: "loc-living-room" }),
    });
    expect(move.status).toBe(400);

    const accuse = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers: playerB.headers,
      body: JSON.stringify({ game_id: gameId }),
    });
    expect(accuse.status).toBe(400);

    expect(readStoredSession(gameId)).toEqual(before);
  });
});
