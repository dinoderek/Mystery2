import { describe, expect, it } from "vitest";
import {
  getLiveSuiteTitle,
  isLiveAIEnabled,
} from "../../testkit/src/live-ai.ts";
import { investigatorScript } from "./live-ai/investigator-script.ts";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

const endpointByAction: Record<string, string> = {
  move: "game-move",
  search: "game-search",
  talk: "game-talk",
  ask: "game-ask",
  end_talk: "game-end-talk",
  accuse_start: "game-accuse",
  accuse_reasoning: "game-accuse",
};

runLive(getLiveSuiteTitle("live-ai e2e investigator flow"), () => {
  it("executes the deterministic investigator script", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANON_KEY}`,
    };

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: investigatorScript.blueprint_id }),
    });
    expect(startRes.status).toBe(200);
    const { game_id } = await startRes.json();

    for (const step of investigatorScript.steps) {
      const endpoint = endpointByAction[step.action];
      const response = await fetch(`${API_URL}/${endpoint}`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          game_id,
          ...step.payload,
        }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(typeof data.narration).toBe("string");
      expect(data.narration.length).toBeGreaterThan(0);

      if (step.expect_mode) {
        expect(data.mode).toBe(step.expect_mode);
      }
    }

    const finalStateRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    expect(finalStateRes.status).toBe(200);
    const finalStateData = await finalStateRes.json();
    expect(finalStateData.state.mode).toBe("ended");
  });
});
