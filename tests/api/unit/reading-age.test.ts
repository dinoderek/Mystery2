// A game's reading age: the case's age by default, the profile's when it set
// one, and what every narrator prompt in the game is written for.

import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import { buildClueGraphBlueprint, validateClueGraph, type PlayableBlueprint } from "@my2/shared";
import { atReadingAge, READING_AGES } from "../../../packages/shared/src/reading-age.ts";
import { MAX_TARGET_AGE, MIN_TARGET_AGE } from "../../../packages/shared/src/age-profile.ts";
import { buildNarrationPrompt, buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { sessionCase } from "../../../packages/game-engine/src/session-case.ts";
import type { ContentStore, GameSessionRow } from "../../../packages/game-engine/src/context.ts";

const silentLogger = { log: () => {}, logError: () => {} };

let v2: PlayableBlueprint;
let graph: PlayableBlueprint;

beforeAll(async () => {
  v2 = JSON.parse(await readFile("blueprints/mock-blueprint.json", "utf-8"));
  graph = buildClueGraphBlueprint(
    validateClueGraph(JSON.parse(await readFile("blueprints/clue-graph/greenhouse-prizewinner.json", "utf-8"))),
  );
});

const readerLine = (prompt: string) => prompt.match(/The reader is (\d+) years old/)?.[1];

function talkStart(blueprint: PlayableBlueprint) {
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

function graphGreeting(blueprint: PlayableBlueprint) {
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

function session(readingAge: number | null): GameSessionRow {
  return {
    id: "g1",
    player_id: "p1",
    blueprint_id: v2.id,
    ai_profile_id: "default",
    mode: "explore",
    current_location_id: v2.world.starting_location_id,
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
    expect(atReadingAge(v2, null)).toBe(v2);
    expect(atReadingAge(v2, v2.metadata.target_age)).toBe(v2);
  });

  it("reads the case at another age without touching the case", () => {
    const played = atReadingAge(v2, 7);
    expect(played.metadata.target_age).toBe(7);
    expect(played.metadata.title).toBe(v2.metadata.title);
    expect(v2.metadata.target_age).toBe(10);
  });

  it("offers every age the narrator can write for", () => {
    expect(READING_AGES[0]).toBe(MIN_TARGET_AGE);
    expect(READING_AGES.at(-1)).toBe(MAX_TARGET_AGE);
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
    const opening = buildNarrationPrompt({ role: "intro", game_id: "g1", blueprint: atReadingAge(v2, 8) });
    expect(readerLine(opening)).toBe("8");
  });

  it("plays a saved game at its own age, and an older game at its case's", async () => {
    const saved = await sessionCase(content, session(7), silentLogger);
    const older = await sessionCase(content, session(null), silentLogger);

    expect(readerLine((await talkStart(saved!)).prompt)).toBe("7");
    expect(readerLine((await talkStart(older!)).prompt)).toBe(String(v2.metadata.target_age));
    expect((await talkStart(older!)).prompt).toEqual((await talkStart(v2)).prompt);
  });
});
