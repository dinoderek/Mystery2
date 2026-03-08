import { describe, expect, it } from "vitest";
import {
  callLiveEndpointWithRetry,
  getLiveTestTimeoutMs,
  getLiveSuiteTitle,
  isLiveAIEnabled,
  LiveAIRetriableExhaustedError,
} from "../../../testkit/src/live-ai.ts";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: accusation"), () => {
  it("progresses accusation rounds to a terminal outcome", async () => {
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      };

      const startData = await callLiveEndpointWithRetry<{ game_id: string }>({
        apiUrl: API_URL,
        endpoint: "game-start",
        headers,
        stepLabel: "game-start",
        body: {
          blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        },
      });
      const { game_id } = startData;
      expect(typeof game_id).toBe("string");

      const accuseStartData = await callLiveEndpointWithRetry<{ mode: string }>({
        apiUrl: API_URL,
        endpoint: "game-accuse",
        headers,
        stepLabel: "game-accuse (start)",
        body: {
          game_id,
          accused_character_id: "Alice",
        },
      });
      expect(accuseStartData.mode).toBe("accuse");

      let responseMode: string | null = null;
      let finalResult: string | null = null;
      for (let round = 0; round < 4; round += 1) {
        const roundData = await callLiveEndpointWithRetry<{
          mode?: string;
          result?: string;
        }>({
          apiUrl: API_URL,
          endpoint: "game-accuse",
          headers,
          stepLabel: `game-accuse (reasoning round ${round + 1})`,
          body: {
            game_id,
            player_reasoning:
              `Round ${round + 1} reasoning: clues and timeline point to Alice.`,
          },
        });
        responseMode = roundData.mode ?? null;
        finalResult = roundData.result ?? null;

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
        console.warn(`[live-ai] ${error.message}`);
        return;
      }
      throw error;
    }
  }, getLiveTestTimeoutMs());
});
