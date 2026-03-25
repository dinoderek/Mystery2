import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  callLiveEndpointWithRetry,
  getLiveTestTimeoutMs,
  getLiveSuiteTitle,
  isLiveAIEnabled,
  LiveAIRetriableExhaustedError,
  resolveLiveAILabel,
} from "../../../testkit/src/live-ai.ts";
import {
  setupApiTestAuth,
  type ApiAuthContext,
} from "../auth-helpers.ts";

const SUPABASE_BASE = process.env.SUPABASE_URL || process.env.API_URL || "http://127.0.0.1:54331";
const API_URL = `${SUPABASE_BASE}/functions/v1`;
const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: talk + search"), () => {
  let auth: ApiAuthContext;

  beforeAll(async () => {
    auth = await setupApiTestAuth("live-ai-talk-search");
  });

  afterAll(async () => {
    await auth.cleanup();
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

      const searchData = await callLiveEndpointWithRetry<{
        narration: string;
      }>({
        apiUrl: API_URL,
        endpoint: "game-search",
        headers,
        stepLabel: "game-search",
        body: { game_id },
      });
      expect(typeof searchData.narration).toBe("string");
      expect(searchData.narration.length).toBeGreaterThan(0);

      const talkData = await callLiveEndpointWithRetry<{
        narration: string;
        mode: string;
      }>({
        apiUrl: API_URL,
        endpoint: "game-talk",
        headers,
        stepLabel: "game-talk",
        body: { game_id, character_id: "char-alice" },
      });
      expect(typeof talkData.narration).toBe("string");
      expect(talkData.mode === "talk" || talkData.mode === "accuse").toBe(true);

      // Ensure live AI labeling is wired for test run visibility.
      expect(label.length).toBeGreaterThan(0);
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        console.warn(`[live-ai] ${error.message}`);
        return;
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
