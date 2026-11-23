// A game's reading age: the case's age by default, the profile's when it set
// one, and what every narrator prompt in the game is written for.

import fs from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  GameGetResponseSchema,
  GameStartResponseSchema,
  type ClueGraphWorld,
  type PlayableBlueprint,
  type PlayableCase,
} from "@my2/shared";
import { atReadingAge, gameReadingAge, READING_AGES } from "../../../packages/shared/src/reading-age.ts";
import { createLocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import { handle as gameStart } from "../../../packages/game-engine/src/endpoints/game-start.ts";
import { handle as gameGet } from "../../../packages/game-engine/src/endpoints/game-get.ts";
import { MAX_TARGET_AGE, MIN_TARGET_AGE } from "../../../packages/shared/src/age-profile.ts";
import { buildNarrationPrompt, buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { sessionCase } from "../../../packages/game-engine/src/session-case.ts";
import type { ContentStore, GameSessionRow } from "../../../packages/game-engine/src/context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

const silentLogger = { log: () => {}, logError: () => {} };

// The V2 fixture, for V2 talk and for a case outside the age range, which only V2's schema allows: both leave with V2.
let v2: PlayableBlueprint;
let graph: ClueGraphWorld;

beforeAll(async () => {
  v2 = JSON.parse(await readFile("blueprints/mock-blueprint.json", "utf-8"));
  graph = readMockCase();
});

const readerLine = (prompt: string) => prompt.match(/The reader is (\d+) years old/)?.[1];

function talkStart(blueprint: PlayableCase) {
  return buildRoleRequest({
    role: "talk_start",
    game_id: "g1",
    blueprint,
    conversation_history: [],
    session: { mode: "talk", current_location_id: blueprint.world.characters[0].location_id, current_talk_character_id: blueprint.world.characters[0].id, time_remaining: 5 },
    character_id: blueprint.world.characters[0].id,
    location_id: blueprint.world.characters[0].location_id,
  });
}

function graphGreeting(blueprint: ClueGraphWorld) {
  const character = blueprint.world.characters[0];
  return buildRoleRequest({
    role: "graph_talk",
    game_id: "g1",
    blueprint,
    conversation_history: [],
    session: { mode: "talk", current_location_id: character.location_id, current_talk_character_id: character.id, time_remaining: 5 },
    character_id: character.id,
    location_id: character.location_id,
    player_input: null,
  });
}

/** A saved game of `blueprint`: the mock case, with its snapshot, unless named. */
function session(readingAge: number | null, blueprint: PlayableCase = graph): GameSessionRow {
  return {
    id: "g1",
    player_id: "p1",
    blueprint_id: blueprint.id,
    ...(blueprint.clue_graph ? { clue_graph_snapshot: blueprint.clue_graph } : {}),
    ai_profile_id: "default",
    mode: "explore",
    current_location_id: blueprint.world.starting_location_id,
    current_talk_character_id: null,
    time_remaining: 5,
    discovered_clues: [],
    outcome: null,
    reading_age: readingAge,
    created_at: "2026-11-22T10:00:00.000Z",
    updated_at: "2026-11-22T10:00:00.000Z",
  };
}

const content = {
  loadBlueprint: async () => v2,
} as unknown as ContentStore;

describe("atReadingAge", () => {
  it("keeps the case as it is with no age, or with the case's own", () => {
    expect(atReadingAge(graph, null)).toBe(graph);
    expect(atReadingAge(graph, graph.metadata.target_age)).toBe(graph);
  });

  it("reads the case at another age without touching the case", () => {
    const played = atReadingAge(graph, 7);
    expect(played.metadata.target_age).toBe(7);
    expect(played.metadata.title).toBe(graph.metadata.title);
    expect(graph.metadata.target_age).toBe(10);
  });

  it("offers every age the narrator can write for", () => {
    expect(READING_AGES[0]).toBe(MIN_TARGET_AGE);
    expect(READING_AGES.at(-1)).toBe(MAX_TARGET_AGE);
  });
});

describe("gameReadingAge", () => {
  it("takes the chosen age over the case's", () => {
    expect(gameReadingAge(10, 7)).toBe(7);
    expect(gameReadingAge(14, 9)).toBe(9);
  });

  it("reads a case at its own age, brought into range as every prompt reads it", () => {
    expect(gameReadingAge(8, null)).toBe(8);
    expect(gameReadingAge(14, null)).toBe(MAX_TARGET_AGE);
    expect(gameReadingAge(3, null)).toBe(MIN_TARGET_AGE);
  });
});

describe("the narrator prompt follows the game's age", () => {
  it("gives one V2 case different age guidance at two ages", async () => {
    const at7 = (await talkStart(atReadingAge(v2, 7))).prompt;
    const at10 = (await talkStart(atReadingAge(v2, 10))).prompt;

    expect(readerLine(at7)).toBe("7");
    expect(readerLine(at10)).toBe("10");
    expect(at7).not.toEqual(at10);
  });

  it("gives one clue-graph case different age guidance at two ages", async () => {
    const at6 = (await graphGreeting(atReadingAge(graph, 6))).prompt;
    const at11 = (await graphGreeting(atReadingAge(graph, 11))).prompt;

    expect(readerLine(at6)).toBe("6");
    expect(readerLine(at11)).toBe("11");
  });

  it("writes the opening for the game's age", () => {
    const opening = buildNarrationPrompt({ role: "intro", game_id: "g1", blueprint: atReadingAge(graph, 8) });
    expect(readerLine(opening)).toBe("8");
  });

  it("plays a saved game at its own age, and an older game at its case's", async () => {
    const saved = await sessionCase(content, session(7), silentLogger);
    const older = await sessionCase(content, session(null), silentLogger);

    expect(readerLine((await graphGreeting(saved as ClueGraphWorld)).prompt)).toBe("7");
    expect(readerLine((await graphGreeting(older as ClueGraphWorld)).prompt)).toBe(String(graph.metadata.target_age));
    expect((await graphGreeting(older as ClueGraphWorld)).prompt).toEqual((await graphGreeting(graph)).prompt);
  });
});

describe("a case whose own age is outside the range", () => {
  it("starts at the nearest age the narrator writes for, and resumes at it", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-reading-age-"));
    const local = createLocalEngine({
      repoRoot: process.cwd(),
      env: { MYSTERY_CONFIG_ROOT: dir },
      databasePath: path.join(dir, "database", "test", "game.db"),
    });
    try {
      // Its schema takes any positive age, and a generated case may use one.
      const older = atReadingAge(v2, 14);
      const base = local.contextFor({ id: local.players.ensure("Ada").id });
      const ctx = { ...base, content: { ...base.content, loadBlueprint: async () => older } };

      const res = await gameStart(
        new Request("http://test/api/game-start", { method: "POST", body: JSON.stringify({ blueprint_id: v2.id }) }),
        ctx,
      );
      expect(res.status).toBe(200);
      const started = GameStartResponseSchema.parse(await res.json());
      expect(started.reading_age).toBe(MAX_TARGET_AGE);

      // A game saved before games had an age reads at the same one.
      local.db.prepare("update game_sessions set reading_age = null where id = ?").run(started.game_id);
      const resumed = await gameGet(new Request(`http://test/api/game-get?game_id=${started.game_id}`), ctx);
      expect(resumed.status).toBe(200);
      expect(GameGetResponseSchema.parse(await resumed.json()).reading_age).toBe(MAX_TARGET_AGE);
    } finally {
      local.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("narrates exactly as it did before games had an age", async () => {
    const older = atReadingAge(v2, 14);
    const played = await sessionCase({ loadBlueprint: async () => older } as unknown as ContentStore, session(null, v2), silentLogger);

    expect((await talkStart(played!)).prompt).toEqual((await talkStart(older)).prompt);
  });
});
