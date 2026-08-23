import { describe, expect, it } from "vitest";

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

  it("routes every action to its named endpoint via POST", () => {
    expect(ACTIONS.talk.endpoint.name).toBe("game-talk");
    expect(ACTIONS.ask.endpoint.name).toBe("game-ask");
    expect(ACTIONS.move.endpoint.name).toBe("game-move");
    expect(ACTIONS.search.endpoint.name).toBe("game-search");
    expect(ACTIONS.accuse.endpoint.name).toBe("game-accuse");
    for (const type of ["talk", "ask", "move", "search", "accuse"] as const) {
      expect(ACTIONS[type].endpoint.method).toBe("POST");
    }
  });

  it("builds endpoint bodies from the game id and action fields", () => {
    const gid = "g1";
    expect(ACTIONS.talk.endpoint.body({}, { character_id: "c1" }, gid)).toEqual({
      game_id: gid,
      character_id: "c1",
    });
    expect(ACTIONS.ask.endpoint.body({}, { player_input: "who?" }, gid)).toEqual({
      game_id: gid,
      player_input: "who?",
    });
    expect(ACTIONS.move.endpoint.body({}, { destination: "l2" }, gid)).toEqual({
      game_id: gid,
      destination: "l2",
    });
    expect(ACTIONS.search.endpoint.body({}, {}, gid)).toEqual({ game_id: gid });
  });

  it("omits the accusation history mode from the accuse body unless supplied", () => {
    const base = ACTIONS.accuse.endpoint.body({}, { player_reasoning: "r" }, "g1");
    expect(base).toEqual({ game_id: "g1", player_reasoning: "r" });
    expect(base).not.toHaveProperty("accusation_history_mode");

    const withMode = ACTIONS.accuse.endpoint.body(
      {},
      { player_reasoning: "r", accusation_history_mode: "full" },
      "g1",
    );
    expect(withMode).toEqual({
      game_id: "g1",
      player_reasoning: "r",
      accusation_history_mode: "full",
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

  it("omits player_reasoning from the accuse body when opening the scene", () => {
    const given = { mode: "accuse", location_id: "l1", time_remaining: 5 };
    expect(ACTIONS.accuse.endpoint.body(given, { type: "accuse" }, "g1")).toEqual({
      game_id: "g1",
    });
  });

  it("passes a search query through to the endpoint body", () => {
    const given = { mode: "explore", location_id: "l1", time_remaining: 20 };
    expect(
      ACTIONS.search.endpoint.body(given, { type: "search", search_query: "the shelf" }, "g1"),
    ).toEqual({ game_id: "g1", search_query: "the shelf" });
    expect(ACTIONS.search.endpoint.body(given, { type: "search" }, "g1")).toEqual({
      game_id: "g1",
    });
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
