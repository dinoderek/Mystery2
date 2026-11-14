import { describe, expect, it } from "vitest";

import { interpretLine, type GrammarState } from "../../../packages/game-engine/src/command-grammar.ts";
import type { GameMode } from "../../../packages/game-engine/src/state-machine.ts";

import {
  ACTIONS,
  characterFirstName,
  getAction,
  locationName,
  normalizeHistory,
  snapshotFromGiven,
} from "../../../evaluation/runtime/lib/roles.mjs";

// The shared action/role map is the single source of truth both runtime
// backends use to turn a case's `action` plus its fixed `given` state into
// either a reconstructed CLI prompt or a live endpoint call. It is pure and
// needs no database or LLM, so we assert its resolution directly.

describe("snapshotFromGiven", () => {
  it("maps given state onto the session snapshot the context builders expect", () => {
    expect(
      snapshotFromGiven({
        mode: "talk",
        location_id: "l1",
        talk_character_id: "c1",
        time_remaining: 30,
      }),
    ).toEqual({
      mode: "talk",
      current_location_id: "l1",
      current_talk_character_id: "c1",
      time_remaining: 30,
    });
  });

  it("defaults the talk character to null when none is in play", () => {
    expect(
      snapshotFromGiven({ mode: "explore", location_id: "l2", time_remaining: 10 }),
    ).toEqual({
      mode: "explore",
      current_location_id: "l2",
      current_talk_character_id: null,
      time_remaining: 10,
    });
  });
});

describe("normalizeHistory", () => {
  it("assigns sequential sequences and defaults actor/narration/payload", () => {
    expect(
      normalizeHistory([{ event_type: "ask" }, { event_type: "talk", actor: "player" }]),
    ).toEqual([
      { sequence: 1, event_type: "ask", actor: "system", narration: "", payload: {} },
      { sequence: 2, event_type: "talk", actor: "player", narration: "", payload: {} },
    ]);
  });

  it("preserves an explicit sequence and all provided fields", () => {
    expect(
      normalizeHistory([
        {
          sequence: 5,
          event_type: "move",
          actor: "system",
          narration: "moved",
          payload: { destination: "l2" },
        },
      ]),
    ).toEqual([
      {
        sequence: 5,
        event_type: "move",
        actor: "system",
        narration: "moved",
        payload: { destination: "l2" },
      },
    ]);
  });

  it("returns an empty array for null or undefined history", () => {
    expect(normalizeHistory(null)).toEqual([]);
    expect(normalizeHistory(undefined)).toEqual([]);
    expect(normalizeHistory([])).toEqual([]);
  });
});

describe("getAction", () => {
  it("resolves each known action to its registry entry", () => {
    for (const type of ["talk", "ask", "move", "search", "accuse"]) {
      expect(getAction(type)).toBe(ACTIONS[type]);
    }
  });

  it("throws a listing the known types for an unknown action", () => {
    expect(() => getAction("nope")).toThrow(
      'Unknown action type "nope". Known: start, talk, ask, end_talk, move, search, accuse',
    );
  });
});

describe("ACTIONS registry", () => {
  it("exposes exactly the seven supported action types", () => {
    expect(Object.keys(ACTIONS)).toEqual(["start", "talk", "ask", "end_talk", "move", "search", "accuse"]);
  });

  it("reports the session mode each action is valid from", () => {
    // requiredMode is both the mode the action is valid from and what the
    // harness seeds before running it.
    expect(ACTIONS.talk.requiredMode).toBe("explore");
    expect(ACTIONS.ask.requiredMode).toBe("talk");
    expect(ACTIONS.move.requiredMode).toBe("explore");
    expect(ACTIONS.search.requiredMode).toBe("explore");
    expect(ACTIONS.accuse.requiredMode).toBe("accuse");
  });

  it("sends every turn action to game-turn via POST, and start to game-start", () => {
    for (const type of ["talk", "ask", "end_talk", "move", "search", "accuse"] as const) {
      expect(ACTIONS[type].endpoint.name).toBe("game-turn");
      expect(ACTIONS[type].endpoint.method).toBe("POST");
    }
    expect(ACTIONS.start.endpoint.name).toBe("game-start");
  });

  it("builds the request from the game id and the typed line", () => {
    const given = { mode: "explore", location_id: "l1", time_remaining: 9 };
    expect(ACTIONS.move.endpoint.body(given, { type: "move", destination: "l2" }, "g1")).toEqual({
      game_id: "g1",
      input: "move to l2",
    });
    expect(ACTIONS.search.endpoint.body(given, { type: "search" }, "g1")).toEqual({
      game_id: "g1",
      input: "search",
    });
  });

  it("carries a local-replay mapping for every action", () => {
    // Prompt assembly is shared with the handlers now, so every action can be
    // replayed locally — there is no endpoint-only tier left.
    for (const type of Object.keys(ACTIONS)) {
      const action = getAction(type);
      expect(action.roleInput, `${type} has no roleInput`).toBeTypeOf("function");
      expect(action.speaker, `${type} has no speaker`).toBeTypeOf("function");
    }
  });
});

