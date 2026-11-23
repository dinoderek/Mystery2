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

runLive(getLiveSuiteTitle("live-ai integration: talk + search"), () => {
  let auth: ApiAuthContext;

  beforeAll(async () => {
    auth = await setupApiTestAuth("live-ai-talk-search");
  });

  afterAll(async () => {
  });

  it("runs talk and search with active live model", async () => {
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

      const searchData = await callLiveEndpointWithRetry<GameTurnResponse>({
        apiUrl: API_URL,
        endpoint: "game-turn",
        headers,
        stepLabel: "game-turn (search)",
        body: { game_id, input: "search" },
      });
      expect(searchData.kind).toBe("turn");
      if (searchData.kind !== "turn") return;
      expect(searchData.events[0].narration_parts.length).toBeGreaterThan(0);
      expect(typeof searchData.events[0].narration_parts[0].text).toBe("string");

      const talkData = await callLiveEndpointWithRetry<GameTurnResponse>({
        apiUrl: API_URL,
        endpoint: "game-turn",
        headers,
        stepLabel: "game-turn (talk)",
        body: { game_id, input: "talk to alice" },
      });
      expect(talkData.kind).toBe("turn");
      if (talkData.kind !== "turn") return;
      expect(talkData.events[0].narration_parts.length).toBeGreaterThan(0);
      expect(talkData.state.mode === "talk" || talkData.state.mode === "accuse").toBe(true);
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        expect.fail(`[live-ai] Retriable retries exhausted: ${error.message}`);
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
