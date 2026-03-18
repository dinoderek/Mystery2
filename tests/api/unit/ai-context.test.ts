import { describe, expect, it } from "vitest";
import {
  assertRoleContextSafety,
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildSearchContext,
  buildTalkConversationContext,
  selectCharacterConversationHistory,
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
      {
        first_name: "Alice",
        last_name: "Smith",
        location: "Kitchen",
        appearance: "red hair",
        background: "the baker",
        personality: "nervous",
        initial_attitude_towards_investigator: "wary",
        mystery_action_real: "stole the pie",
        stated_alibi: "I was reading",
        motive: "hungry",
        knowledge: ["Bob was in the garden."],
        is_culprit: true,
      },
      {
        first_name: "Bob",
        last_name: "Jones",
        location: "Garden",
        appearance: "glasses",
        background: "the guest",
        personality: "calm",
        initial_attitude_towards_investigator: "helpful",
        mystery_action_real: "watering flowers",
        stated_alibi: "I was outside",
        motive: null,
        knowledge: ["Alice looked worried."],
        is_culprit: false,
      },
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
  it("selects destination-relative history for move/search usage", () => {
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
        payload: { location_name: "Kitchen", revealed_clue_text: "crumbs" },
      },
      {
        sequence: 3,
        event_type: "move",
        actor: "system",
        narration: "Moved to Garden.",
        payload: { destination: "Garden", location_name: "Garden" },
      },
    ];

    const kitchenHistory = selectLocationConversationHistory(history, "Kitchen");
    expect(kitchenHistory.map((event) => event.sequence)).toEqual([1, 2]);
    expect(kitchenHistory[1]?.payload).toMatchObject({
      location_name: "Kitchen",
      revealed_clue_text: "crumbs",
    });
  });

  it("includes same-character talk history and preserves player_input", () => {
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
        payload: {
          character_name: "Alice",
          location_name: "Kitchen",
          player_input: "Where were you?",
        },
      },
      {
        sequence: 3,
        event_type: "end_talk",
        actor: "system",
        narration: "You leave Alice.",
        payload: { character_name: "Alice", location_name: "Kitchen" },
      },
      {
        sequence: 4,
        event_type: "talk",
        actor: "system",
        narration: "Bob greets you.",
        payload: { character_name: "Bob", location_name: "Garden" },
      },
    ];

    const talkHistory = selectCharacterConversationHistory(history, "Alice");
    expect(talkHistory.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(talkHistory[1]?.payload).toMatchObject({
      player_input: "Where were you?",
    });

    const talkContext = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint,
      character_name: "Alice",
      player_input: "Where were you?",
      location_name: "Kitchen",
      conversation_history: history,
    });

    expect(talkContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(talkContext.talk_context?.locations).toEqual([
      { name: "Kitchen", description: "A messy kitchen" },
      { name: "Garden", description: "A quiet garden" },
    ]);
    expect(talkContext.talk_context?.characters[0]).toMatchObject({
      first_name: "Alice",
      last_name: "Smith",
      location: "Kitchen",
      appearance: "red hair",
      background: "the baker",
    });
    expect(talkContext.talk_context?.active_character).toMatchObject({
      first_name: "Alice",
      personality: "nervous",
      stated_alibi: "I was reading",
      mystery_action_real: "stole the pie",
    });
  });

  it("builds search context with canonical clue progression", () => {
    const history = [
      {
        sequence: 1,
        event_type: "search",
        actor: "system",
        narration: "Kitchen search",
        payload: {
          location_name: "Kitchen",
          revealed_clue_text: "crumbs",
          revealed_clues: ["crumbs"],
        },
      },
    ];

    const searchContext = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint,
      location_name: "Kitchen",
      revealed_clues: ["crumbs"],
      next_clue: null,
      conversation_history: history,
    });

    expect(searchContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(searchContext.search_context).toMatchObject({
      location_name: "Kitchen",
      location_description: "A messy kitchen",
      clues: ["crumbs"],
      revealed_clues: ["crumbs"],
      next_clue: null,
      has_more_clues: false,
    });
    expect(searchContext.conversation_history[0]?.payload).toMatchObject({
      revealed_clue_text: "crumbs",
    });
  });

  it("keeps accusation_start spoiler-safe and gives accusation_judge the full blueprint", () => {
    const startContext = buildAccusationStartContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      conversation_history: [],
    });
    expect(startContext.accusation_start_context).toMatchObject({
      current_location_name: "Kitchen",
      current_location_description: "A messy kitchen",
    });
    expect(startContext.accusation_judge_context).toBeNull();

    const judgeContext = buildAccusationJudgeContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      player_input: "Alice stole the pie.",
      round: 1,
      conversation_history: [],
    });

    expect(judgeContext.accusation_judge_context).toMatchObject({
      round: 1,
      full_blueprint: blueprint,
    });
  });

  it("throws when non-judge role receives accusation_judge_context", () => {
    expect(() =>
      assertRoleContextSafety("search", {
        game_id: "game-1",
        role_name: "search",
        mode: "explore",
        forced_by_timeout: false,
        location_name: "Kitchen",
        character_name: null,
        player_input: null,
        conversation_history: [],
        shared_mystery_context: { target_age: 9 },
        move_context: null,
        search_context: null,
        talk_context: null,
        accusation_start_context: null,
        accusation_judge_context: {
          round: 1,
          full_blueprint: blueprint,
        },
      }),
    ).toThrow("not allowed");
  });
});
