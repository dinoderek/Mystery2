// The turn function over a real SQLite file at a path of the test's own, with
// the mock narrator unless a test needs one it can steer.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GameTurnResponseSchema, NO_TURN_EVENT_TYPE, NoTurnLinePayloadSchema, type TurnPlayedResponse } from "@my2/shared";
import { createAIProviderFromProfile, type AIProvider } from "../../../packages/game-engine/src/ai-provider.ts";
import type { EngineAIProfile, EngineContext } from "../../../packages/game-engine/src/context.ts";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import { RetriableAIError, SaveConflictError } from "../../../packages/game-engine/src/errors.ts";
import { playTurn, type TurnOptions } from "../../../packages/game-engine/src/turn/play-turn.ts";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures.ts";

const BLUEPRINT_ID = "123e4567-e89b-12d3-a456-426614174000";
const REPO_ROOT = process.cwd();

let dir: string;
let local: LocalEngine;
let ctx: EngineContext;
let gameId: string;

const silent = { log: () => {}, logError: () => {} };

function options(overrides: Partial<TurnOptions> = {}): TurnOptions {
  return { req: new Request("http://test/api/game-turn"), request_id: "req-1", logger: silent, ...overrides };
}

async function play(input: string, overrides: Partial<TurnOptions> = {}) {
  return GameTurnResponseSchema.parse(await playTurn(ctx, { game_id: gameId, input }, options(overrides)));
}

async function playAction(input: string, overrides: Partial<TurnOptions> = {}): Promise<TurnPlayedResponse> {
  const answer = await play(input, overrides);
  if (answer.kind !== "turn") throw new Error(`"${input}" did not play: ${JSON.stringify(answer)}`);
  return answer;
}

