import { beforeEach, describe, expect, it } from "vitest";

import { GameGetResponseSchema, GameTurnResponseSchema, type GameTurnResponse } from "@my2/shared";
import {
  API_URL,
  playLine,
  readStoredEvents,
  readStoredSession,
  sendLine,
  setupApiTestAuth,
  startMockGame,
  type ApiAuthContext,
} from "./helpers";

// The reading age changes mid-game, by `age <n>` or from settings, and each
// change is recorded once as an `age_change` before the next narration
// (`docs/game.md`). The grammar is `tests/api/unit/command-grammar.test.ts`.

const LINE = (age: number) => `From now on, the story is written for age ${age}.`;

describe("changing the reading age mid-game", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("age-command");
  });

  const send = async (gameId: string, input: string): Promise<GameTurnResponse> => {
    const res = await sendLine(auth, gameId, input);
    expect(res.status).toBe(200);
    return GameTurnResponseSchema.parse(await res.json());
  };

  /** What the settings page does: sets the profile's age with no game in play. */
  async function setAgeInSettings(age: number) {
    const res = await fetch(`${API_URL}/profile-settings`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ reading_age: age }),
    });
    expect(res.status).toBe(200);
  }

  const profileAge = async (): Promise<number> =>
    (await (await fetch(`${API_URL}/profile-settings`, { headers: auth.headers })).json()).reading_age;

  /** Each stored event's type and the age its payload records, or the change it names. */
  const trail = (gameId: string) =>
    readStoredEvents(gameId).map((event) =>
      event.event_type === "age_change" ? ["age_change", event.payload] : [event.event_type, event.payload?.reading_age ?? null],
    );

  const resume = async (gameId: string) => {
    const res = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
    expect(res.status).toBe(200);
    return GameGetResponseSchema.parse(await res.json());
  };

  describe("the age command", () => {
    it("sets the profile's age, saves one age_change, and costs no turn", async () => {
      const gameId = await startMockGame(auth);
      await playLine(auth, gameId, "search");
      const before = readStoredSession(gameId);

      const answer = await send(gameId, "age 9");

      expect(answer).toMatchObject({ kind: "age", reading_age: 9 });
      expect(answer.kind === "age" && answer.event).toMatchObject({
        sequence: 3,
        event_type: "age_change",
        payload: { from: 8, to: 9 },
        narration_parts: [{ text: LINE(9), speaker: { kind: "system" } }],
      });
      expect(await profileAge()).toBe(9);
      expect(readStoredSession(gameId)?.time_remaining).toBe(before?.time_remaining);
      expect(trail(gameId)).toEqual([["start", 8], ["search", 8], ["age_change", { from: 8, to: 9 }]]);
    });

    it("writes the next narrated event at the new age", async () => {
      const gameId = await startMockGame(auth);
      await send(gameId, "age 9");
      await playLine(auth, gameId, "search");

      expect(trail(gameId)).toEqual([["start", 8], ["age_change", { from: 8, to: 9 }], ["search", 9]]);
    });

    it("saves nothing when the game already recorded that age", async () => {
      const gameId = await startMockGame(auth);

      expect(await send(gameId, "age 8")).toEqual({ kind: "age", reading_age: 8, event: null });
      await send(gameId, "age 9");
      expect(await send(gameId, "age 9")).toEqual({ kind: "age", reading_age: 9, event: null });

      expect(trail(gameId)).toEqual([["start", 8], ["age_change", { from: 8, to: 9 }]]);
    });

    it("works while talking, and leaves the conversation as it was", async () => {
      const gameId = await startMockGame(auth);
      await playLine(auth, gameId, "talk to Alice");
      const talking = readStoredSession(gameId);

      const answer = await send(gameId, "age 7");

      expect(answer).toMatchObject({ kind: "age", reading_age: 7 });
      expect(readStoredSession(gameId)).toMatchObject({
        mode: "talk",
        current_talk_character_id: "char-alice",
        time_remaining: talking?.time_remaining,
      });
      const asked = await playLine(auth, gameId, "What did you see?");
      expect(asked.events[0].payload?.reading_age).toBe(7);
    });

    it("answers a number outside 6 to 11 with the range, changing nothing", async () => {
      const gameId = await startMockGame(auth);

      for (const line of ["age 12", "age 5", "age x", "age"]) {
        const answer = await send(gameId, line);
        expect(answer.kind).toBe("refused");
        expect(answer.kind === "refused" && answer.hint).toContain("6 to 11");
      }

      expect(await profileAge()).toBe(8);
      expect(trail(gameId).every(([type]) => type !== "age_change")).toBe(true);
    });

    it("applies to every game of the profile, each recording it when next played", async () => {
      const first = await startMockGame(auth);
      const second = await startMockGame(auth);

      await send(first, "age 10");
      expect(trail(second)).toEqual([["start", 8]]);

      await playLine(auth, second, "search");
      expect(trail(second)).toEqual([["start", 8], ["age_change", { from: 8, to: 10 }], ["search", 10]]);
    });

    it("records one change for an age set twice before the game is played again", async () => {
      const first = await startMockGame(auth);
      const second = await startMockGame(auth);
      await send(first, "age 9");
      await send(first, "age 10");

      await playLine(auth, second, "search");

      expect(trail(second)).toEqual([["start", 8], ["age_change", { from: 8, to: 10 }], ["search", 10]]);
    });
  });

  describe("a change made in settings", () => {
    it("is recorded before the next narration, and leads that turn's answer", async () => {
      const gameId = await startMockGame(auth);
      await playLine(auth, gameId, "search");
      await setAgeInSettings(6);

      const turn = await playLine(auth, gameId, "go to the Living Room");

      expect(turn.events.map((event) => [event.sequence, event.event_type])).toEqual([[3, "age_change"], [4, "move"]]);
      expect(turn.events[0].narration_parts[0].text).toBe(LINE(6));
      expect(turn.events[1].payload?.reading_age).toBe(6);
      expect(trail(gameId)).toEqual([["start", 8], ["search", 8], ["age_change", { from: 8, to: 6 }], ["move", 6]]);
    });

    it("keeps the forced accusation's sequences straight when the same turn ends the game's time", async () => {
      const gameId = await startMockGame(auth);
      for (let turn = 0; turn < 9; turn += 1) await playLine(auth, gameId, "search");
      await setAgeInSettings(11);

      const last = await playLine(auth, gameId, "search");

      expect(last.events.map((event) => event.event_type)).toEqual(["age_change", "search", "forced_endgame"]);
      const stored = readStoredEvents(gameId);
      expect(stored.slice(-3).map((event) => event.sequence)).toEqual(last.events.map((event) => event.sequence));
      const search = stored.at(-2);
      expect(stored.at(-1)?.payload).toMatchObject({ reading_age: 11 });
      expect(JSON.stringify(stored.at(-1)?.payload)).toContain(String(search?.sequence));
    });

    it("is recorded when the game is resumed, once, and not again on the next turn", async () => {
      const gameId = await startMockGame(auth);
      await playLine(auth, gameId, "search");
      await setAgeInSettings(7);

      const resumed = await resume(gameId);
      expect(resumed.reading_age).toBe(7);
      expect(resumed.narration_events.at(-1)).toMatchObject({
        event_type: "age_change",
        narration_parts: [{ text: LINE(7) }],
      });

      await resume(gameId);
      const turn = await playLine(auth, gameId, "go to the Living Room");

      expect(turn.events.map((event) => event.event_type)).toEqual(["move"]);
      expect(trail(gameId)).toEqual([["start", 8], ["search", 8], ["age_change", { from: 8, to: 7 }], ["move", 7]]);
    });

    it("is recorded before the arrival when it changed between the opening and the step in", async () => {
      const gameId = await startMockGame(auth);
      await setAgeInSettings(10);

      const res = await fetch(`${API_URL}/game-enter`, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({ game_id: gameId }),
      });
      const entered = await res.json();

      expect(res.status).toBe(200);
      expect(entered.age_change).toMatchObject({ sequence: 2, event_type: "age_change", payload: { from: 8, to: 10 } });
      expect(trail(gameId)).toEqual([["start", 8], ["age_change", { from: 8, to: 10 }], ["move", 10]]);
    });
  });

  describe("what a change leaves alone", () => {
    it("never rewrites an earlier event, or a saved clue line", async () => {
      const gameId = await startMockGame(auth);
      await playLine(auth, gameId, "search the pantry shelf");
      const earlier = readStoredEvents(gameId);
      expect(earlier.some((event) => event.payload?.clue_graph)).toBe(true);

      await send(gameId, "age 6");
      await setAgeInSettings(11);
      await resume(gameId);
      await playLine(auth, gameId, "go to the Living Room");

      expect(readStoredEvents(gameId).slice(0, earlier.length)).toEqual(earlier);
    });

    it("keeps the change out of what the narrator is told, so a later turn is narrated as before", async () => {
      const plain = await startMockGame(auth);
      const changed = await startMockGame(auth);
      await send(changed, "age 8");
      await send(changed, "age 9");
      await send(changed, "age 8");

      const a = await playLine(auth, plain, "search");
      const b = await playLine(auth, changed, "search");

      expect(b.events.at(-1)?.narration_parts).toEqual(a.events.at(-1)?.narration_parts);
    });
  });
});
