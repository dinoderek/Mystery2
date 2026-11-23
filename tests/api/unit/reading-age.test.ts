// A game's reading age: the case's age by default, the profile's when it set
// one, and what every narrator prompt in the game is written for.

import { beforeAll, describe, expect, it } from "vitest";

import type { ClueGraphWorld } from "@my2/shared";
import { atReadingAge, gameReadingAge, READING_AGES } from "../../../packages/shared/src/reading-age.ts";
import { MAX_TARGET_AGE, MIN_TARGET_AGE } from "../../../packages/shared/src/age-profile.ts";
import { buildNarrationPrompt, buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { sessionCase } from "../../../packages/game-engine/src/session-case.ts";
import type { ContentStore, GameSessionRow } from "../../../packages/game-engine/src/context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

const silentLogger = { log: () => {}, logError: () => {} };

let graph: ClueGraphWorld;

beforeAll(() => {
  graph = readMockCase();
});

const readerLine = (prompt: string) => prompt.match(/The reader is (\d+) years old/)?.[1];

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
function session(readingAge: number | null, blueprint: ClueGraphWorld = graph): GameSessionRow {
  return {
    id: "g1",
    player_id: "p1",
    blueprint_id: blueprint.id,
    clue_graph_snapshot: blueprint.clue_graph,
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
  loadBlueprint: async () => graph,
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
  it("gives one case different age guidance at two ages", async () => {
    const at6 = (await graphGreeting(atReadingAge(graph, 6))).prompt;
    const at11 = (await graphGreeting(atReadingAge(graph, 11))).prompt;

    expect(readerLine(at6)).toBe("6");
    expect(readerLine(at11)).toBe("11");
    expect(at6).not.toEqual(at11);
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
