// game-get's notebook Story: the opening as its start event saved it, and an
// empty Story, logged once, for a history that has lost its start event.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import { handle } from "../../../packages/game-engine/src/endpoints/game-get.ts";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures.ts";
import { MOCK_CASE_ID, readMockCaseGraph } from "../../testkit/src/mock-case.ts";

let dir: string;
let local: LocalEngine;
let ctx: EngineContext;
let gameId: string;
let errors: string[];

const OPENING = "You step into a warm kitchen that smells of cookies.";

function event(eventType: string, text: string) {
  return {
    event_type: eventType,
    actor: "system",
    payload: null,
    narration: text,
    narration_parts: [{ text, speaker: NARRATOR_SPEAKER }],
    model: null,
  };
}

async function story(context: EngineContext): Promise<{ status: number; story: unknown }> {
  const response = await handle(new Request(`http://test/api/game-get?game_id=${gameId}`), context);
  return { status: response.status, story: (await response.json()).state?.story };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-game-get-"));
  local = createLocalEngine({
    repoRoot: process.cwd(),
    env: { MYSTERY_CONFIG_ROOT: dir },
    databasePath: path.join(dir, "database", "test", "game.db"),
  });
  ctx = local.contextFor({ id: local.players.ensure("Ada", 8).id });
  gameId = crypto.randomUUID();
  const start = event("start", OPENING);
  await ctx.sessions.saveTurn({
    game_id: gameId,
    expected_sequence: 1,
    start: {
      player_id: ctx.player.id,
      blueprint_id: MOCK_CASE_ID,
      ai_profile_id: "mock",
      mode: "explore",
      current_location_id: "loc-kitchen",
      time_remaining: 10,
      clue_graph_snapshot: readMockCaseGraph(),
    },
    events: [{ ...start, narration_parts: [...start.narration_parts, { text: "Tip: type notebook.", speaker: NARRATOR_SPEAKER }] }],
  });
  errors = [];
  vi.spyOn(console, "error").mockImplementation((line: string) => { errors.push(line); });
});

afterEach(() => {
  vi.restoreAllMocks();
  local.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("game-get's Story", () => {
  it("is the opening its start event saved, without the notebook tip", async () => {
    expect(await story(ctx)).toEqual({ status: 200, story: OPENING });
    expect(errors).toEqual([]);
  });

  it("is empty, and logged once, for a history without its start event", async () => {
    const lost: EngineContext = {
      ...ctx,
      events: {
        ...ctx.events,
        async listBySession(id) {
          return (await ctx.events.listBySession(id)).filter((row) => row.event_type !== "start");
        },
      },
    };

    expect(await story(lost)).toEqual({ status: 200, story: null });
    const logged = errors.map((line) => JSON.parse(line));
    expect(logged).toHaveLength(1);
    expect(logged[0]).toMatchObject({ reason: "start_event_missing", game_id: gameId, events_loaded: 0 });
  });
});
