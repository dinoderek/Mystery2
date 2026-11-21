import { describe, expect, it } from "vitest";
import {
  assertRoleContextSafety,
  buildAccusationJudgeContext,
  buildAccusationStartContext,
  buildMoveContext,
  buildSearchContext,
  buildTalkConversationContext,
  type BlueprintContext,
  type ConversationFragment,
  selectCharacterConversationHistory,
  selectLocationConversationHistory,
  type SessionSnapshot,
} from "../../../packages/game-engine/src/ai-context.ts";

const blueprint: BlueprintContext = {
  metadata: {
    title: "Case",
    one_liner: "One line",
    target_age: 9,
    time_budget: 10,
  },
  narrative: {
    premise: "Someone stole the pie.",
    starting_knowledge: {
      mystery_summary: "Someone stole the pie from the kitchen around noon.",
      locations: [
        { location_id: "loc-kitchen", summary: "Where the pie was last seen." },
        { location_id: "loc-garden", summary: "A quiet outdoor space." },
      ],
      characters: [
        { character_id: "char-alice", summary: "The baker; was in the kitchen." },
        { character_id: "char-bob", summary: "A guest; was out in the garden." },
      ],
    },
  },
  world: {
    starting_location_id: "loc-kitchen",
    locations: [
      {
        id: "loc-kitchen",
        name: "Kitchen",
        description: "A messy kitchen",
        clues: [
          { id: "clue-crumbs", text: "crumbs" },
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
          { id: "clue-alice-bob", text: "Bob was in the garden.", about_character_id: "char-bob" },
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
          { id: "clue-bob-alice", text: "Alice looked worried.", about_character_id: "char-alice" },
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

const session: SessionSnapshot = {
  mode: "talk",
  current_location_id: "loc-kitchen",
  current_talk_character_id: "char-alice",
  time_remaining: 8,
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
      public_summary: "The baker; was in the kitchen.",
    });
    // Other characters expose only public knowledge — private authored fields
    // (background, alibi, motive, clues, ...) stay out of the shared roster.
    const bobSummary = talkContext.talk_context?.characters.find(
      (character) => character.id === "char-bob",
    );
    expect(bobSummary).toMatchObject({
      public_summary: "A guest; was out in the garden.",
    });
    expect(bobSummary).not.toHaveProperty("background");
    expect(bobSummary).not.toHaveProperty("stated_alibi");
    expect(bobSummary).not.toHaveProperty("motive");
    expect(bobSummary).not.toHaveProperty("clues");
    expect(talkContext.talk_context?.active_character).toMatchObject({
      id: "char-alice",
      first_name: "Alice",
      sex: "female",
      background: "the baker",
      public_summary: "The baker; was in the kitchen.",
      personality: "nervous",
      stated_alibi: "I was reading",
      clues: [{ id: "clue-alice-bob", text: "Bob was in the garden.", about_character_id: "char-bob" }],
      flavor_knowledge: ["Alice loves baking."],
      actual_actions: [{ sequence: 1, summary: "stole the pie" }],
    });
  });

  it("builds search context with structured clue progression", () => {
    const history: ConversationFragment[] = [
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
      clues: [{ id: "clue-crumbs", text: "crumbs" }],
      revealed_clue_ids: ["clue-crumbs"],
      next_clue: null,
    });
    expect(searchContext.search_context).not.toHaveProperty("has_more_clues");
    expect(searchContext.conversation_history[0]?.payload).toMatchObject({
      revealed_clue_text: "crumbs",
    });
  });

  it("hides a sub-location whose clues are all locked until it is unlocked", () => {
    const gatedBlueprint: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        locations: [
          {
            ...blueprint.world.locations[0],
            sub_locations: [
              {
                id: "sub-drawer",
                name: "the drawer",
                hint: "look in the drawer",
                clues: [
                  {
                    id: "clue-locked",
                    text: "a hidden note",
                    requires: { kind: "pointer", clue_ids: ["clue-crumbs"], rationale: "found only after the crumbs" },
                  },
                ],
              },
            ],
          },
          blueprint.world.locations[1],
        ],
      },
    };

    const locked = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: [],
      discovered_clue_ids: [],
      next_clue: null,
    });
    // Neither the spot nor its clue reaches the narrator, so it cannot be advertised.
    expect(locked.search_context?.sub_locations).toEqual([]);
    expect(JSON.stringify(locked.search_context)).not.toContain("a hidden note");

    // A targeted search that names the spot is shown it, clue included.
    const admitted = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: [],
      discovered_clue_ids: [],
      next_clue: null,
      search_query: "open the drawer",
    });
    expect(admitted.search_context?.sub_locations.map((sl) => sl.id)).toEqual(["sub-drawer"]);
    expect(admitted.search_context?.sub_locations[0]?.unrevealed_clues.map((c) => c.id)).toEqual(["clue-locked"]);
    // Its gate is not sent: the engine has decided, and its reason reads as "withhold".
    expect(JSON.stringify(admitted.search_context)).not.toContain("requires");

    // One that names something else is not.
    const missed = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: [],
      discovered_clue_ids: [],
      next_clue: null,
      search_query: "under the rug",
    });
    expect(missed.search_context?.sub_locations).toEqual([]);

    const unlocked = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: [],
      discovered_clue_ids: ["clue-crumbs"],
      next_clue: null,
    });
    // An unlocked clue reaches search without its gate, which is met.
    expect(unlocked.search_context?.sub_locations[0]?.unrevealed_clues).toEqual([
      { id: "clue-locked", text: "a hidden note" },
    ]);
  });

  it("sends a met location-level gate to search without its requires, as the next clue too", () => {
    const note = {
      id: "clue-note",
      text: "a note under the kettle",
      requires: { kind: "pointer" as const, clue_ids: ["clue-crumbs"], rationale: "found only after the crumbs" },
    };
    const gatedBlueprint: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        locations: [
          { ...blueprint.world.locations[0], clues: [...blueprint.world.locations[0].clues, note] },
          blueprint.world.locations[1],
        ],
      },
    };

    const bare = buildSearchContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      location_id: "loc-kitchen",
      revealed_clue_ids: ["clue-crumbs"],
      discovered_clue_ids: ["clue-crumbs"],
      next_clue: note,
    });
    expect(bare.search_context?.next_clue).toEqual({ id: "clue-note", text: "a note under the kettle" });
    expect(bare.search_context?.clues.map((c) => c.id)).toContain("clue-note");
    expect(JSON.stringify(bare.search_context)).not.toContain("requires");
  });

  it("tells the talk narrator whether the player can use a clue's prerequisites, never that it is earned", () => {
    const gatedBlueprint: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        characters: [
          {
            ...blueprint.world.characters[0],
            clues: [
              {
                id: "clue-alice-secret",
                text: "I took it.",
                requires: { kind: "leverage", clue_ids: ["clue-crumbs"], rationale: "she only confesses once shown the crumbs" },
              },
            ],
          },
          blueprint.world.characters[1],
        ],
      },
    };

    const before = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      character_id: "char-alice",
      player_input: "Did you take it?",
      location_id: "loc-kitchen",
      conversation_history: [],
    });
    expect(before.talk_context?.active_character.clues[0]).toMatchObject({
      id: "clue-alice-secret",
      player_can_use_prerequisites: false,
      requires_rationale: "she only confesses once shown the crumbs",
      requires_kind: "leverage",
    });
    // Possession is never presented as permission.
    expect(before.talk_context?.active_character.clues[0]).not.toHaveProperty("prereqs_met");

    const after = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint: gatedBlueprint,
      character_id: "char-alice",
      player_input: "Did you take it?",
      location_id: "loc-kitchen",
      conversation_history: [
        {
          sequence: 1,
          event_type: "search",
          actor: "system",
          narration: "crumbs",
          payload: { location_id: "loc-kitchen", revealed_clue_ids: ["clue-crumbs"] },
        },
      ],
    });
    expect(after.talk_context?.active_character.clues[0]?.player_can_use_prerequisites).toBe(true);
  });

  it("leaves the able-to-use flag null on an ungated clue", () => {
    const context = buildTalkConversationContext({
      game_id: "game-1",
      session,
      blueprint,
      character_id: "char-alice",
      player_input: "Hello",
      location_id: "loc-kitchen",
      conversation_history: [],
    });
    expect(context.talk_context?.active_character.clues[0]).toMatchObject({
      requires_rationale: null,
      requires_kind: null,
      player_can_use_prerequisites: null,
    });
  });

  it("carries each self-protect part's clues and what they show, but no reaction or confession until earned", () => {
    const agenda = {
      type: "self_protect",
      strategy: "keep the nap story",
      priority: "high",
      details: "calm and folksy",
      parts: [
        { clue_ids: ["clue-crumbs"], shows: "someone ate pie here", reaction: "admits a nibble, keeps the reading" },
      ],
      confession: "I took the whole pie.",
    };
    const withAgenda: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        characters: [{ ...blueprint.world.characters[0], agendas: [agenda] }, blueprint.world.characters[1]],
      },
    };
    const build = (conversation_history: ConversationFragment[]) =>
      buildTalkConversationContext({
        game_id: "game-1",
        session,
        blueprint: withAgenda,
        character_id: "char-alice",
        player_input: "These crumbs are pie crumbs.",
        location_id: "loc-kitchen",
        conversation_history,
      }).talk_context?.active_character;

    const before = build([]);
    expect(before?.agendas).toEqual([{
      type: "self_protect",
      strategy: "keep the nap story",
      priority: "high",
      details: "calm and folksy",
      parts: [{ clue_ids: ["clue-crumbs"], shows: "someone ate pie here", earned: false }],
      confession: null,
    }]);
    expect(JSON.stringify(before)).not.toContain("admits a nibble");
    expect(before?.gate_clues).toEqual([{ id: "clue-crumbs", held: false }]);

    const after = build([
      { sequence: 1, event_type: "talk", actor: "system", narration: "", payload: { character_id: "char-alice" } },
      {
        sequence: 2,
        event_type: "ask",
        actor: "system",
        narration: "",
        payload: { character_id: "char-alice", used_clue_ids: ["clue-crumbs"], used_quote: "pie crumbs" },
      },
    ]);
    expect(after?.agendas[0]).toMatchObject({
      parts: [{ clue_ids: ["clue-crumbs"], earned: true }],
      confession: "I took the whole pie.",
    });
    expect(after?.state.current_story).toEqual([
      blueprint.world.characters[0].stated_alibi,
      "admits a nibble, keeps the reading",
    ].filter(Boolean));
  });

  it("marks character clues the player already discovered as known_to_player", () => {
    const clueId = blueprint.world.characters[0].clues[0].id;
    const build = (conversation_history: ConversationFragment[]) =>
      buildTalkConversationContext({
        game_id: "game-1",
        session,
        blueprint,
        character_id: "char-alice",
        player_input: "Where exactly?",
        location_id: "loc-kitchen",
        conversation_history,
      }).talk_context?.active_character.clues[0];

    expect(build([])).toMatchObject({ id: clueId, known_to_player: false });
    expect(
      build([
        {
          sequence: 1,
          event_type: "ask",
          actor: "system",
          narration: "told",
          payload: { character_id: "char-alice", revealed_clue_ids: [clueId] },
        },
      ]),
    ).toMatchObject({ id: clueId, known_to_player: true });
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
      destination_id: "loc-kitchen",
      has_visited_before: true,
      conversation_history: history,
    });

    expect(moveContext.role_name).toBe("ambience");
    expect(moveContext.shared_mystery_context).toEqual({ target_age: 9 });
    expect(moveContext.move_context).toEqual({
      destination_id: "loc-kitchen",
      destination_name: "Kitchen",
      destination_description: "A messy kitchen",
      has_visited_before: true,
      last_arrival_narration: "Moved to Kitchen.",
      destination_characters: [
        {
          id: "char-alice",
          first_name: "Alice",
          last_name: "Smith",
          sex: "female",
          appearance: "red hair",
          personality: "nervous",
          initial_attitude_towards_investigator: "wary",
          manner: [],
          tells: [],
        },
      ],
    });
    expect(moveContext.conversation_history.map((event) => event.sequence)).toEqual([
      1,
      2,
    ]);
  });

  it("gives arrival nothing a character knows, did or claims, and nothing about absent characters", () => {
    const history: ConversationFragment[] = [
      {
        sequence: 1,
        event_type: "ask",
        actor: "char-bob",
        narration: "Bob told you.",
        payload: { character_id: "char-bob", revealed_clue_ids: ["clue-bob-alice"] },
      },
    ];
    const arrival = buildMoveContext({
      game_id: "game-1",
      session: { ...session, mode: "explore", current_talk_character_id: null },
      blueprint,
      destination_id: "loc-kitchen",
      has_visited_before: false,
      conversation_history: history,
    });

    const serialized = JSON.stringify(arrival.move_context);
    const alice = blueprint.world.characters.find((c) => c.id === "char-alice")!;
    for (const secret of [
      alice.clues[0].text,
      alice.motive!,
      alice.stated_alibi!,
      alice.background,
      alice.flavor_knowledge[0],
      alice.actual_actions[0].summary,
    ]) {
      expect(serialized).not.toContain(secret);
    }
    // Bob is in the garden: nothing of his reaches the kitchen.
    expect(serialized).not.toContain("watering flowers");
    expect(serialized).not.toContain("Bob is visiting for the weekend.");
    expect(arrival.move_context?.last_arrival_narration).toBeNull();
  });

  it("turns live agendas into manner, in priority order, and keeps only always tells", () => {
    const withAims: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        characters: blueprint.world.characters.map((c) =>
          c.id !== "char-alice" ? c : {
            ...c,
            agendas: [
              { type: "conditional_reveal", strategy: "admits the secret", priority: "low", details: "SECRET-DETAILS", gated_clue_id: "clue-alice-bob" },
              { type: "implicate_other", strategy: "blame Bob", priority: "medium", details: "SECRET-BLAME", target_character_id: "char-bob" },
              {
                type: "self_protect", strategy: "false alibi", priority: "high", details: "SECRET-COVER",
                parts: [{ clue_ids: ["clue-pie"], shows: "SECRET-SHOWS", reaction: "SECRET-REACTION" }],
                confession: "SECRET-CONFESSION",
              },
            ],
            tells: [
              { id: "t1", text: "She hums softly.", trigger: { kind: "always" } },
              { id: "t2", text: "SECRET-CONDITION-TELL", trigger: { kind: "condition", condition: "asked about pie" } },
              { id: "t3", text: "SECRET-CLUE-TELL", trigger: { kind: "clue", clue_ids: ["clue-pie"] } },
            ],
          }
        ),
      },
    };
    const arrive = (conversation_history: ConversationFragment[]) =>
      buildMoveContext({
        game_id: "game-1",
        session: { ...session, mode: "explore", current_talk_character_id: null },
        blueprint: withAims,
        destination_id: "loc-kitchen",
        has_visited_before: false,
        conversation_history,
      }).move_context!;

    const first = arrive([]);
    expect(first.destination_characters[0]).toMatchObject({
      manner: ["keeps attention away from herself", "would rather the investigator looked at Bob", "holding something back"],
      tells: ["She hums softly."],
    });
    expect(JSON.stringify(first)).not.toContain("SECRET");

    // The reveal's clue has been given: that agenda no longer shapes her.
    const afterReveal = arrive([
      {
        sequence: 1,
        event_type: "ask",
        actor: "char-alice",
        narration: "told",
        payload: { character_id: "char-alice", revealed_clue_ids: ["clue-alice-bob"] },
      },
    ]);
    expect(afterReveal.destination_characters[0].manner).toEqual([
      "keeps attention away from herself",
      "would rather the investigator looked at Bob",
    ]);
  });

  it("leaves an arrival with nobody present without characters", () => {
    const withEmptyRoom: BlueprintContext = {
      ...blueprint,
      world: {
        ...blueprint.world,
        locations: [
          ...blueprint.world.locations,
          { id: "loc-attic", name: "Attic", description: "A dusty attic", clues: [] },
        ],
      },
    };
    const arrival = buildMoveContext({
      game_id: "game-1",
      session: { ...session, mode: "explore", current_talk_character_id: null },
      blueprint: withEmptyRoom,
      destination_id: "loc-attic",
      has_visited_before: false,
      conversation_history: [],
    });

    expect(arrival.move_context).toEqual({
      destination_id: "loc-attic",
      destination_name: "Attic",
      destination_description: "A dusty attic",
      has_visited_before: false,
      last_arrival_narration: null,
      destination_characters: [],
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
      current_location_id: "loc-kitchen",
      current_location_name: "Kitchen",
      current_location_description: "A messy kitchen",
    });
    // The public roster is provided so the narrator can name suspects and use
    // grounded pronouns — spoiler-safe fields only.
    expect(startContext.accusation_start_context?.characters).toEqual([
      expect.objectContaining({ id: "char-alice", first_name: "Alice", sex: "female" }),
      expect.objectContaining({ id: "char-bob", first_name: "Bob", sex: "male" }),
    ]);
    expect(startContext.accusation_start_context?.characters[0]).not.toHaveProperty(
      "is_culprit",
    );
    expect(startContext.accusation_start_context?.characters[0]).not.toHaveProperty(
      "motive",
    );
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

    // With no history the player has earned nothing, even though the blueprint
    // handed to the judge contains every clue in the mystery.
    expect(judgeContext.accusation_judge_context?.player_known_clues).toEqual([]);
    expect(judgeContext.accusation_judge_context?.path_coverage).toEqual([
      {
        path_id: "path-solution",
        kind: "solution",
        summary: "Crumbs and Alice's motive",
        found_clue_ids: [],
        missing_clue_ids: ["clue-crumbs", "clue-bob-alice"],
      },
      {
        path_id: "path-bob-clear",
        kind: "eliminate",
        summary: "Bob was in the garden",
        found_clue_ids: [],
        missing_clue_ids: ["clue-alice-bob"],
      },
    ]);
  });

  it("gives accusation_judge the clues the investigator actually discovered", () => {
    const history: ConversationFragment[] = [
      {
        sequence: 1,
        event_type: "search",
        actor: "narrator",
        narration: "Crumbs on the floor.",
        payload: { revealed_clue_ids: ["clue-crumbs"] },
      },
      {
        sequence: 2,
        event_type: "ask",
        actor: "char-bob",
        narration: "Alice looked worried.",
        payload: { revealed_clue_ids: ["clue-bob-alice"] },
      },
    ];

    const judgeContext = buildAccusationJudgeContext({
      game_id: "game-1",
      session: { ...session, mode: "accuse" },
      blueprint,
      player_input: "Alice stole the pie.",
      round: 1,
      conversation_history: history,
    });

    // Discovery order, annotated with provenance so the judge can narrate the
    // player's own case back to them.
    expect(judgeContext.accusation_judge_context?.player_known_clues).toEqual([
      { id: "clue-crumbs", text: "crumbs", origin_label: "found at Kitchen" },
      {
        id: "clue-bob-alice",
        text: "Alice looked worried.",
        origin_label: "told by Bob Jones",
      },
    ]);

    // The solution path is fully covered; the elimination path is untouched.
    expect(judgeContext.accusation_judge_context?.path_coverage).toEqual([
      {
        path_id: "path-solution",
        kind: "solution",
        summary: "Crumbs and Alice's motive",
        found_clue_ids: ["clue-crumbs", "clue-bob-alice"],
        missing_clue_ids: [],
      },
      {
        path_id: "path-bob-clear",
        kind: "eliminate",
        summary: "Bob was in the garden",
        found_clue_ids: [],
        missing_clue_ids: ["clue-alice-bob"],
      },
    ]);
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
          player_known_clues: [],
          path_coverage: [],
        },
      }),
    ).toThrow("not allowed");
  });
});
