import { beforeEach, describe, expect, it } from "vitest";

import { GameTurnResponseSchema, NO_TURN_EVENT_TYPE, SessionTranscriptResponseSchema, type GameTurnResponse } from "@my2/shared";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  readStoredSession,
  setStoredTimeRemaining,
  setupApiTestAuth,
  testDatabase,
  type ApiAuthContext,
} from "./helpers";

// `game-turn` plays a typed line through the engine's one turn function.

describe("game-turn endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-turn");
  });

  async function startGame(): Promise<string> {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    expect(res.status).toBe(200);
    return (await res.json()).game_id as string;
  }

  function send(body: unknown): Promise<Response> {
    return fetch(`${API_URL}/game-turn`, {
      method: "POST",
      headers: auth.headers,
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  async function turn(gameId: string, input: string): Promise<GameTurnResponse> {
    const res = await send({ game_id: gameId, input });
    expect(res.status, `${input}: ${res.status}`).toBe(200);
    return GameTurnResponseSchema.parse(await res.json());
  }

  async function played(gameId: string, input: string) {
    const answer = await turn(gameId, input);
    if (answer.kind !== "turn") throw new Error(`"${input}" did not play: ${JSON.stringify(answer)}`);
    return answer;
  }

  it("plays every action, saving each with the line as typed", async () => {
    const gameId = await startGame();

    const move = await played(gameId, "go to the Living Room");
    expect(move.state).toMatchObject({ mode: "explore", time_remaining: 9, location: "loc-living-room" });
    expect(move.events[0]).toMatchObject({ event_type: "move", payload: { input: "go to the Living Room" } });

    const search = await played(gameId, "search");
    expect(search.state.time_remaining).toBe(8);
    expect(search.revealed_clues.map((clue) => clue.id)).toEqual(["clue-wrapper"]);

    const talk = await played(gameId, "talk to Bob");
    expect(talk.state).toMatchObject({ mode: "talk", current_talk_character: "char-bob", time_remaining: 7 });

    const ask = await played(gameId, "What did you see?");
    expect(ask.events[0]).toMatchObject({ event_type: "ask", payload: { player_input: "What did you see?" } });
    expect(ask.state.time_remaining).toBe(7);

    const bye = await played(gameId, "goodbye");
    expect(bye.state).toMatchObject({ mode: "explore", current_talk_character: null });

    const accuse = await played(gameId, "accuse");
    expect(accuse.events[0].event_type).toBe("accuse_start");
    expect(accuse.state.mode).toBe("accuse");

    const round = await played(gameId, "Maybe it was Bob?");
    expect(round.events[0].event_type).toBe("accuse_round");
    expect(round.result).toBeNull();

    const stored = readStoredEvents(gameId);
    expect(stored.map((event) => event.event_type)).toEqual([
      "start",
      "move",
      "search",
      "talk",
      "ask",
      "end_talk",
      "accuse_start",
      "accuse_round",
    ]);
    expect(stored.slice(1).map((event) => event.payload?.input)).toEqual([
      "go to the Living Room",
      "search",
      "talk to Bob",
      "What did you see?",
      "goodbye",
      "accuse",
      "Maybe it was Bob?",
    ]);
    expect(readStoredSession(gameId)).toMatchObject({ mode: "accuse", time_remaining: 7 });
  });

  it("forces the accusation when the last turn is spent", async () => {
    const gameId = await startGame();
    setStoredTimeRemaining(gameId, 1);

    const answer = await played(gameId, "search");

    expect(answer.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
    expect(answer.events.map((event) => event.event_type)).toEqual(["search", "forced_endgame"]);
    expect(readStoredSession(gameId)).toMatchObject({ mode: "accuse", time_remaining: 0 });
  });

  async function getGame(gameId: string) {
    const res = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
    expect(res.status).toBe(200);
    return SessionTranscriptResponseSchema.parse(await res.json());
  }

  it("saves a refused line and help as lines that cost no turn", async () => {
    const gameId = await startGame();
    const before = readStoredSession(gameId);

    expect(await turn(gameId, "dance")).toMatchObject({ kind: "refused", reason: "unrecognized" });
    expect(await turn(gameId, "go")).toMatchObject({ kind: "refused", reason: "missing-target" });
    expect(await turn(gameId, "move to the moon")).toMatchObject({ kind: "refused", reason: "invalid-target" });
    expect(await turn(gameId, "talk to")).toMatchObject({ kind: "refused", reason: "missing-target" });
    expect(await turn(gameId, "talk to Bob")).toMatchObject({ kind: "refused", reason: "invalid-target" });
    expect(await turn(gameId, "help")).toEqual({ kind: "view", view: "help", section: null, note: "Help menu opened." });

    const stored = readStoredEvents(gameId);
    expect(stored.map((event) => event.event_type)).toEqual(["start", ...Array(6).fill(NO_TURN_EVENT_TYPE)]);
    expect(stored.slice(1).map((event) => event.payload)).toEqual([
      { input: "dance", answered: "refused", reason: "unrecognized" },
      { input: "go", answered: "refused", reason: "missing-target" },
      { input: "move to the moon", answered: "refused", reason: "invalid-target" },
      { input: "talk to", answered: "refused", reason: "missing-target" },
      { input: "talk to Bob", answered: "refused", reason: "invalid-target" },
      { input: "help", answered: "help" },
    ]);
    expect(stored[6].narration_parts.map((part) => String(part.text))).toEqual(["Help menu opened."]);
    expect(readStoredSession(gameId)).toEqual(before);
  });

  it("saves nothing for the notebook, the lists and quit", async () => {
    const gameId = await startGame();
    const before = readStoredSession(gameId);

    expect(await turn(gameId, "notebook")).toEqual({ kind: "view", view: "notebook", section: null, note: null });
    expect(await turn(gameId, "locations")).toEqual({ kind: "view", view: "locations", section: "places", note: null });
    expect(await turn(gameId, "characters")).toEqual({ kind: "view", view: "characters", section: "people", note: null });
    expect(await turn(gameId, "quit")).toEqual({ kind: "quit" });

    expect(readStoredSession(gameId)).toEqual(before);
    expect(readStoredEvents(gameId)).toHaveLength(1);
  });

  it("returns those lines from game-get in order, among the turns", async () => {
    const gameId = await startGame();

    await turn(gameId, "dance");
    await played(gameId, "go to the Living Room");
    await turn(gameId, "help");
    await played(gameId, "search");

    const game = await getGame(gameId);
    expect(game.narration_events.map((event) => [event.sequence, event.event_type])).toEqual([
      [1, "start"],
      [2, NO_TURN_EVENT_TYPE],
      [3, "move"],
      [4, NO_TURN_EVENT_TYPE],
      [5, "search"],
    ]);
    expect(game.narration_events[1].narration_parts.map((part) => [part.speaker.kind, part.text.startsWith("Commands:")])).toEqual([
      ["investigator", false],
      ["system", true],
    ]);
    expect(game.narration_events[1].narration_parts[0].text).toBe("dance");
    expect(game.narration_events[3].narration_parts.map((part) => part.text)).toEqual(["help", "Help menu opened."]);
    expect(game.state).toMatchObject({ mode: "explore", time_remaining: 8, location: "loc-living-room" });
  });

  it("lets the player step into the case after a line that costs no turn", async () => {
    const gameId = await startGame();
    await turn(gameId, "help");

    const res = await fetch(`${API_URL}/game-enter`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId }),
    });

    expect(res.status).toBe(200);
    expect(readStoredEvents(gameId).map((event) => [event.sequence, event.event_type])).toEqual([
      [1, "start"],
      [2, NO_TURN_EVENT_TYPE],
      [3, "move"],
    ]);
  });

  it("names the missing or wrong field in a 400", async () => {
    const gameId = await startGame();

    const cases: Array<[unknown, string | null]> = [
      [{ input: "search" }, "game_id"],
      [{ game_id: "not-a-uuid", input: "search" }, "game_id"],
      [{ game_id: gameId }, "input"],
      [{ game_id: gameId, input: 7 }, "input"],
      ["not json", null],
    ];
    for (const [body, field] of cases) {
      const res = await send(body);
      expect(res.status).toBe(400);
      const error = await res.json();
      expect(error.details.field).toBe(field);
      if (field) expect(error.error).toContain(field);
    }
    expect(readStoredEvents(gameId)).toHaveLength(1);
  });

  it("never repeats a sequence when two turns are sent at once", async () => {
    // Under the mock narrator nothing in a turn waits on the outside world, so
    // the server may finish one before it reads the other; the held race is in
    // `tests/api/unit/game-turn-endpoint.test.ts`. Either way, each answer is a
    // saved turn or a 409, and every saved turn has sequences of its own.
    const gameId = await startGame();

    const responses = await Promise.all([
      send({ game_id: gameId, input: "search" }),
      send({ game_id: gameId, input: "go to the living room" }),
    ]);

    const statuses = responses.map((res) => res.status);
    for (const status of statuses) expect([200, 409]).toContain(status);
    const sequences = readStoredEvents(gameId).map((event) => event.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toHaveLength(1 + statuses.filter((status) => status === 200).length);
  });

  it("shows the typed lines when the game is read back", async () => {
    const gameId = await startGame();
    await played(gameId, "talk to Alice");
    await played(gameId, "Where were you at noon?");
    await played(gameId, "see you");

    const res = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
    expect(res.status).toBe(200);
    const read = SessionTranscriptResponseSchema.parse(await res.json());

    const firstLines = read.narration_events
      .slice(1)
      .map((event) => [event.narration_parts[0].speaker.kind, event.narration_parts[0].text]);
    expect(firstLines).toEqual([
      ["investigator", "talk to Alice"],
      ["investigator", "Where were you at noon?"],
      ["investigator", "see you"],
    ]);
  });

  it("reads a transcript of events saved without the typed line as it always has", async () => {
    const gameId = await startGame();
    await played(gameId, "move to living room");
    await played(gameId, "search behind the bookshelf");
    // Events from before the line was stored carry no `input`.
    const db = testDatabase();
    for (const event of readStoredEvents(gameId)) {
      if (!event.payload || !("input" in event.payload)) continue;
      const payload = { ...event.payload };
      delete payload.input;
      db.prepare("update game_events set payload = ? where session_id = ? and sequence = ?").run(
        JSON.stringify(payload),
        gameId,
        event.sequence,
      );
    }

    const res = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
    const read = SessionTranscriptResponseSchema.parse(await res.json());

    expect(read.narration_events.slice(1).map((event) => event.narration_parts[0].text)).toEqual([
      "move to Living Room",
      "search behind the bookshelf",
    ]);
  });
});
