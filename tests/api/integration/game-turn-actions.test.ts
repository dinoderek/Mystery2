import fs from "node:fs";

import { beforeEach, describe, expect, it } from "vitest";

import { GameTurnResponseSchema, SessionTranscriptResponseSchema } from "@my2/shared";
import { NARRATOR_SPEAKER, characterSpeaker } from "../../testkit/src/fixtures";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import {
  API_URL,
  playLine,
  readStoredEvents,
  readStoredSession,
  sendLine,
  setStoredTimeRemaining,
  setupApiTestAuth,
  startMockGame,
  V2_MOCK_BLUEPRINT_ID,
  type ApiAuthContext,
} from "./helpers";

/** The V2 fixture, for V2 talk state alone. */
const v2MockBlueprint = JSON.parse(fs.readFileSync("blueprints/mock-blueprint.json", "utf8")) as Parameters<
  typeof buildRoleRequest
>[0]["blueprint"];

// What each action does to the game, played as typed lines through `game-turn`
// under the mock narrator. The request and answer shapes are in
// `game-turn.test.ts`; the unit suites hold the grammar and the turn arithmetic.

const SCORE_SHEET = "The board game's score sheet shows a move written in Bob's handwriting every five minutes from half past eleven to half past twelve.";
const TOY_MOUSE = "A toy mouse is wedged behind the bookshelf, covered in dust.";

