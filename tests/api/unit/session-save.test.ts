// `sessions.saveTurn` — one turn's session change and events, saved once or
// not at all, over a real SQLite file at a path of the test's own.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  EngineContext,
  SaveEvent,
} from "../../../packages/game-engine/src/context.ts";
import {
  createLocalEngine,
  type LocalEngine,
} from "../../../packages/game-engine/src/context-local.ts";
import { SaveConflictError } from "../../../packages/game-engine/src/errors.ts";
import { NARRATOR_SPEAKER } from "../../../packages/game-engine/src/speaker.ts";

let dir: string;
let local: LocalEngine;
let ada: EngineContext;
let grace: EngineContext;

function event(text: string, overrides: Partial<SaveEvent> = {}): SaveEvent {
  return {
    event_type: "search",
    actor: "system",
    payload: null,
    narration: text,
    narration_parts: [{ text, speaker: NARRATOR_SPEAKER }],
    model: null,
    ...overrides,
  };
}

async function startGame(ctx: EngineContext, gameId: string): Promise<void> {
  await ctx.sessions.saveTurn({
    game_id: gameId,
    expected_sequence: 1,
    start: {
      player_id: ctx.player.id,
      blueprint_id: "bp",
      ai_profile_id: "default",
      mode: "explore",
      current_location_id: "loc_a",
      time_remaining: 10,
    },
    events: [event("opening", { event_type: "start" })],
  });
}

function sequences(gameId: string): number[] {
  return local.db
    .prepare("select sequence from game_events where session_id = ? order by sequence")
    .all(gameId)
    .map((row) => Number(row.sequence));
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-session-save-"));
  local = createLocalEngine({
    repoRoot: dir,
    env: {},
    databasePath: path.join(dir, "database", "test", "game.db"),
  });
  ada = local.contextFor({ id: local.players.ensure("Ada").id });
  grace = local.contextFor({ id: local.players.ensure("Grace").id });
});

afterEach(() => {
  local.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("sessions.saveTurn", () => {
  it("starts a game: the session and its first event together", async () => {
    await startGame(ada, "game-1");

    expect(await ada.sessions.getById("game-1")).toMatchObject({
      id: "game-1",
      player_id: ada.player.id,
      mode: "explore",
      time_remaining: 10,
    });
    expect(sequences("game-1")).toEqual([1]);
  });

  it("writes the patch and every event with consecutive sequences", async () => {
    await startGame(ada, "game-1");

    await ada.sessions.saveTurn({
      game_id: "game-1",
      expected_sequence: 2,
      patch: { time_remaining: 9, current_location_id: "loc_b" },
      events: [event("one"), event("two"), event("three")],
    });

    expect(await ada.sessions.getById("game-1")).toMatchObject({
      time_remaining: 9,
      current_location_id: "loc_b",
    });
    expect(sequences("game-1")).toEqual([1, 2, 3, 4]);
    expect((await ada.events.listBySession("game-1")).map((e) => e.narration)).toEqual([
      "opening",
      "one",
      "two",
      "three",
    ]);
  });

  it("writes nothing and throws the conflict error when the sequence is stale", async () => {
    await startGame(ada, "game-1");

    const stale = ada.sessions.saveTurn({
      game_id: "game-1",
      expected_sequence: 1,
      patch: { time_remaining: 1 },
      events: [event("late")],
    });
    await expect(stale).rejects.toBeInstanceOf(SaveConflictError);

    const early = ada.sessions.saveTurn({
      game_id: "game-1",
      expected_sequence: 3,
      patch: { time_remaining: 1 },
      events: [event("early")],
    });
    await expect(early).rejects.toBeInstanceOf(SaveConflictError);

    expect((await ada.sessions.getById("game-1"))?.time_remaining).toBe(10);
    expect(sequences("game-1")).toEqual([1]);
  });

  it("refuses the second of two turns that expected the same sequence", async () => {
    await startGame(ada, "game-1");

    await ada.sessions.saveTurn({
      game_id: "game-1",
      expected_sequence: 2,
      patch: { time_remaining: 9 },
      events: [event("first")],
    });
    await expect(
      ada.sessions.saveTurn({
        game_id: "game-1",
        expected_sequence: 2,
        patch: { time_remaining: 8 },
        events: [event("second")],
      }),
    ).rejects.toBeInstanceOf(SaveConflictError);

    expect((await ada.sessions.getById("game-1"))?.time_remaining).toBe(9);
    expect(sequences("game-1")).toEqual([1, 2]);
  });

  it("leaves session and events as they were when a write fails part-way", async () => {
    await startGame(ada, "game-1");

    const broken = event("broken", { narration: null as unknown as string });
    await expect(
      ada.sessions.saveTurn({
        game_id: "game-1",
        expected_sequence: 2,
        patch: { time_remaining: 5, mode: "talk" },
        events: [event("fine"), broken],
      }),
    ).rejects.toThrow();

    expect(await ada.sessions.getById("game-1")).toMatchObject({
      time_remaining: 10,
      mode: "explore",
    });
    expect(sequences("game-1")).toEqual([1]);
  });

  it("starts no session when the first event cannot be written", async () => {
    await expect(
      ada.sessions.saveTurn({
        game_id: "game-2",
        expected_sequence: 1,
        start: {
          player_id: ada.player.id,
          blueprint_id: "bp",
          ai_profile_id: "default",
          mode: "explore",
          current_location_id: "loc_a",
          time_remaining: 10,
        },
        events: [event("broken", { narration: null as unknown as string })],
      }),
    ).rejects.toThrow();

    expect(await ada.sessions.getById("game-2")).toBeNull();
    expect(sequences("game-2")).toEqual([]);
  });

  it("starts no session when the sequence expected for a new game is not 1", async () => {
    await expect(
      ada.sessions.saveTurn({
        game_id: "game-3",
        expected_sequence: 2,
        start: {
          player_id: ada.player.id,
          blueprint_id: "bp",
          ai_profile_id: "default",
          mode: "explore",
          current_location_id: "loc_a",
          time_remaining: 10,
        },
        events: [event("opening")],
      }),
    ).rejects.toBeInstanceOf(SaveConflictError);

    expect(await ada.sessions.getById("game-3")).toBeNull();
  });

  it("cannot touch another profile's session", async () => {
    await startGame(ada, "game-1");

    await expect(
      grace.sessions.saveTurn({
        game_id: "game-1",
        expected_sequence: 2,
        patch: { time_remaining: 0 },
        events: [event("intruder")],
      }),
    ).rejects.toThrow(/not available/);

    expect((await ada.sessions.getById("game-1"))?.time_remaining).toBe(10);
    expect(sequences("game-1")).toEqual([1]);
  });

  it("cannot start a session for another profile", async () => {
    await expect(
      grace.sessions.saveTurn({
        game_id: "game-4",
        expected_sequence: 1,
        start: {
          player_id: ada.player.id,
          blueprint_id: "bp",
          ai_profile_id: "default",
          mode: "explore",
          current_location_id: "loc_a",
          time_remaining: 10,
        },
        events: [event("opening")],
      }),
    ).rejects.toThrow(/another player/);

    expect(sequences("game-4")).toEqual([]);
  });
});
