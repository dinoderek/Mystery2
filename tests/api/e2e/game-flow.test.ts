import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("Full E2E API Investigation Flow", () => {
  it("completes a full investigation from start to correct accusation", async () => {
    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.ANON_KEY}`,
    };

    // 1. GET blueprints-list
    const listRes = await fetch(`${API_URL}/blueprints-list`, { headers });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const blueprintId = listData.blueprints[0].id;

    // 2. POST game-start
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: blueprintId }),
    });
    expect(startRes.status).toBe(200);
    const { game_id, state } = await startRes.json();
    expect(state.mode).toBe("explore");

    // 3. POST game-move
    const moveRes = await fetch(`${API_URL}/game-move`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, destination: "Kitchen" }), // Already in kitchen but moving there is fine or "Living Room"
    });
    expect(moveRes.status).toBe(200);

    // 4. POST game-search
    const searchRes = await fetch(`${API_URL}/game-search`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
    expect(searchRes.status).toBe(200);
    const searchData = await searchRes.json();
    const discoveredClueId = searchData.discovered_clue_id;

    // 5. POST game-talk to Alice
    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });
    expect(talkRes.status).toBe(200);

    // 6. POST game-ask
    if (discoveredClueId) {
      const askRes = await fetch(`${API_URL}/game-ask`, {
        method: "POST",
        headers,
        body: JSON.stringify({ game_id, clue_id: discoveredClueId }),
      });
      expect(askRes.status).toBe(200);
    }

    // 7. POST game-end-talk
    const endRes = await fetch(`${API_URL}/game-end-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id }),
    });
    expect(endRes.status).toBe(200);

    // 8. GET game-get
    const getRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.state.history.length).toBeGreaterThan(0);

    // 9. POST game-accuse
    const accuseRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, accused_character_id: "Alice" }),
    });
    expect(accuseRes.status).toBe(200);
    const accuseData = await accuseRes.json();

    // 10. Check outcome
    expect(accuseData.result).toBe("win");

    // 11. Final state check
    const finalGetRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    const finalData = await finalGetRes.json();
    expect(finalData.state.mode).toBe("ended");
  });
});
