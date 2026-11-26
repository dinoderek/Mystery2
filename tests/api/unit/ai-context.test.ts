import { describe, expect, it } from "vitest";
import {
  type AIContext,
  assertRoleContextSafety,
  buildAccusationStartContext,
  buildMoveContext,
  buildTalkEndContext,
  type BlueprintContext,
  type ConversationFragment,
  selectCharacterConversationHistory,
  selectLocationConversationHistory,
  type SessionSnapshot,
} from "../../../packages/game-engine/src/ai-context.ts";
import { readMockCase } from "../../testkit/src/mock-case.ts";

// The mock case: Alice (the culprit) in the kitchen, Bob in the living room.
const blueprint: BlueprintContext = readMockCase();
const alice = blueprint.world.characters.find((c) => c.id === "char-alice")!;
const bob = blueprint.world.characters.find((c) => c.id === "char-bob")!;

const session: SessionSnapshot = {
  mode: "talk",
  current_location_id: "loc-kitchen",
  current_talk_character_id: "char-alice",
  time_remaining: 8,
};

/** Greeting Alice: her first words, and the tell that rides on them, each with its notebook line. */
const greeting: ConversationFragment = {
  sequence: 2,
  event_type: "talk",
  actor: "system",
  narration: "Alice greets you.",
  payload: {
    character_id: "char-alice",
    character_name: "Alice",
    location_id: "loc-kitchen",
    revealed_clue_ids: ["alice_blames_bob", "alice_flour"],
    clue_graph: {
      type: "talk",
      character: "char-alice",
      notebook: { alice_blames_bob: "Alice says Bob crept in at noon.", alice_flour: "Alice hides her floury hands." },
    },
  },
};

