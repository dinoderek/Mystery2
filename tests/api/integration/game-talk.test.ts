import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("game-talk endpoint", () => {
  it("starts a conversation with narrator speaker", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    const { game_id } = await startRes.json();

    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.ANON_KEY}`,
      },
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });

    expect(talkRes.status).toBe(200);
    const data = await talkRes.json();

    expect(data.current_talk_character).toBe("Alice");
    expect(data.mode).toBe("talk");
    expect(data.time_remaining).toBe(9);
    expect(data.narration).toContain("[Mock]");
    expect(data.narration).not.toContain("because she was hungry");
    expect(data.speaker).toMatchObject({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
  });
});
