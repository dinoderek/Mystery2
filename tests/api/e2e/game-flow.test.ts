import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";
const MOCK_BLUEPRINT_ID = "123e4567-e89b-12d3-a456-426614174000";

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
    const mockBlueprint = listData.blueprints.find(
      (blueprint: { id: string }) => blueprint.id === MOCK_BLUEPRINT_ID,
    );
    if (!mockBlueprint) {
      throw new Error(`Mock blueprint ${MOCK_BLUEPRINT_ID} not found`);
    }
    const blueprintId = mockBlueprint.id;

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
    await searchRes.json();

    // 5. POST game-talk to Alice
    const talkRes = await fetch(`${API_URL}/game-talk`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id, character_name: "Alice" }),
    });
    expect(talkRes.status).toBe(200);

    // 6. POST game-ask
    const askRes = await fetch(`${API_URL}/game-ask`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_input: "Where were you when this happened?",
      }),
    });
    expect(askRes.status).toBe(200);

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

    // 9. POST game-accuse (reasoning round 1 from explore)
    const accuseStartRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning:
          "I accuse Alice because she was nearby and acted nervous.",
      }),
    });
    expect(accuseStartRes.status).toBe(200);
    const accuseStartData = await accuseStartRes.json();
    expect(accuseStartData.mode).toBe("accuse");

    // 10. POST game-accuse (judge resolve round)
    const accuseRoundOneRes = await fetch(`${API_URL}/game-accuse`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        game_id,
        player_reasoning: "Alice was nearby and behaved nervously.",
      }),
    });
    expect(accuseRoundOneRes.status).toBe(200);
    const accuseRoundOneData = await accuseRoundOneRes.json();
    expect(accuseRoundOneData.mode).toBe("ended");
    expect(accuseRoundOneData.result).toBe("win");

    // 11. Final state check
    const finalGetRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    const finalData = await finalGetRes.json();
    expect(finalData.state.mode).toBe("ended");
  });
});
