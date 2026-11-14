import { beforeEach, describe, expect, it } from "vitest";

import { GameTurnResponseSchema, SessionTranscriptResponseSchema } from "@my2/shared";
import { NARRATOR_SPEAKER, characterSpeaker } from "../../testkit/src/fixtures";
import {
  API_URL,
  playLine,
  readStoredEvents,
  readStoredSession,
  sendLine,
  setStoredTimeRemaining,
  setupApiTestAuth,
  startMockGame,
  type ApiAuthContext,
} from "./helpers";

// What each action does to the game, played as typed lines through `game-turn`
// under the mock narrator. The request and answer shapes are in
// `game-turn.test.ts`; the unit suites hold the grammar and the turn arithmetic.

describe("game-turn actions", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-turn-actions");
  });

  const play = (gameId: string, input: string) => playLine(auth, gameId, input);

  describe("moving", () => {
    it("moves the player, spends a turn, and narrates the arrival as the narrator", async () => {
      const gameId = await startMockGame(auth);

      const move = await play(gameId, "go to the Living Room");

      expect(move.state).toMatchObject({ mode: "explore", location: "loc-living-room", time_remaining: 9 });
      expect(move.events).toHaveLength(1);
      expect(move.events[0].narration_parts[0]).toMatchObject({
        text: "[Mock] You arrive at Living Room. Bob is here.",
        image_id: "mock-blueprint.location-loc-living-room.png",
        speaker: NARRATOR_SPEAKER,
      });
    });

    it("allows going on to another place, and back", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "go to the Living Room");

      const kitchen = await play(gameId, "go to the Kitchen");
      expect(kitchen.state).toMatchObject({ location: "loc-kitchen", time_remaining: 8 });
      expect(kitchen.events[0].narration_parts[0].speaker.kind).toBe("narrator");
      expect(kitchen.events[0].narration_parts[0].text).toContain("Alice is here");

      const back = await play(gameId, "go to the Living Room");
      expect(back.state).toMatchObject({ location: "loc-living-room", time_remaining: 7 });
    });

    it("persists the forced accusation when the last turn is a move", async () => {
      const gameId = await startMockGame(auth);
      setStoredTimeRemaining(gameId, 1);

      const move = await play(gameId, "go to the Living Room");

      expect(move.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
      expect(move.events).toHaveLength(2);
      expect(move.events.map((event) => event.narration_parts[0].speaker.kind)).toEqual(["narrator", "narrator"]);

      const events = readStoredEvents(gameId);
      const moveEvent = events.find((event) => event.event_type === "move");
      const forced = events.find((event) => event.event_type === "forced_endgame");
      expect(moveEvent).toBeDefined();
      expect(forced).toBeDefined();
      // Each narrated event records the model that produced it: the mock profile's.
      expect(moveEvent?.model).toBe("mock/runtime-default");
      expect(forced?.model).toBe("mock/runtime-default");
      expect(forced!.sequence).toBeGreaterThan(moveEvent!.sequence);
      expect(forced?.payload?.trigger).toBe("timeout");
      expect(moveEvent?.narration_parts).toHaveLength(1);
      expect(forced?.narration_parts).toHaveLength(1);
    });
  });

  describe("searching", () => {
    it("reveals the place's clues in order, then falls back to narration with none", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "go to the Living Room");

      const first = await play(gameId, "search");
      expect(first.state).toMatchObject({ mode: "explore", time_remaining: 8 });
      expect(first.events[0].narration_parts[0].text).toContain("A wrapper on the sofa.");
      expect(first.events[0].narration_parts[0].speaker).toMatchObject(NARRATOR_SPEAKER);
      expect(first.revealed_clues).toHaveLength(1);
      expect(first.revealed_clues[0]).toMatchObject({
        id: "clue-wrapper",
        text: "A wrapper on the sofa.",
        source: "search",
        origin: { kind: "location" },
        off_script: false,
      });
      // Reasoning-path labels spoil the mystery and must not reach the client.
      expect(first.revealed_clues[0]).not.toHaveProperty("threads");

      const second = await play(gameId, "search");
      expect(second.state.time_remaining).toBe(7);
      expect(second.events[0].narration_parts[0].text).toContain("A half-eaten cookie.");

      const third = await play(gameId, "search");
      expect(third.state.time_remaining).toBe(6);
      expect(third.events[0].narration_parts[0].text).toContain("discover no new clue");
      expect(third.revealed_clues).toEqual([]);

      const searches = readStoredEvents(gameId).filter((event) => event.event_type === "search");
      expect(searches[0].payload).toMatchObject({
        revealed_clue_id: "clue-wrapper",
        revealed_clue_text: "A wrapper on the sofa.",
        revealed_clue_ids: ["clue-wrapper"],
      });
      expect(searches[1].payload).toMatchObject({
        revealed_clue_id: "clue-half-eaten",
        revealed_clue_text: "A half-eaten cookie.",
        revealed_clue_ids: ["clue-wrapper", "clue-half-eaten"],
      });
      expect(searches[2].payload).toMatchObject({
        revealed_clue_id: null,
        revealed_clue_text: null,
        revealed_clue_ids: ["clue-wrapper", "clue-half-eaten"],
      });
    });

    it("does not count a search that found nothing as having found a clue", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "go to the Living Room");

      // The bookshelf holds no clue: the search finds nothing.
      const empty = await play(gameId, "search behind the bookshelf");
      expect(empty.revealed_clues).toEqual([]);

      // So the next search reveals the room's first clue, and only that one.
      const next = await play(gameId, "search");
      expect(next.revealed_clues.map((clue) => clue.id)).toEqual(["clue-wrapper"]);

      const searches = readStoredEvents(gameId).filter((event) => event.event_type === "search");
      expect(searches[1].payload).toMatchObject({
        revealed_clue_id: "clue-wrapper",
        revealed_clue_ids: ["clue-wrapper"],
      });

      const read = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
      const { state } = SessionTranscriptResponseSchema.parse(await read.json());
      expect(state.discovered_clues?.map((clue) => clue.id)).toEqual(["clue-wrapper"]);
    });

    it("persists the forced accusation when the last turn is a search", async () => {
      const gameId = await startMockGame(auth);
      setStoredTimeRemaining(gameId, 1);

      const search = await play(gameId, "search");

      expect(search.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
      expect(search.events).toHaveLength(2);
      expect(search.events.map((event) => event.narration_parts[0].speaker.kind)).toEqual(["narrator", "narrator"]);

      const events = readStoredEvents(gameId);
      const searchEvent = events.find((event) => event.event_type === "search");
      const forced = events.find((event) => event.event_type === "forced_endgame");
      expect(searchEvent).toBeDefined();
      expect(forced).toBeDefined();
      expect(forced!.sequence).toBeGreaterThan(searchEvent!.sequence);
      expect(forced?.payload?.trigger).toBe("timeout");
      expect(searchEvent?.narration_parts).toHaveLength(1);
      expect(forced?.narration_parts).toHaveLength(1);
    });
  });

  describe("talking", () => {
    it("starts a conversation as the narrator and spends a turn", async () => {
      const gameId = await startMockGame(auth);

      const talk = await play(gameId, "talk to Alice");

      expect(talk.state).toMatchObject({ mode: "talk", current_talk_character: "char-alice", time_remaining: 9 });
      const part = talk.events[0].narration_parts[0];
      expect(part.text).toContain("[Mock]");
      expect(part.text).toContain("she");
      expect(part.text).not.toContain("because she was hungry");
      expect(part).toMatchObject({
        image_id: "mock-blueprint.character-char-alice.png",
        speaker: NARRATOR_SPEAKER,
      });
    });

    it("persists the forced accusation, with its diagnostics, when the last turn starts a conversation", async () => {
      const gameId = await startMockGame(auth);
      setStoredTimeRemaining(gameId, 1);

      const talk = await play(gameId, "talk to Alice");

      expect(talk.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
      expect(talk.events).toHaveLength(2);
      expect(talk.events.map((event) => event.narration_parts[0].speaker.kind)).toEqual(["narrator", "narrator"]);

      const events = readStoredEvents(gameId);
      const talkEvent = events.find((event) => event.event_type === "talk");
      const forced = events.find((event) => event.event_type === "forced_endgame");
      expect(talkEvent?.payload?.diagnostics).toMatchObject({
        event_type: "talk",
        action: "talk",
        event_category: "talk",
        mode: "explore",
        resulting_mode: "accuse",
        time_before: 1,
        time_after: 0,
        time_consumed: true,
        forced_endgame: true,
      });
      expect(forced?.payload?.diagnostics).toMatchObject({
        event_type: "forced_endgame",
        action: "talk",
        event_category: "forced_endgame",
        mode: "accuse",
        resulting_mode: "accuse",
        time_before: 0,
        time_after: 0,
        time_consumed: false,
        forced_endgame: true,
        related_sequence: talkEvent?.sequence,
      });
      expect(forced!.sequence).toBeGreaterThan(talkEvent!.sequence);
      expect(talkEvent?.narration_parts).toHaveLength(1);
      expect(forced?.narration_parts).toHaveLength(1);
    });

    it("answers a question in the character's voice and spends no turn", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "talk to Alice");

      const ask = await play(gameId, "Where were you when the cookies disappeared?");

      expect(ask.state).toMatchObject({ mode: "talk", current_talk_character: "char-alice", time_remaining: 9 });
      const part = ask.events[0].narration_parts[0];
      expect(part.text).toContain("[Mock]");
      expect(part.image_id ?? undefined).toBeUndefined();
      expect(part).toMatchObject({ speaker: characterSpeaker("Alice") });
      expect(Array.isArray(ask.revealed_clues)).toBe(true);

      const askEvent = readStoredEvents(gameId).find((event) => event.event_type === "ask");
      expect(askEvent?.payload?.diagnostics).toMatchObject({ time_consumed: false, forced_endgame: false });
    });

    it("never records a clue the player already holds", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "talk to Alice");

      const first = (await play(gameId, "What did you see?")).revealed_clues.map((clue) => clue.id);
      expect(first.length).toBeGreaterThan(0);
      const second = (await play(gameId, "Where exactly did you see it?")).revealed_clues.map((clue) => clue.id);
      expect(second.filter((id) => first.includes(id))).toEqual([]);

      const recorded = readStoredEvents(gameId)
        .filter((event) => event.event_type === "ask")
        .flatMap((event) => (event.payload?.revealed_clue_ids as string[] | undefined) ?? []);
      expect(new Set(recorded).size).toBe(recorded.length);
    });

    it("ends the conversation as the narrator, back in explore mode, with the turns as they were", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "talk to Alice");

      const bye = await play(gameId, "goodbye");

      expect(bye.state).toMatchObject({ mode: "explore", current_talk_character: null, time_remaining: 9 });
      expect(bye.events[0].narration_parts[0]).toMatchObject({ speaker: NARRATOR_SPEAKER });
      expect(bye.events[0].narration_parts[0].text).toContain("[Mock]");
    });

    it("does not play a line that says nothing", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "talk to Alice");

      for (const blank of ["", "   "]) {
        const res = await sendLine(auth, gameId, blank);
        expect(res.status).toBe(200);
        expect(GameTurnResponseSchema.parse(await res.json()).kind).toBe("refused");
      }

      expect(readStoredEvents(gameId).map((event) => event.event_type)).toEqual(["start", "talk"]);
    });
  });

  describe("accusing", () => {
    it("judges a reasoned accusation over rounds and resolves to a win", async () => {
      const gameId = await startMockGame(auth);

      const roundOne = await play(gameId, "accuse Alice because she had crumbs and no alibi.");
      expect(roundOne.state.mode).toBe("accuse");
      expect(roundOne.result).toBeNull();
      expect(roundOne.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      const roundTwo = await play(gameId, "Alice had motive and access, and the clues match her timeline.");
      expect(roundTwo.state.mode).toBe("ended");
      expect(roundTwo.result).toBe("win");
      expect(roundTwo.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "win" });
    });

    it("plays nothing once the case has ended, and only keeps the line", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "accuse Alice because she had crumbs and no alibi.");
      await play(gameId, "Alice had motive and access, and the clues match her timeline.");
      const events = readStoredEvents(gameId).length;

      const res = await sendLine(auth, gameId, "accuse Bob because I changed my mind");

      expect(res.status).toBe(200);
      expect(GameTurnResponseSchema.parse(await res.json()).kind).toBe("refused");
      const stored = readStoredEvents(gameId);
      expect(stored).toHaveLength(events + 1);
      expect(stored.at(-1)).toMatchObject({ event_type: "no_turn_line", payload: { answered: "refused" } });
      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "win" });
    });

    it("opens accusation mode without reasoning, then takes the rounds", async () => {
      const gameId = await startMockGame(auth);

      const open = await play(gameId, "accuse");
      expect(open.events[0].event_type).toBe("accuse_start");
      expect(open.state.mode).toBe("accuse");
      expect(open.result).toBeNull();
      expect(open.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      await play(gameId, "I accuse Alice. She panicked when I asked about the cookies.");
      const roundTwo = await play(gameId, "The timeline and clues point to Alice.");
      expect(roundTwo.state.mode).toBe("ended");
      expect(roundTwo.events[0].narration_parts[0].speaker.kind).toBe("narrator");
    });

    it("keeps the rounds working after the turns run out and force the accusation", async () => {
      const gameId = await startMockGame(auth);

      let mode = "explore";
      for (let turn = 0; turn < 10 && mode !== "accuse"; turn += 1) {
        mode = (await play(gameId, "search")).state.mode;
      }
      expect(mode).toBe("accuse");
      expect(readStoredSession(gameId)).toMatchObject({ mode: "accuse", time_remaining: 0 });

      const round = await play(gameId, "I accuse Alice because the clues match her timeline.");

      expect(round.state.mode).toBe("accuse");
      expect(round.events[0].narration_parts[0].speaker.kind).toBe("narrator");
    });

    it("turns a wrong suspect away with encouragement, then resolves to a loss from round 3", async () => {
      const gameId = await startMockGame(auth);

      // Rounds 0–2: a wrong accusation is rejected with a retry invitation.
      for (let round = 0; round < 3; round += 1) {
        const answer = await play(gameId, "accuse Bob because he was near the scene.");
        expect(answer.state.mode).toBe("accuse");
        expect(answer.result).toBeNull();
      }

      // Round 3: a still-wrong accusation finally resolves to lose.
      const verdict = await play(gameId, "Final reasoning: Bob is guilty.");
      expect(verdict.state.mode).toBe("ended");
      expect(verdict.result).toBe("lose");
      expect(verdict.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "lose" });
    });
  });
});
