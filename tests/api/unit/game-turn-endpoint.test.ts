// The game-turn adapter: what each failure answers, and the race between two
// turns for one game, held so both read the game before either saves.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import { handle } from "../../../packages/game-engine/src/endpoints/game-turn.ts";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures.ts";

const BLUEPRINT_ID = "123e4567-e89b-12d3-a456-426614174000";

let dir: string;
let local: LocalEngine;
let ctx: EngineContext;
let gameId: string;

function turnRequest(body: unknown): Request {
  return new Request("http://test/api/game-turn", { method: "POST", body: JSON.stringify(body) });
}

function sequences(): number[] {
  return local.db
    .prepare("select sequence from game_events where session_id = ? order by sequence")
    .all(gameId)
    .map((row) => Number(row.sequence));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-game-turn-"));
  local = createLocalEngine({
    repoRoot: process.cwd(),
    env: { MYSTERY_CONFIG_ROOT: dir },
    databasePath: path.join(dir, "database", "test", "game.db"),
  });
  ctx = local.contextFor({ id: local.players.ensure("Ada").id });
  gameId = crypto.randomUUID();
  await ctx.sessions.saveTurn({
    game_id: gameId,
    expected_sequence: 1,
    start: {
      player_id: ctx.player.id,
      blueprint_id: BLUEPRINT_ID,
      ai_profile_id: "mock",
      mode: "explore",
      current_location_id: "loc-kitchen",
      time_remaining: 10,
    },
    events: [
      {
        event_type: "start",
        actor: "system",
        payload: null,
        narration: "Opening.",
        narration_parts: [{ text: "Opening.", speaker: NARRATOR_SPEAKER }],
        model: null,
      },
    ],
  });
});

afterEach(() => {
  local.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("game-turn", () => {
  it("saves one of two turns that read the game together and answers the other 409", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let readers = 0;
    const held: EngineContext = {
      ...ctx,
      events: {
        ...ctx.events,
        async listBySession(id) {
          const history = await ctx.events.listBySession(id);
          readers += 1;
          if (readers === 2) release();
          await gate;
          return history;
        },
      },
    };

    const responses = await Promise.all([
      handle(turnRequest({ game_id: gameId, input: "search" }), held),
      handle(turnRequest({ game_id: gameId, input: "go to the living room" }), held),
    ]);

    expect(responses.map((res) => res.status).sort()).toEqual([200, 409]);
    const conflict = await responses.find((res) => res.status === 409)!.json();
    expect(conflict.details).toMatchObject({ code: "SAVE_CONFLICT" });
    expect(sequences()).toEqual([1, 2]);
  });

  it("answers 404 for a game the player does not have", async () => {
    const res = await handle(turnRequest({ game_id: crypto.randomUUID(), input: "search" }), ctx);
    expect(res.status).toBe(404);
  });

  it("answers 400 for an action the mode does not allow", async () => {
    // Talking with nobody: a corrupted session the grammar cannot see past.
    await ctx.sessions.update(gameId, { mode: "talk", current_talk_character_id: null });

    const res = await handle(turnRequest({ game_id: gameId, input: "bye" }), ctx);

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No active conversation to end");
    expect(sequences()).toEqual([1]);
  });
});
