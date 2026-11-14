// The game-start adapter: which AI opens the case, and what it answers when
// none can. A chosen AI that is missing or broken is an error naming it, and
// nothing is started with mock in its place.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EngineContext } from "../../../packages/game-engine/src/context.ts";
import { createLocalEngine, type LocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import { handle } from "../../../packages/game-engine/src/endpoints/game-start.ts";

const BLUEPRINT_ID = "123e4567-e89b-12d3-a456-426614174000";

let dir: string;
let local: LocalEngine;
let ctx: EngineContext;

function open(aiConfig?: unknown): void {
  if (aiConfig !== undefined) fs.writeFileSync(path.join(dir, "ai.json"), JSON.stringify(aiConfig));
  local = createLocalEngine({
    repoRoot: process.cwd(),
    env: { MYSTERY_CONFIG_ROOT: dir },
    databasePath: path.join(dir, "database", "test", "game.db"),
  });
  ctx = local.contextFor({ id: local.players.ensure("Ada").id });
}

function start(body: Record<string, unknown> = {}): Promise<Response> {
  return handle(
    new Request("http://test/api/game-start", {
      method: "POST",
      body: JSON.stringify({ blueprint_id: BLUEPRINT_ID, ...body }),
    }),
    ctx,
  );
}

function sessionCount(): number {
  return Number(local.db.prepare("select count(*) as n from game_sessions").get()?.n);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-game-start-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  local.close();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("game-start, choosing who narrates", () => {
  it("opens with mock while nothing is chosen, recording default", async () => {
    open();

    const response = await start();

    expect(response.status).toBe(200);
    const { game_id: gameId } = await response.json();
    const session = await ctx.sessions.getById(gameId);
    expect(session?.ai_profile_id).toBe("default");
    expect(local.db.prepare("select model from game_events where session_id = ?").get(gameId)).toEqual({
      model: "mock/runtime-default",
    });
  });

  it("answers 400 for a named AI that is not in ai.json", async () => {
    open();

    const response = await start({ ai_profile: "luna6" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid ai_profile" });
    expect(sessionCount()).toBe(0);
  });

  it("answers an error naming a chosen AI that has gone, and starts nothing", async () => {
    open();
    local.aiSettings.setChoice("luna6");

    const response = await start();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/The AI chosen on the settings page, "luna6", is not in ai\.json/);
    expect(sessionCount()).toBe(0);
  });

  it("answers an error naming a chosen AI with no key, and starts nothing", async () => {
    open({ ais: { free: { backend: "openrouter", model: "vendor/free" } } });
    local.aiSettings.setChoice("free");

    const response = await start();

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/AI "free" uses openrouter but has no key/);
    expect(sessionCount()).toBe(0);
  });

  it("lets a request that names mock open the case whatever is chosen", async () => {
    open();
    local.aiSettings.setChoice("luna6");

    expect((await start({ ai_profile: "mock" })).status).toBe(200);
  });
});

describe("game-start, refusing a request", () => {
  it("answers 404 for a blueprint it does not have", async () => {
    open();

    expect((await start({ blueprint_id: "00000000-0000-4000-8000-000000000000" })).status).toBe(404);
    expect(sessionCount()).toBe(0);
  });

  it("answers 400 naming a missing field", async () => {
    open();

    const response = await handle(new Request("http://test/api/game-start", { method: "POST", body: "{}" }), ctx);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ details: { field: "blueprint_id" } });
  });
});
