import { describe, expect, it } from "vitest";
import {
  assertRoleContextSafety,
  buildAccusationJudgeContext,
  buildSearchContext,
  buildTalkConversationContext,
  selectLocationConversationHistory,
} from "../../../supabase/functions/_shared/ai-context.ts";

const blueprint = {
  metadata: {
    title: "Case",
    one_liner: "One line",
    target_age: 9,
    time_budget: 10,
  },
  narrative: {
    premise: "Someone stole the pie.",
    starting_knowledge: ["The kitchen window was open."],
  },
  world: {
    starting_location_id: "Kitchen",
    locations: [
      { name: "Kitchen", description: "A messy kitchen", clues: ["crumbs"] },
      { name: "Garden", description: "A quiet garden", clues: [] },
    ],
    characters: [
      { first_name: "Alice", last_name: "Smith", location: "Kitchen" },
      { first_name: "Bob", last_name: "Jones", location: "Garden" },
    ],
  },
  ground_truth: {
    what_happened: "Alice stole the pie",
  },
};

const session = {
  mode: "talk" as const,
  current_location_id: "Kitchen",
  current_talk_character_id: "Alice",
  time_remaining: 8,
};

describe("ai-context guardrails", () => {
  it("selects all and only destination-relative history for move/search usage", () => {
    const history = [
      {
        sequence: 1,
        event_type: "move",
        actor: "system",
        narration: "Moved to Kitchen.",
        payload: { destination: "Kitchen", location_name: "Kitchen" },
      },
      {
        sequence: 2,
        event_type: "search",
        actor: "system",
        narration: "Searched Kitchen.",
        payload: { location_name: "Kitchen" },
      },
      {
        sequence: 3,
        event_type: "move",
        actor: "system",
        narration: "Moved to Garden.",
        payload: { destination: "Garden", location_name: "Garden" },
      },
    ];

    const kitchenHistory = selectLocationConversationHistory(
      history,
      "Kitchen",
    );
    expect(kitchenHistory.map((event) => event.sequence)).toEqual([1, 2]);
    expect(kitchenHistory.every((event) => event.payload === undefined)).toBe(
      true,
    );
  });

  it("includes all and only character-relative history for talk context", () => {
    const history = [
      {
        sequence: 1,
        event_type: "talk",
        actor: "system",
        narration: "Alice greets you.",
        payload: { character_name: "Alice", location_name: "Kitchen" },
      },
      {
        sequence: 2,
        event_type: "ask",
        actor: "system",
        narration: "Alice answers.",
        payload: { character_name: "Alice", location_name: "Kitchen" },
      },
      {
        sequence: 3,
        event_type: "talk",
        actor: "system",
        narration: "Bob greets you.",
        payload: { character_name: "Bob", location_name: "Garden" },
      },
      {
        sequence: 4,
        event_type: "move",
        actor: "system",
        narration: "You move to kitchen.",
        payload: { location_name: "Kitchen" },
      },
    ];

    const talkContext = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint,
      character_name: "Alice",
      player_input: "Where were you?",
      location_name: "Kitchen",
      conversation_history: history,
    });

    expect(talkContext.ground_truth_context).toBeNull();
    expect(talkContext.shared_mystery_context.target_age).toBe(9);
    expect(talkContext.conversation_history).toHaveLength(2);
    expect(
      talkContext.conversation_history.map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("includes all and only location-relative history for search context", () => {
    const history = [
      {
        sequence: 1,
        event_type: "move",
        actor: "system",
        narration: "You move to Kitchen.",
        payload: { destination: "Kitchen", location_name: "Kitchen" },
      },
      {
        sequence: 2,
        event_type: "search",
        actor: "system",
        narration: "You search Kitchen.",
        payload: { location_name: "Kitchen" },
      },
      {
        sequence: 3,
        event_type: "move",
        actor: "system",
        narration: "You move to Garden.",
        payload: { destination: "Garden", location_name: "Garden" },
      },
    ];

    const searchContext = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint,
      location_name: "Kitchen",
      conversation_history: history,
    });

    expect(searchContext.ground_truth_context).toBeNull();
    expect(searchContext.conversation_history).toHaveLength(2);
    expect(
      searchContext.conversation_history.map((event) => event.sequence),
    ).toEqual([1, 2]);
  });

  it("supports accusation history mode all or none", () => {
    const history = [
      {
        sequence: 1,
        event_type: "search",
        actor: "system",
        narration: "Kitchen search",
      },
      {
        sequence: 2,
        event_type: "talk",
        actor: "system",
        narration: "Talk with Alice",
      },
    ];

    const accuseContextAll = buildAccusationJudgeContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      accused_character: "Alice",
      player_input: "Alice was seen in the kitchen.",
      round: 1,
      conversation_history: history,
      history_mode: "all",
    });

    const accuseContextNone = buildAccusationJudgeContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      accused_character: "Alice",
      player_input: "Alice was seen in the kitchen.",
      round: 1,
      conversation_history: history,
      history_mode: "none",
    });

    expect(accuseContextAll.conversation_history).toHaveLength(2);
    expect(accuseContextNone.conversation_history).toHaveLength(0);
  });

  it("includes ground truth only for accusation_judge context", () => {
    const accuseContext = buildAccusationJudgeContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      accused_character: "Alice",
      player_input: "Alice was seen in the kitchen.",
      round: 1,
    });

    expect(accuseContext.role_name).toBe("accusation_judge");
    expect(accuseContext.ground_truth_context).toEqual(blueprint.ground_truth);
  });

  it("throws when non-judge role receives ground truth context", () => {
    expect(() =>
      assertRoleContextSafety("search", {
        game_id: "game-1",
        role_name: "search",
        mode: "explore",
        location_name: "Kitchen",
        character_name: null,
        accused_character: null,
        player_input: null,
        conversation_history: [],
        shared_mystery_context: {
          title: "Case",
          one_liner: "One line",
          target_age: 9,
          location_names: ["Kitchen"],
          character_names: ["Alice Smith"],
          current_location_description: "A messy kitchen",
          premise: "Someone stole the pie.",
        },
        ground_truth_context: { spoiler: true },
      }),
    ).toThrow("not allowed");
  });
});