describe("game-turn actions", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("game-turn-actions");
  });

  const play = (gameId: string, input: string) => playLine(auth, gameId, input);

  /** Gathers one route to the culprit: the empty jar, and the score sheet that clears Bob. */
  async function gatherCase(gameId: string) {
    await play(gameId, "search the pantry shelf");
    await play(gameId, "go to the Living Room");
    await play(gameId, "search");
  }

  describe("moving", () => {
    it("moves the player, spends a turn, and narrates the arrival as the narrator", async () => {
      const gameId = await startMockGame(auth);

      const move = await play(gameId, "go to the Living Room");

      expect(move.state).toMatchObject({ mode: "explore", location: "loc-living-room", time_remaining: 9 });
      expect(move.events).toHaveLength(1);
      expect(move.events[0].narration_parts[0]).toMatchObject({
        text: "[Mock] You arrive at Living Room. The living room is cosy, with a sofa and a tall bookshelf. A board game is laid out on the low table. Bob is here.",
        image_id: "mock-case.location-loc-living-room.png",
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
      expect(forced?.narration_parts).toHaveLength(2); // the scene, then the rule
    });
  });

  describe("searching", () => {
    it("reveals the place's clue, then a spot's by name, then falls back to narration with none", async () => {
      const gameId = await startMockGame(auth);
      await play(gameId, "go to the Living Room");

      const first = await play(gameId, "search");
      expect(first.state).toMatchObject({ mode: "explore", time_remaining: 8 });
      expect(first.events[0].narration_parts[0].text).toContain(SCORE_SHEET);
      expect(first.events[0].narration_parts[0].speaker).toMatchObject(NARRATOR_SPEAKER);
      expect(first.revealed_clues).toHaveLength(1);
      expect(first.revealed_clues[0]).toMatchObject({
        id: "clue_score_sheet",
        text: `[Mock] ${SCORE_SHEET}`,
        source: "search",
        origin: { kind: "location" },
        off_script: false,
      });
      // Reasoning-path labels spoil the mystery and must not reach the client.
      expect(first.revealed_clues[0]).not.toHaveProperty("threads");

      const second = await play(gameId, "search behind the bookshelf");
      expect(second.state.time_remaining).toBe(7);
      expect(second.events[0].narration_parts[0].text).toContain(TOY_MOUSE);

      const third = await play(gameId, "search");
      expect(third.state.time_remaining).toBe(6);
      expect(third.events[0].narration_parts[0].text).toContain("find nothing new");
      expect(third.revealed_clues).toEqual([]);

      // Each search records what it found, and only that.
      const searches = readStoredEvents(gameId).filter((event) => event.event_type === "search");
      expect(searches[0].payload).toMatchObject({
        revealed_clue_id: "clue_score_sheet",
        revealed_clue_text: `[Mock] ${SCORE_SHEET}`,
        revealed_clue_ids: ["clue_score_sheet"],
      });
      expect(searches[1].payload).toMatchObject({
        revealed_clue_id: "clue_bookshelf_toy",
        revealed_clue_text: `[Mock] ${TOY_MOUSE}`,
        revealed_clue_ids: ["clue_bookshelf_toy"],
      });
      expect(searches[2].payload).toMatchObject({
        revealed_clue_id: null,
        revealed_clue_text: null,
        revealed_clue_ids: [],
      });
    });

    it("does not count a search that found nothing as having found a clue", async () => {
      const gameId = await startMockGame(auth);

      const pantry = await play(gameId, "search the pantry shelf");
      expect(pantry.revealed_clues.map((clue) => clue.id)).toEqual(["clue_jar"]);

      // The pantry's clue is found and the sink holds none: the search finds nothing.
      const empty = await play(gameId, "search the sink");
      expect(empty.revealed_clues).toEqual([]);

      // So the next search reveals the room's clue, and only that one.
      const next = await play(gameId, "search");
      expect(next.revealed_clues.map((clue) => clue.id)).toEqual(["clue_crumbs"]);

      const searches = readStoredEvents(gameId).filter((event) => event.event_type === "search");
      expect(searches[1].payload).toMatchObject({ revealed_clue_id: null, revealed_clue_ids: [] });
      expect(searches[2].payload).toMatchObject({
        revealed_clue_id: "clue_crumbs",
        revealed_clue_ids: ["clue_crumbs"],
      });

      const read = await fetch(`${API_URL}/game-get?game_id=${gameId}`, { headers: auth.headers });
      const { state } = SessionTranscriptResponseSchema.parse(await read.json());
      expect(state.discovered_clues?.map((clue) => clue.id)).toEqual(["clue_jar", "clue_crumbs"]);
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
      expect(forced?.narration_parts).toHaveLength(2); // the scene, then the rule
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
      // The greeting gives what she says first, never the truth of the case.
      expect(part.text).toContain("Alice says she saw Bob sneak into the kitchen at noon.");
      expect(part.text).not.toContain("could not resist");
      expect(part).toMatchObject({
        image_id: "mock-case.character-char-alice.png",
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
      expect(forced?.narration_parts).toHaveLength(2); // the scene, then the rule
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

      const first = (await play(gameId, "Where were you at noon?")).revealed_clues.map((clue) => clue.id);
      expect(first).toEqual(["alice_noon"]);
      const second = (await play(gameId, "Where exactly were you at noon?")).revealed_clues.map((clue) => clue.id);
      expect(second.filter((id) => first.includes(id))).toEqual([]);

      const recorded = readStoredEvents(gameId)
        .filter((event) => event.event_type === "ask")
        .flatMap((event) => (event.payload?.revealed_clue_ids as string[] | undefined) ?? []);
      expect(new Set(recorded).size).toBe(recorded.length);
    });

    // V2 talk state: it leaves with V2.
    it("keeps a reaction and a commitment from one visit in the next visit's context", async () => {
      const gameId = await startMockGame(auth, V2_MOCK_BLUEPRINT_ID);
      await play(gameId, "search");
      await play(gameId, "talk to Alice");
      // The mock reads a line that names a gate clue's id as using it.
      const shown = await play(gameId, "Look, clue-crumb: someone was snacking!");
      expect(shown.events[0].payload).toMatchObject({
        used_clue_ids: ["clue-crumb"],
        used_quote: "Look, clue-crumb: someone was snacking!",
      });
      // A line starting "did you" draws a denial, recorded as a commitment.
      const denied = await play(gameId, "Did you eat the cookies?");
      expect(denied.events[0].payload).toMatchObject({ used_clue_ids: [], new_commitments: ["denies: eat the cookies"] });
      await play(gameId, "goodbye");
      await play(gameId, "go to the Living Room");
      await play(gameId, "go to the Kitchen");

      await play(gameId, "talk to Alice");
      const later = await play(gameId, "Where were you this afternoon?");

      // The second visit's narration keeps to the earned reaction.
      expect(later.events[0].narration_parts[0].text).toContain(
        "(Keeps to: Admits she had one snack, but says she was still reading.)",
      );
      expect(later.events[0].payload).toMatchObject({ used_clue_ids: [], used_quote: null, new_commitments: [] });

      // Its context, rebuilt from the stored events before it by the builder the
      // turn used, carries both.
      const events = readStoredEvents(gameId);
      const session = readStoredSession(gameId)!;
      expect(session.mode).toBe("talk");
      const { context } = await buildRoleRequest({
        role: "talk_conversation",
        game_id: gameId,
        session: { ...session, mode: "talk" },
        blueprint: v2MockBlueprint,
        character_id: "char-alice",
        location_id: "loc-kitchen",
        player_input: "Where were you this afternoon?",
        conversation_history: events.slice(0, -1),
      });
      expect(context.talk_context?.active_character?.state).toMatchObject({
        current_story: [expect.any(String), "Admits she had one snack, but says she was still reading."],
        commitments: ["denies: eat the cookies"],
        visits_with_questions: 2,
      });
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
    it("judges a reasoned accusation at once and resolves to a win", async () => {
      const gameId = await startMockGame(auth);
      await gatherCase(gameId);

      const won = await play(gameId, "accuse Alice because the cookie jar was empty and Bob was playing his board game.");
      expect(won.state.mode).toBe("ended");
      expect(won.result).toBe("win");
      expect(won.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "win" });
    });

    it("plays nothing once the case has ended, and only keeps the line", async () => {
      const gameId = await startMockGame(auth);
      await gatherCase(gameId);
      await play(gameId, "accuse Alice because the cookie jar was empty and Bob was playing his board game.");
      const events = readStoredEvents(gameId).length;

      const res = await sendLine(auth, gameId, "accuse Bob because I changed my mind");

      expect(res.status).toBe(200);
      expect(GameTurnResponseSchema.parse(await res.json()).kind).toBe("refused");
      const stored = readStoredEvents(gameId);
      expect(stored).toHaveLength(events + 1);
      expect(stored.at(-1)).toMatchObject({ event_type: "no_turn_line", payload: { answered: "refused" } });
      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "win" });
    });

    it("opens accusation mode without reasoning, then judges the line typed there", async () => {
      const gameId = await startMockGame(auth);
      await gatherCase(gameId);

      const open = await play(gameId, "accuse");
      expect(open.events[0].event_type).toBe("accuse_start");
      expect(open.state.mode).toBe("accuse");
      expect(open.result).toBeNull();
      expect(open.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      const won = await play(gameId, "I accuse Alice. Her floury fingerprints are on the empty cookie jar.");
      expect(won.state.mode).toBe("ended");
      expect(won.result).toBe("win");
      expect(won.events[0].narration_parts[0].speaker.kind).toBe("narrator");
    });

    it("stays in the accusation after a failure once the turns run out and force it", async () => {
      const gameId = await startMockGame(auth);

      let mode = "explore";
      for (let turn = 0; turn < 10 && mode !== "accuse"; turn += 1) {
        mode = (await play(gameId, "search")).state.mode;
      }
      expect(mode).toBe("accuse");
      expect(readStoredSession(gameId)).toMatchObject({ mode: "accuse", time_remaining: 0 });

      const failed = await play(gameId, "I accuse Bob because he was near the scene.");

      expect(failed.state).toMatchObject({ mode: "accuse", accusations_left: 2 });
      expect(failed.events[0].narration_parts[0].speaker.kind).toBe("narrator");
    });

    it("turns a wrong suspect away with encouragement, then loses on the third failure", async () => {
      const gameId = await startMockGame(auth);

      // The first two wrong accusations each spend one and return to exploring.
      for (const left of [2, 1]) {
        const answer = await play(gameId, "accuse Bob because he was near the scene.");
        expect(answer.state).toMatchObject({ mode: "explore", accusations_left: left });
        expect(answer.result).toBeNull();
      }

      // The third still-wrong accusation resolves to lose.
      const verdict = await play(gameId, "accuse Bob: final reasoning, Bob is guilty.");
      expect(verdict.state).toMatchObject({ mode: "ended", accusations_left: 0 });
      expect(verdict.result).toBe("lose");
      expect(verdict.events[0].narration_parts[0].speaker.kind).toBe("narrator");

      expect(readStoredSession(gameId)).toMatchObject({ mode: "ended", outcome: "lose" });
    });
  });
});
