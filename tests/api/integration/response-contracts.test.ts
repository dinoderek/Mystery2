import { beforeEach, describe, expect, it } from "vitest";

import {
  BlueprintsListResponseSchema,
  GameEnterResponseSchema,
  GameGetResponseSchema,
  GameStartResponseSchema,
  GameTurnResponseSchema,
  SessionCatalogResponseSchema,
} from "@my2/shared";
import { API_URL, MOCK_BLUEPRINT_ID, setupApiTestAuth, type ApiAuthContext } from "./helpers";

// The browser reads every one of these answers through the shared schema. Each
// is parsed here against what the server really sends, so a schema that has
// drifted from the engine fails in the suite and not on a player's screen.

describe("responses the browser reads", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("response-contracts");
  });

  async function post(endpoint: string, body: Record<string, unknown>): Promise<unknown> {
    const res = await fetch(`${API_URL}/${endpoint}`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify(body),
    });
    expect(res.status, `${endpoint}: ${res.status}`).toBe(200);
    return res.json();
  }

  async function get(endpoint: string): Promise<unknown> {
    const res = await fetch(`${API_URL}/${endpoint}`, { headers: auth.headers });
    expect(res.status, `${endpoint}: ${res.status}`).toBe(200);
    return res.json();
  }

  it("blueprints-list", async () => {
    const answer = BlueprintsListResponseSchema.parse(await get("blueprints-list"));
    expect(answer.blueprints.map((blueprint) => blueprint.id)).toContain(MOCK_BLUEPRINT_ID);
  });

  it("game-start, game-enter, game-turn, game-get and game-sessions-list", async () => {
    const started = GameStartResponseSchema.parse(await post("game-start", { blueprint_id: MOCK_BLUEPRINT_ID }));
    const gameId = started.game_id;
    expect(started.state.characters.length).toBeGreaterThan(0);

    const entered = GameEnterResponseSchema.parse(await post("game-enter", { game_id: gameId }));
    expect(entered.current_location).toBe(started.state.location);

    for (const input of ["go to the Living Room", "search"]) {
      const answer = GameTurnResponseSchema.parse(await post("game-turn", { game_id: gameId, input }));
      expect(answer.kind).toBe("turn");
    }

    // The clue's origin survives the schema: the notebook groups clues by it.
    const resumed = GameGetResponseSchema.parse(await get(`game-get?game_id=${gameId}`));
    expect(resumed.blueprint_id).toBe(MOCK_BLUEPRINT_ID);
    const clues = resumed.state.discovered_clues ?? [];
    expect(clues.length).toBeGreaterThan(0);
    expect(clues[0].origin.kind).toBe("location");

    const catalog = SessionCatalogResponseSchema.parse(await get("game-sessions-list"));
    expect(catalog.in_progress.map((session) => session.game_id)).toContain(gameId);
  });
});
