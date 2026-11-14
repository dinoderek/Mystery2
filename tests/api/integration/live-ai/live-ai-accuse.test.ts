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

runLive(getLiveSuiteTitle("live-ai integration: accusation"), () => {
  let auth: ApiAuthContext;

  beforeAll(async () => {
    auth = await setupApiTestAuth("live-ai-accuse");
  });

  afterAll(async () => {
  });

  it("progresses accusation rounds to a terminal outcome", async () => {
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

      const accuseStartData = await callLiveEndpointWithRetry<GameTurnResponse>({
        apiUrl: API_URL,
        endpoint: "game-turn",
        headers,
        stepLabel: "game-turn (accuse)",
        body: {
          game_id,
          input: "accuse Alice, because the clues point to her timeline.",
        },
      });
      expect(accuseStartData.kind).toBe("turn");
      if (accuseStartData.kind !== "turn") return;
      expect(accuseStartData.state.mode === "accuse" || accuseStartData.state.mode === "ended").toBe(true);

      if (accuseStartData.state.mode === "ended") {
        return;
      }

      let responseMode: string | null = null;
      let finalResult: string | null = null;
      for (let round = 0; round < 4; round += 1) {
        const roundData = await callLiveEndpointWithRetry<GameTurnResponse>({
          apiUrl: API_URL,
          endpoint: "game-turn",
          headers,
          stepLabel: `game-turn (reasoning round ${round + 1})`,
          body: {
            game_id,
            input: `Round ${round + 1} reasoning: clues and timeline point to Alice.`,
          },
        });
        expect(roundData.kind).toBe("turn");
        if (roundData.kind !== "turn") return;
        responseMode = roundData.state.mode;
        finalResult = roundData.result;

        if (responseMode === "ended") {
          break;
        }
      }

      expect(responseMode === "ended" || responseMode === "accuse").toBe(true);
      if (responseMode === "ended") {
        expect(finalResult === "win" || finalResult === "lose").toBe(true);
      }
    } catch (error) {
      if (error instanceof LiveAIRetriableExhaustedError) {
        expect.fail(`[live-ai] Retriable retries exhausted: ${error.message}`);
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
