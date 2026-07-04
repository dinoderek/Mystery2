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
      'Unknown action type "nope". Known: talk, ask, move, search, accuse',
    );
  });
});

describe("ACTIONS registry", () => {
  it("exposes exactly the five supported action types", () => {
    expect(Object.keys(ACTIONS)).toEqual(["talk", "ask", "move", "search", "accuse"]);
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

  it("only carries CLI-replay config for the actions whose prompt is replayed", () => {
    // talk and ask reconstruct a local prompt; move/search/accuse are
    // endpoint-only and intentionally have no cli block.
    expect(ACTIONS.talk.cli).toBeDefined();
    expect(ACTIONS.ask.cli).toBeDefined();
    expect(ACTIONS.move.cli).toBeUndefined();
    expect(ACTIONS.search.cli).toBeUndefined();
    expect(ACTIONS.accuse.cli).toBeUndefined();
  });
});

describe("ACTIONS CLI replay config", () => {
  const blueprint = {
    metadata: { target_age: 9 },
    world: {
      characters: [{ id: "c1", first_name: "Ann" }],
      locations: [{ id: "l1", name: "Hall" }],
    },
  };

  it("resolves the talk-start role, prompt vars, context input, and speaker", () => {
    const given = { mode: "explore", location_id: "l1", time_remaining: 20 };
    const action = { type: "talk", character_id: "c1" };
    const { cli } = ACTIONS.talk;

    expect(cli.role).toBe("talk_start");
    expect(cli.builder).toBe("buildTalkStartContext");
    expect(cli.promptVars(given, action, blueprint)).toEqual({
      character_name: "Ann",
      location_name: "Hall",
      target_age: 9,
    });

    const context = cli.contextInput(given, action, blueprint, ["H"]);
    expect(context).toMatchObject({
      game_id: "case",
      character_id: "c1",
      location_id: "l1",
      conversation_history: ["H"],
      session: snapshotFromGiven(given),
    });
    // A talk-start turn is narrated, so the speaker is the narrator.
    expect(cli.speaker(given, action, blueprint)).toEqual({
      kind: "narrator",
      key: "narrator",
      label: "Narrator",
    });
  });

  it("resolves the talk-conversation role and character speaker for ask", () => {
    const given = { mode: "talk", location_id: "l1", talk_character_id: "c1", time_remaining: 20 };
    const action = { type: "ask", player_input: "who?" };
    const { cli } = ACTIONS.ask;

    expect(cli.role).toBe("talk_conversation");
    expect(cli.builder).toBe("buildTalkConversationContext");
    expect(cli.promptVars(given, action, blueprint)).toEqual({
      character_name: "Ann",
      player_input: "who?",
      target_age: 9,
    });
    expect(cli.contextInput(given, action, blueprint, []).player_input).toBe("who?");
    // A reply comes from the character being questioned.
    expect(cli.speaker(given, action, blueprint)).toEqual({
      kind: "character",
      key: "character:ann",
      label: "Ann",
    });
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