describe("ACTIONS local-replay mapping", () => {
  const blueprint = {
    metadata: { target_age: 9 },
    narrative: { starting_knowledge: { characters: [] } },
    world: {
      characters: [{ id: "c1", first_name: "Ann", location_id: "l1" }],
      locations: [{ id: "l1", name: "Hall", clues: [] }],
    },
  };

  it("names the role and hands over the handler's fields for talk", () => {
    const given = { mode: "explore", location_id: "l1", time_remaining: 20 };
    const action = { type: "talk", character_id: "c1" };

    const input = ACTIONS.talk.roleInput(given, action, blueprint, ["H"]);
    expect(input).toMatchObject({
      role: "talk_start",
      game_id: "case",
      character_id: "c1",
      location_id: "l1",
      conversation_history: ["H"],
      session: snapshotFromGiven(given),
    });
    // The mapping carries no prompt text or context of its own — assembly is
    // the shared layer's job.
    expect(input).not.toHaveProperty("promptVars");
    expect(input).not.toHaveProperty("builder");

    // A talk-start turn is narrated, so the speaker is the narrator.
    expect(ACTIONS.talk.speaker(given, action, blueprint)).toEqual({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
  });

  it("resolves the talk-conversation role and character speaker for ask", () => {
    const given = { mode: "talk", location_id: "l1", talk_character_id: "c1", time_remaining: 20 };
    const action = { type: "ask", player_input: "who?" };

    const input = ACTIONS.ask.roleInput(given, action, blueprint, []);
    expect(input.role).toBe("talk_conversation");
    expect(input.player_input).toBe("who?");
    // A reply comes from the character being questioned.
    expect(ACTIONS.ask.speaker(given, action, blueprint)).toEqual({
      kind: "character",
      key: "character:ann",
      label: "Ann",
    });
  });

  it("picks the search role from the presence of a free-text query", () => {
    const given = { mode: "explore", location_id: "l1", time_remaining: 20 };
    expect(
      ACTIONS.search.roleInput(given, { type: "search" }, blueprint, []).role,
    ).toBe("search_bare");
    expect(
      ACTIONS.search.roleInput(given, { type: "search", search_query: "under the bed" }, blueprint, []).role,
    ).toBe("search_targeted");
  });

  it("picks the accusation role from the presence of reasoning", () => {
    const given = { mode: "accuse", location_id: "l1", time_remaining: 5 };
    expect(
      ACTIONS.accuse.roleInput(given, { type: "accuse" }, blueprint, []).role,
    ).toBe("accusation_start");

    const judge = ACTIONS.accuse.roleInput(
      given,
      { type: "accuse", player_reasoning: "It was Ann" },
      blueprint,
      [{ event_type: "accuse_round" }],
    );
    expect(judge.role).toBe("accusation_judge");
    expect(judge.player_input).toBe("It was Ann");
    expect(judge.round).toBe(1);
  });
});

// Every structured action is sent as the line a player would type, and the
// engine's grammar must read that line back as the same action.
describe("typed lines for structured actions", () => {
  const blueprint = {
    world: {
      locations: [
        { id: "loc-kitchen", name: "Kitchen" },
        { id: "loc-living-room", name: "Living Room" },
      ],
      characters: [
        { id: "char-alice", first_name: "Alice", last_name: "Smith", location_id: "loc-kitchen" },
        { id: "char-bob", first_name: "Bob", last_name: "Jones", location_id: "loc-living-room" },
      ],
    },
  };
  const grammarState = (mode: GameMode, location: string): GrammarState => ({
    mode,
    location,
    locations: blueprint.world.locations,
    characters: blueprint.world.characters.map((c) => ({ ...c, location_name: c.location_id })),
  });
  const lineFor = (given: Record<string, unknown>, action: Record<string, unknown>) =>
    ACTIONS[action.type as keyof typeof ACTIONS].line(given, action, blueprint);
  const readBack = (given: { mode: GameMode; location_id: string }, action: Record<string, unknown>) =>
    interpretLine(lineFor(given, action), grammarState(given.mode, given.location_id));

  const explore = { mode: "explore" as const, location_id: "loc-kitchen", time_remaining: 9 };
  const talking = { ...explore, mode: "talk" as const, talk_character_id: "char-alice" };
  const accusing = { ...explore, mode: "accuse" as const };

  it("reads a move back as a move to the same place", () => {
    expect(readBack(explore, { type: "move", destination: "loc-living-room" })).toEqual({
      kind: "action",
      action: { type: "move", destination: "loc-living-room" },
    });
  });

  it("names a character by the name the blueprint gives", () => {
    expect(lineFor(explore, { type: "talk", character_id: "char-alice" })).toBe("talk to Alice Smith");
    expect(readBack(explore, { type: "talk", character_id: "char-alice" })).toEqual({
      kind: "action",
      action: { type: "talk", character_id: "char-alice" },
    });
    expect(() => lineFor(explore, { type: "talk", character_id: "char-nobody" })).toThrow(
      'Character "char-nobody" is not in the blueprint',
    );
  });

  it("reads a search with and without a query", () => {
    expect(readBack(explore, { type: "search" })).toEqual({
      kind: "action",
      action: { type: "search", query: null },
    });
    expect(readBack(explore, { type: "search", search_query: "the shelf" })).toEqual({
      kind: "action",
      action: { type: "search", query: "the shelf" },
    });
  });

  it("reads a question and a farewell in a conversation", () => {
    expect(readBack(talking, { type: "ask", player_input: "Where were you?" })).toEqual({
      kind: "action",
      action: { type: "ask", question: "Where were you?" },
    });
    expect(readBack(talking, { type: "end_talk" })).toEqual({
      kind: "action",
      action: { type: "end_talk" },
    });
  });

  it("opens an accusation from explore, with or without reasoning", () => {
    expect(readBack(explore, { type: "accuse" })).toEqual({
      kind: "action",
      action: { type: "accuse", reasoning: null },
    });
    expect(readBack(explore, { type: "accuse", player_reasoning: "It was Alice." })).toEqual({
      kind: "action",
      action: { type: "accuse", reasoning: "It was Alice." },
    });
  });

  it("sends reasoning on its own once the accusation is open", () => {
    expect(lineFor(accusing, { type: "accuse", player_reasoning: "It was Alice." })).toBe("It was Alice.");
    expect(readBack(accusing, { type: "accuse", player_reasoning: "It was Alice." })).toEqual({
      kind: "action",
      action: { type: "ask", question: "It was Alice." },
    });
    // No line reopens an accusation that is already open.
    expect(() => lineFor(accusing, { type: "accuse" })).toThrow("needs player_reasoning");
  });
});

describe("the start action creates its own session", () => {
  const blueprint = { id: "bp-1", metadata: { target_age: 9 }, world: { characters: [], locations: [] } };

  it("is flagged as session-creating and has no prior mode", () => {
    // Every other action addresses a seeded session; start makes one, so the
    // endpoint backend must skip seeding for it.
    expect(ACTIONS.start.createsSession).toBe(true);
    expect(ACTIONS.start.requiredMode).toBeNull();
    for (const type of ["talk", "ask", "end_talk", "move", "search", "accuse"]) {
      expect(getAction(type).createsSession, `${type} must not create a session`).toBeUndefined();
    }
  });

  it("addresses the blueprint and profile instead of a game id", () => {
    expect(
      ACTIONS.start.endpoint.body({}, { type: "start" }, null, {
        blueprint,
        aiProfile: "default",
      }),
    ).toEqual({ blueprint_id: "bp-1", ai_profile: "default" });
  });

  it("maps to the intro narration role", () => {
    expect(ACTIONS.start.roleInput({}, { type: "start" }, blueprint, []).role).toBe("intro");
  });
});

describe("blueprint name lookups", () => {
  const blueprint = {
    world: {
      characters: [{ id: "c1", first_name: "Ann" }],
      locations: [{ id: "l1", name: "Hall" }],
    },
  };

  it("returns the matching name and falls back to the id when unknown", () => {
    expect(characterFirstName(blueprint, "c1")).toBe("Ann");
    expect(characterFirstName(blueprint, "missing")).toBe("missing");
    expect(locationName(blueprint, "l1")).toBe("Hall");
    expect(locationName(blueprint, "missing")).toBe("missing");
  });
});
