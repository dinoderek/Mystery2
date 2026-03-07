import { describe, expect, it } from "vitest";
import {
  getLiveSuiteTitle,
  isLiveAIEnabled,
} from "../../../testkit/src/live-ai.ts";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: accusation"), () => {
  it("progresses accusation rounds to a terminal outcome", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANON_KEY}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        accused_character_id: "Alice",
      }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");

    let responseMode: string | null = null;
    let finalResult: string | null = null;
    for (let round = 0; round < 3; round += 1) {
      const roundRes = await fetch(`${API_URL}/game-accuse`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          game_id,
          player_reasoning:
            `Round ${round + 1} reasoning: clues and timeline point to Alice.`,
        }),
      });
      expect(roundRes.status).toBe(200);
      const roundData = await roundRes.json();
      responseMode = roundData.mode ?? null;
      finalResult = roundData.result ?? null;

      if (responseMode === "ended") {
        break;
      }
    }

    expect(responseMode).toBe("ended");
    expect(finalResult === "win" || finalResult === "lose").toBe(true);
  });
});
