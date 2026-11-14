import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callLiveEndpointWithRetry,
  getLiveTestTimeoutMs,
  getLiveSuiteTitle,
  isLiveAIEnabled,
  LiveAIRetriableExhaustedError,
  resolveLiveAILabel,
} from "../../../testkit/src/live-ai.ts";
import type { GameTurnResponse } from "../../../../packages/shared/src/mystery-api-contracts.ts";
import {
  API_URL,
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
      const label = resolveLiveAILabel().toLowerCase();
      const profile = label === "free" || label === "paid" ? label : "free";
      const headers = auth.headers;

      const startData = await callLiveEndpointWithRetry<{ game_id: string }>({
        apiUrl: API_URL,
        endpoint: "game-start",
        headers,
        stepLabel: "game-start",
        body: {
          blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
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

      // Ensure live AI labeling is wired for test run visibility.
      expect(label.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        expect.fail(`[live-ai] Retriable retries exhausted: ${error.message}`);
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
