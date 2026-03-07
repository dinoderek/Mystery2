import { describe, expect, it } from "vitest";
import {
  getLiveSuiteTitle,
  isLiveAIEnabled,
  resolveLiveAIProfile,
} from "../../../testkit/src/live-ai.ts";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const runLive = isLiveAIEnabled() ? describe : describe.skip;

runLive(getLiveSuiteTitle("live-ai integration: talk + search"), () => {
  it("runs talk and search with active live profile", async () => {
    const profile = resolveLiveAIProfile();
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

    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    expect(typeof searchData.narration).toBe("string");
    expect(searchData.narration.length).toBeGreaterThan(0);

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });
    expect(talkRes.status).toBe(200);
    const talkData = await talkRes.json();
    expect(typeof talkData.narration).toBe("string");
    expect(talkData.mode === "talk" || talkData.mode === "accuse").toBe(true);

    // Ensure profile configuration is wired in the environment for visibility.
    expect(profile === "default" || profile === "cost_control").toBe(true);
  });
});
