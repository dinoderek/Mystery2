import { describe, expect, it } from "vitest";
import {
  assertRoleContextSafety,
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildMoveContext,
  buildSearchContext,
  buildTalkConversationContext,
  type BlueprintContext,
  selectCharacterConversationHistory,
  selectLocationConversationHistory,
} from "../../../supabase/functions/_shared/ai-context.ts";

const blueprint: BlueprintContext = {
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
    starting_location_id: "loc-kitchen",
    locations: [
      {
        id: "loc-kitchen",
        name: "Kitchen",
        description: "A messy kitchen",
        clues: [
          { id: "clue-crumbs", text: "crumbs", role: "direct_evidence" },
        ],
      },
      {
        id: "loc-garden",
        name: "Garden",
        description: "A quiet garden",
        clues: [],
      },
    ],
    characters: [
      {
        id: "char-alice",
        first_name: "Alice",
        last_name: "Smith",
        location_id: "loc-kitchen",
        sex: "female",
        appearance: "red hair",
        background: "the baker",
        personality: "nervous",
        initial_attitude_towards_investigator: "wary",
        stated_alibi: "I was reading",
        motive: "hungry",
        is_culprit: true,
        clues: [
          { id: "clue-alice-bob", text: "Bob was in the garden.", role: "suspect_elimination" },
        ],
        flavor_knowledge: ["Alice loves baking."],
        actual_actions: [
          { sequence: 1, summary: "stole the pie" },
        ],
      },
      {
        id: "char-bob",
        first_name: "Bob",
        last_name: "Jones",
        location_id: "loc-garden",
        sex: "male",
        appearance: "glasses",
        background: "the guest",
        personality: "calm",
        initial_attitude_towards_investigator: "helpful",
        stated_alibi: "I was outside",
        motive: null,
        is_culprit: false,
        clues: [
          { id: "clue-bob-alice", text: "Alice looked worried.", role: "supporting_evidence" },
        ],
        flavor_knowledge: ["Bob is visiting for the weekend."],
        actual_actions: [
          { sequence: 1, summary: "watering flowers" },
        ],
      },
    ],
  },
  ground_truth: {
    what_happened: "Alice stole the pie",
    why_it_happened: "She was hungry",
    timeline: ["12:00 Alice enters kitchen", "12:05 Alice takes pie"],
  },
  solution_paths: [
    {
      id: "path-solution",
      summary: "Crumbs and Alice's motive",
      location_clue_ids: ["clue-crumbs"],
      character_clue_ids: ["clue-bob-alice"],
    },
  ],
  red_herrings: [],
  suspect_elimination_paths: [
    {
      id: "path-bob-clear",
      summary: "Bob was in the garden",
      location_clue_ids: [],
      character_clue_ids: ["clue-alice-bob"],
    },
  ],
};

const session = {
  mode: "talk" as const,
  current_location_id: "loc-kitchen",
  current_talk_character_id: "char-alice",
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
        narration: "Moved to Garden.",
        payload: { destination: "loc-garden", location_id: "loc-garden", location_name: "Garden" },
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
    const history = [
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
        payload: { character_id: "char-bob", character_name: "Bob", location_id: "loc-garden" },
      },
    ];

    const talkHistory = selectCharacterConversationHistory(history, "char-alice");
    expect(talkHistory.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(talkHistory[1]?.payload).toMatchObject({
      player_input: "Where were you?",
    });

    const talkContext = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint,
      character_id: "char-alice",
      player_input: "Where were you?",
      location_id: "loc-kitchen",
      conversation_history: history,
    });

    expect(talkContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(talkContext.talk_context?.locations).toEqual([
      { id: "loc-kitchen", name: "Kitchen", description: "A messy kitchen" },
      { id: "loc-garden", name: "Garden", description: "A quiet garden" },
    ]);
    expect(talkContext.talk_context?.characters[0]).toMatchObject({
      id: "char-alice",
      first_name: "Alice",
      last_name: "Smith",
      location_id: "loc-kitchen",
      sex: "female",
      appearance: "red hair",
      background: "the baker",
    });
    expect(talkContext.talk_context?.active_character).toMatchObject({
      id: "char-alice",
      first_name: "Alice",
      sex: "female",
      personality: "nervous",
      stated_alibi: "I was reading",
      clues: [{ id: "clue-alice-bob", text: "Bob was in the garden.", role: "suspect_elimination" }],
      flavor_knowledge: ["Alice loves baking."],
      actual_actions: [{ sequence: 1, summary: "stole the pie" }],
    });
  });

  it("builds search context with structured clue progression", () => {
    const history = [
      {
        sequence: 1,
        event_type: "search",
        actor: "system",
        narration: "Kitchen search",
        payload: {
          location_id: "loc-kitchen",
          location_name: "Kitchen",
          revealed_clue_id: "clue-crumbs",
          revealed_clue_text: "crumbs",
          revealed_clue_ids: ["clue-crumbs"],
        },
      },
    ];

    const searchContext = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: ["clue-crumbs"],
      next_clue: null,
      conversation_history: history,
    });

    expect(searchContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(searchContext.search_context).toMatchObject({
      location_id: "loc-kitchen",
      location_name: "Kitchen",
      location_description: "A messy kitchen",
      clues: [{ id: "clue-crumbs", text: "crumbs", role: "direct_evidence" }],
      revealed_clue_ids: ["clue-crumbs"],
      next_clue: null,
      has_more_clues: false,
    });
    expect(searchContext.conversation_history[0]?.payload).toMatchObject({
      revealed_clue_text: "crumbs",
    });
  });

  it("builds move context with public summaries for destination characters", () => {
    const history = [
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
      destination_id: "loc-kitchen",
      has_visited_before: true,
      conversation_history: history,
    });

    expect(moveContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(moveContext.move_context).toMatchObject({
      destination_id: "loc-kitchen",
      destination_name: "Kitchen",
      destination_description: "A messy kitchen",
      has_visited_before: true,
      destination_characters: [
        {
          id: "char-alice",
          first_name: "Alice",
          last_name: "Smith",
          location_id: "loc-kitchen",
          sex: "female",
          appearance: "red hair",
          background: "the baker",
        },
      ],
    });
    expect(moveContext.conversation_history.map((event) => event.sequence)).toEqual([
      1,
      2,
    ]);
  });

  it("keeps accusation_start spoiler-safe and gives accusation_judge the full blueprint", () => {
    const startContext = buildAccusationStartContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      conversation_history: [],
    });
    expect(startContext.accusation_start_context).toMatchObject({
      current_location_id: "loc-kitchen",
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
    expect(judgeContext.accusation_judge_context?.full_blueprint.solution_paths).toHaveLength(1);
    expect(judgeContext.accusation_judge_context?.full_blueprint.suspect_elimination_paths).toHaveLength(1);
  });

  it("throws when non-judge role receives accusation_judge_context", () => {
    expect(() =>
      assertRoleContextSafety("search", {
        game_id: "game-1",
        role_name: "search",
        mode: "explore",
        forced_by_timeout: false,
        location_id: "loc-kitchen",
        character_id: null,
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
