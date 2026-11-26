// The reading age: the profile's, read on every request, and the input every
// narrator prompt is written for, whatever age the case names.

import { beforeAll, describe, expect, it } from "vitest";

import type { ClueGraphWorld } from "@my2/shared";
import { READING_AGES } from "../../../packages/shared/src/reading-age.ts";
import { authoredFieldBudget, MAX_TARGET_AGE, MIN_TARGET_AGE } from "../../../packages/shared/src/age-profile.ts";
import { buildNarrationPrompt, buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";
import { READING_AGE_REQUIRED } from "../../../packages/shared/src/mystery-api-contracts.ts";
import { asRejectedResponse, RequestRejectedError } from "../../../packages/game-engine/src/errors.ts";
import { requestReadingAge } from "../../../packages/game-engine/src/reading-age.ts";
import { sessionCase } from "../../../packages/game-engine/src/session-case.ts";
import type { ContentStore, GameSessionRow, ProfileStore } from "../../../packages/game-engine/src/context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

const silentLogger = { log: () => {}, logError: () => {} };

let graph: ClueGraphWorld;

beforeAll(() => {
  graph = readMockCase();
});

const readerLine = (prompt: string) => prompt.match(/The reader is (\d+) years old/)?.[1];

/** The case naming an age of its own. */
function atCaseAge(world: ClueGraphWorld, age: number): ClueGraphWorld {
  return { ...world, metadata: { ...world.metadata, target_age: age } };
}

function graphGreeting(blueprint: ClueGraphWorld, readingAge: number) {
  const character = blueprint.world.characters[0];
  return buildRoleRequest({
    role: "graph_talk",
    game_id: "g1",
    blueprint,
    reading_age: readingAge,
    conversation_history: [],
    session: { mode: "talk", current_location_id: character.location_id, current_talk_character_id: character.id, time_remaining: 5 },
    character_id: character.id,
    location_id: character.location_id,
    player_input: null,
  });
}

function profileAt(age: number | null): ProfileStore {
  return { getReadingAge: async () => age, setReadingAge: async () => {} };
}

describe("the reading ages", () => {
  it("offers every age the narrator can write for", () => {
    expect(READING_AGES[0]).toBe(MIN_TARGET_AGE);
    expect(READING_AGES.at(-1)).toBe(MAX_TARGET_AGE);
  });
});

describe("requestReadingAge", () => {
  it("is the profile's age", async () => {
    expect(await requestReadingAge(profileAt(7))).toBe(7);
    expect(await requestReadingAge(profileAt(11))).toBe(11);
  });

  it("refuses a profile with no age, naming READING_AGE_REQUIRED, and never reads the case's", async () => {
    const refused = await requestReadingAge(profileAt(null)).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(RequestRejectedError);
    expect(refused).toMatchObject({ status: 400, reason: "reading_age_missing", code: READING_AGE_REQUIRED });
    const response = asRejectedResponse(refused)!;
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Choose a reading age before playing",
      details: { code: "READING_AGE_REQUIRED" },
    });
  });
});

describe("the narrator prompt follows the reading age it is given", () => {
  it("gives one case different age guidance at two ages", async () => {
    const at6 = (await graphGreeting(graph, 6)).prompt;
    const at11 = (await graphGreeting(graph, 11)).prompt;

    expect(readerLine(at6)).toBe("6");
    expect(readerLine(at11)).toBe("11");
    expect(at6).not.toEqual(at11);
  });

  it("writes for the reader, never for the case's own age", async () => {
    const older = atCaseAge(graph, 11);

    expect(readerLine((await graphGreeting(older, 6)).prompt)).toBe("6");
    expect((await graphGreeting(older, 6)).prompt).toEqual((await graphGreeting(atCaseAge(graph, 7), 6)).prompt);
    expect(readerLine(buildNarrationPrompt({ role: "intro", game_id: "g1", blueprint: older, reading_age: 6 }))).toBe("6");
  });

  it("sizes the notebook line for the reader's age", async () => {
    const at6 = (await graphGreeting(atCaseAge(graph, 11), 6)).prompt;
    expect(at6).toContain(`a line of about ${authoredFieldBudget("clue_text", 6)} words`);
    expect(authoredFieldBudget("clue_text", 6)).not.toBe(authoredFieldBudget("clue_text", 11));
  });
});

describe("sessionCase", () => {
  it("returns the case a game saved, as stored", async () => {
    const session = {
      id: "g1",
      player_id: "p1",
      blueprint_id: graph.id,
      clue_graph_snapshot: graph.clue_graph,
      ai_profile_id: "default",
      mode: "explore",
      current_location_id: graph.world.starting_location_id,
      current_talk_character_id: null,
      time_remaining: 5,
      discovered_clues: [],
      outcome: null,
      created_at: "2026-11-22T10:00:00.000Z",
      updated_at: "2026-11-22T10:00:00.000Z",
    } satisfies GameSessionRow;
    const content = { loadBlueprint: async () => graph } as unknown as ContentStore;

    const played = await sessionCase(content, session, silentLogger);
    expect(played?.metadata.target_age).toBe(graph.clue_graph.metadata.target_age);
  });
});