describe("ai-context guardrails", () => {
  it("selects destination-relative history for move/search usage", () => {
    const history: ConversationFragment[] = [
      {
        sequence: 1,
        event_type: "move",
        actor: "system",
        narration: "Moved to Kitchen.",
        payload: { destination: "loc-kitchen", location_id: "loc-kitchen", location_name: "Kitchen" },
      },
      {
        sequence: 2,
        event_type: "search",
        actor: "system",
        narration: "Searched Kitchen.",
        payload: { location_id: "loc-kitchen", location_name: "Kitchen", revealed_clue_text: "crumbs" },
      },
      {
        sequence: 3,
        event_type: "move",
        actor: "system",
        narration: "Moved to the living room.",
        payload: { destination: "loc-living-room", location_id: "loc-living-room", location_name: "Living Room" },
      },
    ];

    const kitchenHistory = selectLocationConversationHistory(history, "loc-kitchen");
    expect(kitchenHistory.map((event) => event.sequence)).toEqual([1, 2]);
    expect(kitchenHistory[1]?.payload).toMatchObject({
      location_id: "loc-kitchen",
      revealed_clue_text: "crumbs",
    });
  });

  it("includes same-character talk history and preserves player_input", () => {
    const history: ConversationFragment[] = [
      {
        sequence: 1,
        event_type: "talk",
        actor: "system",
        narration: "Alice greets you.",
        payload: { character_id: "char-alice", character_name: "Alice", location_id: "loc-kitchen" },
      },
      {
        sequence: 2,
        event_type: "ask",
        actor: "system",
        narration: "Alice answers.",
        payload: {
          character_id: "char-alice",
          character_name: "Alice",
          location_id: "loc-kitchen",
          player_input: "Where were you?",
        },
      },
      {
        sequence: 3,
        event_type: "end_talk",
        actor: "system",
        narration: "You leave Alice.",
        payload: { character_id: "char-alice", character_name: "Alice", location_id: "loc-kitchen" },
      },
      {
        sequence: 4,
        event_type: "talk",
        actor: "system",
        narration: "Bob greets you.",
        payload: { character_id: "char-bob", character_name: "Bob", location_id: "loc-living-room" },
      },
    ];

    const talkHistory = selectCharacterConversationHistory(history, "char-alice");
    expect(talkHistory.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(talkHistory[1]?.payload).toMatchObject({
      player_input: "Where were you?",
    });
  });

  it("gives a goodbye the character as they carry themselves, and only the clues of theirs found, as notebook lines", () => {
    const context = buildTalkEndContext({
      game_id: "game-1",
      session,
      blueprint,
      reading_age: 7,
      character_id: "char-alice",
      location_id: "loc-kitchen",
      conversation_history: [greeting],
    });

    expect(context.role_name).toBe("talk_end");
    expect(context.shared_mystery_context).toEqual({ reading_age: 7 });
    expect(context.conversation_history.map((event) => event.sequence)).toEqual([2]);
    expect(context.talk_context?.locations.map((location) => location.id)).toEqual(["loc-kitchen", "loc-living-room"]);
    // The roster is identity and looks only.
    expect(context.talk_context?.characters.find((c) => c.id === "char-bob")).toEqual({
      id: "char-bob",
      first_name: "Bob",
      location_id: "loc-living-room",
      sex: "male",
      appearance: bob.appearance,
    });
    expect(context.talk_context?.active_character).toEqual({
      id: "char-alice",
      first_name: "Alice",
      location_id: "loc-kitchen",
      sex: "female",
      appearance: alice.appearance,
      personality: alice.personality,
      initial_attitude_towards_investigator: alice.initial_attitude_towards_investigator,
      clues: [
        { id: "alice_blames_bob", text: "Alice says Bob crept in at noon." },
        { id: "alice_flour", text: "Alice hides her floury hands." },
      ],
      player_known_clues: [
        { id: "alice_blames_bob", text: "Alice says Bob crept in at noon." },
        { id: "alice_flour", text: "Alice hides her floury hands." },
      ],
    });
    // Nothing she holds and the player has not found reaches the goodbye.
    const serialized = JSON.stringify(context.talk_context);
    for (const clue of alice.clues.filter((c) => !["alice_blames_bob", "alice_flour"].includes(c.id))) {
      expect(serialized).not.toContain(clue.text);
    }
  });

  it("builds move context with each present character's arrival pack and the last arrival", () => {
    const history: ConversationFragment[] = [
      {
        sequence: 1,
        event_type: "move",
        actor: "system",
        narration: "Moved to Kitchen.",
        payload: { destination: "loc-kitchen", location_id: "loc-kitchen", location_name: "Kitchen" },
      },
      {
        sequence: 2,
        event_type: "search",
        actor: "system",
        narration: "Searched Kitchen.",
        payload: { location_id: "loc-kitchen", location_name: "Kitchen", revealed_clue_text: "crumbs" },
      },
    ];

    const moveContext = buildMoveContext({
      game_id: "game-1",
      session: { ...session, mode: "explore", current_talk_character_id: null },
      blueprint,
      reading_age: 7,
      destination_id: "loc-kitchen",
      has_visited_before: true,
      conversation_history: history,
    });

    const kitchen = blueprint.world.locations.find((location) => location.id === "loc-kitchen")!;
    expect(moveContext.role_name).toBe("ambience");
    expect(moveContext.shared_mystery_context).toEqual({ reading_age: 7 });
    expect(moveContext.move_context).toEqual({
      destination_id: "loc-kitchen",
      destination_name: "Kitchen",
      destination_description: kitchen.description,
      has_visited_before: true,
      last_arrival_narration: "Moved to Kitchen.",
      destination_characters: [
        {
          id: "char-alice",
          first_name: "Alice",
          sex: "female",
          appearance: alice.appearance,
          personality: alice.personality,
          initial_attitude_towards_investigator: alice.initial_attitude_towards_investigator,
        },
      ],
    });
    expect(moveContext.conversation_history.map((event) => event.sequence)).toEqual([1, 2]);
  });

  it("gives arrival nothing a character knows, and nothing about absent characters", () => {
    const arrival = buildMoveContext({
      game_id: "game-1",
      session: { ...session, mode: "explore", current_talk_character_id: null },
      blueprint,
      reading_age: 7,
      destination_id: "loc-kitchen",
      has_visited_before: false,
      conversation_history: [greeting],
    });

    const serialized = JSON.stringify(arrival.move_context);
    for (const clue of alice.clues) expect(serialized).not.toContain(clue.text);
    // Bob is in the living room: nothing of his reaches the kitchen.
    expect(serialized).not.toContain(bob.appearance);
    expect(serialized).not.toContain(bob.personality);
    expect(arrival.move_context?.last_arrival_narration).toBeNull();
  });

  it("leaves an arrival with nobody present without characters", () => {
    const empty: BlueprintContext = { ...blueprint, world: { ...blueprint.world, characters: [] } };
    const arrival = buildMoveContext({
      game_id: "game-1",
      session: { ...session, mode: "explore", current_talk_character_id: null },
      blueprint: empty,
      reading_age: 7,
      destination_id: "loc-living-room",
      has_visited_before: false,
      conversation_history: [],
    });

    expect(arrival.move_context?.destination_characters).toEqual([]);
    expect(arrival.move_context?.last_arrival_narration).toBeNull();
  });

  it("keeps accusation_start spoiler-safe", () => {
    const startContext = buildAccusationStartContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      reading_age: 7,
      conversation_history: [greeting],
    });
    expect(startContext.accusation_start_context).toMatchObject({
      current_location_id: "loc-kitchen",
      current_location_name: "Kitchen",
    });
    // The public roster is provided so the narrator can name suspects and use
    // grounded pronouns — spoiler-safe fields only.
    expect(startContext.accusation_start_context?.characters).toEqual([
      expect.objectContaining({ id: "char-alice", first_name: "Alice", sex: "female" }),
      expect.objectContaining({ id: "char-bob", first_name: "Bob", sex: "male" }),
    ]);
    for (const character of startContext.accusation_start_context?.characters ?? []) {
      expect(Object.keys(character).sort()).toEqual(["appearance", "first_name", "id", "location_id", "sex"]);
    }
    // The whole game so far, unless asked for none.
    expect(startContext.conversation_history.map((event) => event.sequence)).toEqual([2]);
    const bare = buildAccusationStartContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      reading_age: 7,
      conversation_history: [greeting],
      history_mode: "none",
    });
    expect(bare.conversation_history).toEqual([]);
  });

  it("carries no context of the retired case format", () => {
    const context = buildTalkEndContext({
      game_id: "game-1",
      session,
      blueprint,
      reading_age: 7,
      character_id: "char-alice",
      location_id: "loc-kitchen",
    });
    expect(context).not.toHaveProperty("search_context");
    expect(context).not.toHaveProperty("accusation_judge_context");
  });

  it("tells only the closing scene the ending", () => {
    const context = (role: AIContext["role_name"]): AIContext => ({
      game_id: "game-1",
      role_name: role,
      mode: "accuse",
      forced_by_timeout: false,
      location_id: "loc-kitchen",
      character_id: null,
      player_input: "It was Alice.",
      conversation_history: [],
      shared_mystery_context: { reading_age: 7 },
      move_context: null,
      talk_context: null,
      accusation_start_context: null,
      graph_accusation_context: { ending: {} } as never,
    });
    expect(() => assertRoleContextSafety("graph_accusation_round", context("graph_accusation_round"))).toThrow("not allowed");
    expect(() => assertRoleContextSafety("graph_ending", context("graph_ending"))).not.toThrow();
  });
});
