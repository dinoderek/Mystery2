// `createLocalEngine` — the whole local `EngineContext`, assembled the way the
// SvelteKit server will assemble it in P3.
//
// The point of these tests is the seam, not the parts: a context built here is
// the same shape every endpoint handler receives, and two
// contexts built for two players cannot see each other's work.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import {
  resolveBlueprintDirs,
  resolveBlueprintImagesDir,
  resolveDatabasePath,
} from "../../../packages/game-engine/src/paths.ts";
import type { LogWriter } from "../../../packages/game-engine/src/logging.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

const silentLogger: LogWriter = { log: () => {}, logError: () => {} };

let repoRoot: string;

function engine() {
  return createLocalEngine({
    repoRoot,
    env: {},
    databasePath: path.join(repoRoot, "data", "game.db"),
  });
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-ctx-"));
  fs.mkdirSync(path.join(repoRoot, "blueprints"), { recursive: true });
  fs.writeFileSync(
    path.join(repoRoot, "blueprints", `${validBlueprintV2.id}.json`),
    JSON.stringify(validBlueprintV2),
  );
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("createLocalEngine", () => {
  it("serves a full turn's worth of context for one player", async () => {
    const local = engine();
    try {
      const player = local.players.ensure("Ada");
      const ctx = local.contextFor({ id: player.id });

      const profile = await ctx.aiProfiles.getById("default");
      expect(profile).toMatchObject({ id: "default", provider: "mock" });

      const blueprint = await ctx.content.loadBlueprint(
        validBlueprintV2.id,
        silentLogger,
      );
      expect(blueprint?.id).toBe(validBlueprintV2.id);

      const gameId = await ctx.sessions.create({
        player_id: player.id,
        blueprint_id: blueprint!.id,
        ai_profile_id: profile!.id,
        mode: "explore",
        current_location_id: blueprint!.world.starting_location_id,
        time_remaining: blueprint!.metadata.time_budget,
      });

      await ctx.events.insert({
        session_id: gameId,
        sequence: await ctx.events.nextSequence(gameId),
        event_type: "start",
        actor: "system",
        payload: null,
        narration: "The case begins.",
        narration_parts: [
          {
            text: "The case begins.",
            speaker: { kind: "narrator", key: "narrator", label: "Narrator" },
          },
        ],
        model: profile!.model,
      });

      expect((await ctx.sessions.listForPlayer()).map((s) => s.id)).toEqual([gameId]);
      expect(await ctx.events.listBySession(gameId)).toHaveLength(1);
      expect((await ctx.content.listBlueprints()).map((e) => e.blueprint.id)).toEqual([
        validBlueprintV2.id,
      ]);
    } finally {
      local.close();
    }
  });

  it("keeps two local profiles apart", async () => {
    const local = engine();
    try {
      const ada = local.players.ensure("Ada");
      const grace = local.players.ensure("Grace");

      const adaCtx = local.contextFor({ id: ada.id });
      const graceCtx = local.contextFor({ id: grace.id });

      const gameId = await adaCtx.sessions.create({
        player_id: ada.id,
        blueprint_id: validBlueprintV2.id,
        ai_profile_id: "default",
        mode: "explore",
        current_location_id: "loc_kitchen",
        time_remaining: 12,
      });

      expect(await graceCtx.sessions.getById(gameId)).toBeNull();
      expect(await graceCtx.sessions.listForPlayer()).toEqual([]);
      expect(await graceCtx.events.listBySession(gameId)).toEqual([]);
    } finally {
      local.close();
    }
  });

  it("creates the database file under the path it is given", () => {
    const local = engine();
    local.close();

    expect(fs.existsSync(path.join(repoRoot, "data", "game.db"))).toBe(true);
  });
});

describe("path resolution", () => {
  it("puts the database in the shared config root when one is set", () => {
    expect(
      resolveDatabasePath("/repo", { MYSTERY_CONFIG_ROOT: "/shared/mystery" }),
    ).toBe(path.join("/shared/mystery", "game.db"));
  });

  it("otherwise keeps it in the repo's gitignored data directory", () => {
    expect(resolveDatabasePath("/repo", {})).toBe(path.join("/repo", "data", "game.db"));
  });

  it("searches the config root before the blueprints committed to the repo", () => {
    expect(resolveBlueprintDirs("/repo", { MYSTERY_CONFIG_ROOT: "/shared/mystery" })).toEqual([
      path.join("/shared/mystery", "blueprints"),
      path.join("/repo", "blueprints"),
    ]);
    expect(resolveBlueprintImagesDir("/repo", {})).toBe(
      path.join("/repo", "blueprint-images"),
    );
  });

  it("searches one directory when there is no separate config root", () => {
    expect(resolveBlueprintDirs("/repo", {})).toEqual([path.join("/repo", "blueprints")]);
  });
});
