import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callLiveEndpointWithRetry,
  getLiveTestTimeoutMs,
  getLiveSuiteTitle,
  isLiveAIEnabled,
  LiveAIRetriableExhaustedError,
  requireLiveAIName,
} from "../../../testkit/src/live-ai.ts";
import type { GameTurnResponse } from "../../../../packages/shared/src/mystery-api-contracts.ts";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "../helpers.ts";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: accusation"), () => {
  let auth: ApiAuthContext;

  beforeAll(async () => {
    auth = await setupApiTestAuth("live-ai-accuse");
  });

  afterAll(async () => {
  });

  it("progresses accusation rounds to a terminal outcome", async () => {
    try {
      const profile = requireLiveAIName();
      const headers = auth.headers;

      const startData = await callLiveEndpointWithRetry<{ game_id: string }>({
        apiUrl: API_URL,
        endpoint: "game-start",
        headers,
        stepLabel: "game-start",
        body: {
          blueprint_id: MOCK_BLUEPRINT_ID,
          ai_profile: profile,
        },
      });
      const { game_id } = startData;
      expect(typeof game_id).toBe("string");

      // A clue-graph accusation is judged at once: a failure spends one and
      // returns to exploring, and the third ends the case either way.
      let mode: string | null = null;
      let result: string | null = null;
      for (let round = 0; round < 3 && mode !== "ended"; round += 1) {
        const data = await callLiveEndpointWithRetry<GameTurnResponse>({
          apiUrl: API_URL,
          endpoint: "game-turn",
          headers,
          stepLabel: `game-turn (accusation ${round + 1})`,
          body: { game_id, input: "accuse Alice, because the clues point to her timeline." },
        });
        expect(data.kind).toBe("turn");
        if (data.kind !== "turn") return;
        mode = data.state.mode;
        result = data.result;
        expect(mode === "explore" || mode === "ended").toBe(true);
      }

      expect(mode).toBe("ended");
      expect(result === "win" || result === "lose").toBe(true);
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        expect.fail(`[live-ai] Retriable retries exhausted: ${error.message}`);
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
