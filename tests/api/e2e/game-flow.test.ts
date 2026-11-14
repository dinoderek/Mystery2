import { beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  setStoredTimeRemaining,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "../integration/helpers";

describe("Full E2E API Investigation Flow", () => {
  let auth: ApiAuthContext;


  beforeEach(async () => {
    auth = await setupApiTestAuth("api-e2e-flow");
  });


  async function startGameSession(headers: HeadersInit) {
    const listRes = await fetch(`${API_URL}/blueprints-list`, { headers });
    expect(listRes.status).toBe(200);
    const listData = await listRes.json();
    const mockBlueprint = listData.blueprints.find(
      (blueprint: { id: string }) => blueprint.id === MOCK_BLUEPRINT_ID,
    );
    if (!mockBlueprint) {
      throw new Error(`Mock blueprint ${MOCK_BLUEPRINT_ID} not found`);
    }
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: mockBlueprint.id }),
    });
    expect(startRes.status).toBe(200);
    const startData = await startRes.json();
    return startData.game_id as string;
  }

  /** Sends one typed line to `game-turn` and returns the answer. */
  async function line(headers: HeadersInit, gameId: string, input: string) {
    const res = await fetch(`${API_URL}/game-turn`, {
      method: "POST",
      headers,
      body: JSON.stringify({ game_id: gameId, input }),
    });
    expect(res.status, `"${input}" answered ${res.status}`).toBe(200);
    return (await res.json()) as {
      kind: string;
      events: Array<{ event_type: string; narration_parts: Array<{ text: string; speaker: { kind: string } }> }>;
      state: { mode: string; time_remaining: number };
      result: string | null;
    };
  }

  /** The speakers of the first part of the events a turn saved. */
  function speakers(answer: Awaited<ReturnType<typeof line>>) {
    return answer.events.map((event) => event.narration_parts[0].speaker.kind);
  }

  async function loadNarrationEvents(gameId: string, headers: HeadersInit) {
    const getRes = await fetch(`${API_URL}/game-get?game_id=${gameId}`, {
      headers,
    });
    expect(getRes.status).toBe(200);
    const payload = await getRes.json();
    return payload.narration_events as Array<{
      event_type: string;
      narration_parts: Array<{ text: string; speaker: { kind: string } }>;
    }>;
  }

  it("completes a full investigation from start to correct accusation", async () => {
    const headers = auth.headers;

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

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers,
      body: JSON.stringify({ blueprint_id: blueprintId }),
    });
    expect(startRes.status).toBe(200);
    const { game_id, state, narration_events } = await startRes.json();
    expect(state.mode).toBe("explore");
    expect(narration_events[0].narration_parts[0].speaker.kind).toBe("narrator");

    expect(speakers(await line(headers, game_id, "go to the Kitchen"))).toEqual(["narrator"]);
    expect(speakers(await line(headers, game_id, "search"))).toEqual(["narrator"]);
    expect(speakers(await line(headers, game_id, "talk to Alice"))).toEqual(["narrator"]);

    const ask = await line(headers, game_id, "Where were you when this happened?");
    expect(ask.events[0].narration_parts[0].speaker).toMatchObject({
      kind: "character",
      key: "character:alice",
      label: "Alice",
    });

    expect(speakers(await line(headers, game_id, "goodbye"))).toEqual(["narrator"]);

    const getRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    expect(getRes.status).toBe(200);
    const getData = await getRes.json();
    expect(getData.narration_events.length).toBeGreaterThan(0);
    expect(
      getData.narration_events.some(
        (entry: { narration_parts: Array<{ speaker: { kind: string } }> }) =>
          entry.narration_parts.some((part) => part.speaker.kind === "character"),
      ),
    ).toBe(true);

    const accuseStart = await line(headers, game_id, "accuse Alice because she was nearby and acted nervous.");
    expect(accuseStart.state.mode).toBe("accuse");
    expect(speakers(accuseStart)).toEqual(["narrator"]);

    const accuseRoundOne = await line(headers, game_id, "Alice was nearby and behaved nervously.");
    expect(accuseRoundOne.state.mode).toBe("ended");
    expect(accuseRoundOne.result).toBe("win");
    expect(speakers(accuseRoundOne)).toEqual(["narrator"]);

    const finalGetRes = await fetch(`${API_URL}/game-get?game_id=${game_id}`, {
      headers,
    });
    const finalData = await finalGetRes.json();
    expect(finalData.state.mode).toBe("ended");
    const lastParts = finalData.narration_events.at(-1)?.narration_parts ?? [];
    expect(lastParts.some((p: { speaker: { kind: string } }) => p.speaker.kind === "narrator")).toBe(true);
  });

  const lastTurnCases = [
    { action: "move", input: "go to the Kitchen", events: ["move", "forced_endgame"] },
    { action: "search", input: "search", events: ["search", "forced_endgame"] },
    { action: "conversation start", input: "talk to Alice", events: ["talk", "forced_endgame"] },
  ];

  for (const { action, input, events } of lastTurnCases) {
    it(`forces endgame when the final ${action} consumes the last turn`, async () => {
      const headers = auth.headers;
      const gameId = await startGameSession(headers);
      setStoredTimeRemaining(gameId, 1);

      const answer = await line(headers, gameId, input);

      expect(answer.state.mode).toBe("accuse");
      expect(answer.state.time_remaining).toBe(0);
      expect(answer.events.map((event) => event.event_type)).toEqual(events);
      expect(speakers(answer)).toEqual(["narrator", "narrator"]);

      const narrationEvents = await loadNarrationEvents(gameId, headers);
      const tail = narrationEvents.slice(-2);
      expect(tail.map((event) => event.event_type)).toEqual(events);

      // The turn's event reads back with the player's own line before the narration.
      expect(tail[0].narration_parts[0].speaker.kind).toBe("investigator");
      expect(tail[0].narration_parts[0].text).toBe(input);
      expect(tail[0].narration_parts[1].text).toBe(answer.events[0].narration_parts[0].text);
    });
  }
});