function storedEvents() {
  return local.db
    .prepare("select sequence, event_type, payload from game_events where session_id = ? order by sequence")
    .all(gameId)
    .map((row) => ({ sequence: Number(row.sequence), event_type: String(row.event_type), payload: JSON.parse(String(row.payload ?? "null")) }));
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-play-turn-"));
  local = createLocalEngine({
    repoRoot: REPO_ROOT,
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
      ai_profile_id: "default",
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

describe("playTurn, for a line that plays nothing", () => {
  it("answers without loading the narrator, and saves only a refusal and help", async () => {
    const createProvider = vi.fn();
    const profiles = vi.spyOn(ctx.aiProfiles, "getById");

    expect(await play("dance", { createProvider })).toMatchObject({ kind: "refused", reason: "unrecognized" });
    expect(await play("go to the moon", { createProvider })).toEqual({
      kind: "refused",
      reason: "invalid-target",
      hint: '"the moon" is not a valid destination. Try: Kitchen, Living Room, Alice Smith.',
    });
    expect(await play("help", { createProvider })).toEqual({ kind: "view", view: "help", section: null, note: "Help menu opened." });
    expect(await play("characters", { createProvider })).toEqual({ kind: "view", view: "characters", section: "people", note: null });
    expect(await play("notebook", { createProvider })).toEqual({ kind: "view", view: "notebook", section: null, note: null });
    expect(await play("quit", { createProvider })).toEqual({ kind: "quit" });
    expect(await play("   ", { createProvider })).toMatchObject({ kind: "refused" });

    expect(createProvider).not.toHaveBeenCalled();
    expect(profiles).not.toHaveBeenCalled();
    expect(storedEvents().map(({ sequence, event_type }) => [sequence, event_type])).toEqual([
      [1, "start"],
      [2, NO_TURN_EVENT_TYPE],
      [3, NO_TURN_EVENT_TYPE],
      [4, NO_TURN_EVENT_TYPE],
    ]);
  });

  it("saves the line as typed and the answer read, and changes nothing in the session", async () => {
    const before = await ctx.sessions.getById(gameId);

    await play("  go to the moon  ");
    await play("Help");

    expect(await ctx.sessions.getById(gameId)).toEqual(before);
    const [refused, help] = local.db
      .prepare("select event_type, actor, narration, narration_parts, payload from game_events where session_id = ? order by sequence")
      .all(gameId)
      .slice(1)
      .map((row) => ({
        ...row,
        payload: NoTurnLinePayloadSchema.parse(JSON.parse(String(row.payload))),
        narration_parts: JSON.parse(String(row.narration_parts)),
      }));
    expect(refused).toMatchObject({
      actor: "system",
      payload: { input: "go to the moon", answered: "refused", reason: "invalid-target" },
      narration: '"the moon" is not a valid destination. Try: Kitchen, Living Room, Alice Smith.',
      narration_parts: [{ speaker: { kind: "system" } }],
    });
    expect(help).toMatchObject({ payload: { input: "Help", answered: "help" }, narration: "Help menu opened." });
    expect(help.payload.reason).toBeUndefined();
  });

  it("is not in the narrator's history, and does not shift what a turn is saved after", async () => {
    await play("dance");
    await play("help");
    const seen: string[] = [];
    const watching = (profile: EngineAIProfile): AIProvider => {
      const inner = createAIProviderFromProfile(profile, { openrouterApiKey: null });
      return {
        profile: inner.profile,
        get resolvedModel() {
          return inner.resolvedModel;
        },
        generateNarration: (prompt, metadata) => {
          seen.push(prompt);
          return inner.generateNarration(prompt, metadata);
        },
        generateRoleOutput: (request) => {
          seen.push(request.prompt, JSON.stringify(request.context));
          return inner.generateRoleOutput(request);
        },
      };
    };

    const answer = await playAction("go to the Living Room", { createProvider: watching });

    expect(answer.events[0].sequence).toBe(4);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.join("\n")).not.toContain("Help menu opened.");
    expect(seen.join("\n")).not.toContain(NO_TURN_EVENT_TYPE);
    expect(storedEvents().map((event) => event.event_type)).toEqual(["start", NO_TURN_EVENT_TYPE, NO_TURN_EVENT_TYPE, "move"]);
  });

  it("refuses to save a line that lost a race with another turn", async () => {
    const save = vi.spyOn(ctx.sessions, "saveTurn").mockRejectedValueOnce(new SaveConflictError(gameId, 2));

    await expect(play("dance")).rejects.toBeInstanceOf(SaveConflictError);
    save.mockRestore();
    expect(storedEvents()).toHaveLength(1);
  });
});

describe("playTurn, for each action", () => {
  it("moves: a turn spent, the place changed, the line stored as typed", async () => {
    const answer = await playAction("  go to the Living Room  ");

    expect(answer.state).toEqual({ mode: "explore", time_remaining: 9, location: "loc-living-room", current_talk_character: null });
    expect(answer.events).toHaveLength(1);
    expect(answer.events[0]).toMatchObject({
      sequence: 2,
      event_type: "move",
      payload: { location_id: "loc-living-room", input: "go to the Living Room" },
      narration_parts: [{ text: "[Mock] You arrive at Living Room. Bob is here." }],
    });
    expect(storedEvents().at(-1)).toMatchObject({ sequence: 2, event_type: "move", payload: { input: "go to the Living Room" } });
    expect(await ctx.sessions.getById(gameId)).toMatchObject({ current_location_id: "loc-living-room", time_remaining: 9 });
  });

  it("searches: the clue found is recorded and costs a turn", async () => {
    const answer = await playAction("search");

    expect(answer.state.time_remaining).toBe(9);
    expect(answer.revealed_clues).toEqual([
      expect.objectContaining({ id: "clue-crumb", source: "search", origin: expect.objectContaining({ kind: "location", location_id: "loc-kitchen" }) }),
    ]);
    expect((await ctx.sessions.getById(gameId))?.discovered_clues).toEqual(["clue-crumb"]);
  });

  it("talks, asks and says goodbye: only walking up costs a turn", async () => {
    const talk = await playAction("talk to Alice");
    expect(talk.state).toMatchObject({ mode: "talk", time_remaining: 9, current_talk_character: "char-alice" });

    const ask = await playAction("Where were you?");
    expect(ask.state).toMatchObject({ mode: "talk", time_remaining: 9 });
    expect(ask.events[0]).toMatchObject({ event_type: "ask", payload: { player_input: "Where were you?", input: "Where were you?" } });
    expect(ask.revealed_clues.map((clue) => [clue.id, clue.source])).toEqual([["clue-alice-saw-bob", "talk"]]);

    const bye = await playAction("bye");
    expect(bye.state).toMatchObject({ mode: "explore", time_remaining: 9, current_talk_character: null });
    expect(bye.events[0]).toMatchObject({ event_type: "end_talk", payload: { input: "bye" } });
  });

  it("accuses: the scene, a round that goes on, and a verdict", async () => {
    const start = await playAction("accuse");
    expect(start.events[0].event_type).toBe("accuse_start");
    expect(start.state.mode).toBe("accuse");

    const round = await playAction("Maybe it was Bob?");
    expect(round.events[0]).toMatchObject({ event_type: "accuse_round", payload: { player_reasoning: "Maybe it was Bob?" } });
    expect(round.result).toBeNull();

    const verdict = await playAction("I think it was Alice, because of the empty cookie jar.");
    expect(verdict.events[0].event_type).toBe("accuse_resolved");
    expect(verdict.result).not.toBeNull();
    expect(verdict.state.mode).toBe("ended");
    expect((await ctx.sessions.getById(gameId))?.outcome).toBe(verdict.result);
  });

  it("forces the accusation when the last turn is spent, in the same save", async () => {
    await ctx.sessions.update(gameId, { time_remaining: 1 });

    const answer = await playAction("move to living room");

    expect(answer.state).toMatchObject({ mode: "accuse", time_remaining: 0 });
    expect(answer.events.map((event) => [event.sequence, event.event_type])).toEqual([
      [2, "move"],
      [3, "forced_endgame"],
    ]);
    expect(storedEvents().map((event) => event.event_type)).toEqual(["start", "move", "forced_endgame"]);
  });
});

describe("playTurn, when it cannot finish", () => {
  /** The mock narrator, with some of its calls replaced. */
  function steered(overrides: Partial<Pick<AIProvider, "generateNarration" | "generateRoleOutput">>) {
    return (profile: EngineAIProfile): AIProvider => {
      const inner = createAIProviderFromProfile(profile, { openrouterApiKey: null });
      return {
        profile: inner.profile,
        get resolvedModel() {
          return inner.resolvedModel;
        },
        generateNarration: overrides.generateNarration ?? ((prompt, metadata) => inner.generateNarration(prompt, metadata)),
        generateRoleOutput: overrides.generateRoleOutput ?? ((request) => inner.generateRoleOutput(request)),
      };
    };
  }

  it("writes nothing when the narrator fails", async () => {
    const before = await ctx.sessions.getById(gameId);
    const failing = steered({
      generateRoleOutput: async () => {
        throw new Error("the model said something unreadable");
      },
    });

    await expect(play("search", { createProvider: failing })).rejects.toMatchObject({
      name: "RetriableAIError",
      details: { code: "AI_INVALID_OUTPUT" },
    });
    expect(await ctx.sessions.getById(gameId)).toEqual(before);
    expect(storedEvents()).toHaveLength(1);
  });

  it("saves one of two turns that read the same game, and refuses the other", async () => {
    // Both turns are held at the narrator until both have read the game.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let waiting = 0;
    const held = steered({
      async generateNarration() {
        waiting += 1;
        if (waiting === 2) release();
        await gate;
        return "[Held] You arrive.";
      },
    });

    const results = await Promise.allSettled([
      play("go to the living room", { createProvider: held }),
      play("go to the living room", { createProvider: held }),
    ]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(SaveConflictError);
    expect(storedEvents().map((event) => event.sequence)).toEqual([1, 2]);
    expect((await ctx.sessions.getById(gameId))?.time_remaining).toBe(9);
  });

  it("refuses a game the player cannot see", async () => {
    const grace = local.contextFor({ id: local.players.ensure("Grace").id });
    await expect(playTurn(grace, { game_id: gameId, input: "search" }, options())).rejects.toMatchObject({
      name: "RequestRejectedError",
      status: 404,
    });
    expect(storedEvents()).toHaveLength(1);
  });

  it("passes a retriable narrator failure on unchanged", async () => {
    const busy = steered({
      generateNarration: async () => {
        throw new RetriableAIError("busy", { code: "OPENROUTER_TEMPORARY_FAILURE", status: 429 });
      },
    });

    await expect(play("move to living room", { createProvider: busy })).rejects.toMatchObject({
      details: { code: "OPENROUTER_TEMPORARY_FAILURE", status: 429 },
    });
    expect(storedEvents()).toHaveLength(1);
  });
});
