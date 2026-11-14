import { beforeEach, describe, expect, it } from "vitest";

import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  setupApiTestAuth,
  startMockGame,
  type ApiAuthContext,
} from "./helpers";

// Every endpoint that takes fields checks them against the shared schema and
// answers `400` naming the one that is wrong. The two that take none
// (`blueprints-list`, `game-sessions-list`) have nothing to check.

const REMOVED_ENDPOINTS = ["game-move", "game-search", "game-talk", "game-ask", "game-end-talk", "game-accuse"];

describe("the endpoint registry", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("request-validation");
  });

  it("answers 404 for each removed turn endpoint, signed in or not", async () => {
    const gameId = await startMockGame(auth);
    for (const name of REMOVED_ENDPOINTS) {
      for (const headers of [auth.headers, { "Content-Type": "application/json" }]) {
        const res = await fetch(`${API_URL}/${name}`, {
          method: "POST",
          headers,
          body: JSON.stringify({ game_id: gameId, destination: "loc-living-room" }),
        });
        expect(`${name} -> ${res.status}`).toBe(`${name} -> 404`);
      }
    }
    expect(readStoredEvents(gameId)).toHaveLength(1);
  });
});

describe("request validation", () => {
  let auth: ApiAuthContext;
  let gameId: string;

  beforeEach(async () => {
    auth = await setupApiTestAuth("request-validation");
    gameId = await startMockGame(auth);
  });

  async function expectBadField(res: Response, field: string | null) {
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.details.field).toBe(field);
    if (field) expect(body.error).toContain(field);
  }

  const post = (name: string, body: unknown) =>
    fetch(`${API_URL}/${name}`, {
      method: "POST",
      headers: auth.headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });

  it("names the field game-start finds missing or wrong", async () => {
    await expectBadField(await post("game-start", {}), "blueprint_id");
    await expectBadField(await post("game-start", { blueprint_id: 7 }), "blueprint_id");
    await expectBadField(await post("game-start", { blueprint_id: "not-a-uuid" }), "blueprint_id");
    await expectBadField(await post("game-start", { blueprint_id: MOCK_BLUEPRINT_ID, ai_profile: 3 }), "ai_profile");
    await expectBadField(await post("game-start", { blueprint_id: MOCK_BLUEPRINT_ID, ai_profile: "  " }), "ai_profile");
    await expectBadField(await post("game-start", "not json"), null);
  });

  it("names the field game-enter finds missing or wrong", async () => {
    await expectBadField(await post("game-enter", {}), "game_id");
    await expectBadField(await post("game-enter", { game_id: 12 }), "game_id");
    await expectBadField(await post("game-enter", { game_id: "not-a-uuid" }), "game_id");
    await expectBadField(await post("game-enter", "not json"), null);
  });

  it("names the field game-turn finds missing or wrong", async () => {
    await expectBadField(await post("game-turn", { input: "search" }), "game_id");
    await expectBadField(await post("game-turn", { game_id: "not-a-uuid", input: "search" }), "game_id");
    await expectBadField(await post("game-turn", { game_id: gameId }), "input");
    await expectBadField(await post("game-turn", { game_id: gameId, input: 7 }), "input");
    await expectBadField(await post("game-turn", "not json"), null);
    expect(readStoredEvents(gameId)).toHaveLength(1);
  });

  it("names the game_id game-get finds missing or wrong", async () => {
    const get = (query: string) => fetch(`${API_URL}/game-get${query}`, { headers: auth.headers });

    await expectBadField(await get(""), "game_id");
    await expectBadField(await get("?game_id="), "game_id");
    await expectBadField(await get("?game_id=not-a-uuid"), "game_id");
    expect((await get(`?game_id=${gameId}`)).status).toBe(200);
  });

  it("starts a game when the profile name has spaces around it", async () => {
    const res = await post("game-start", { blueprint_id: MOCK_BLUEPRINT_ID, ai_profile: " mock " });
    expect(res.status).toBe(200);
  });
});
