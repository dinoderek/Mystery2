export const validBlueprintV2 = {
  schema_version: "v2",
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "The Missing Cookies",
    one_liner: "Someone took the cookies before snack time.",
    target_age: 8,
    time_budget: 12,
    art_style: "storybook illustration, warm kitchen lighting",
  },
  narrative: {
    premise: "The cookie plate is empty and snack time is almost here.",
    starting_knowledge: {
      mystery_summary: "The cookies disappeared from the kitchen sometime around 10 AM, according to whoever set them out.",
      locations: [
        { location_id: "kitchen", summary: "Where the cookies were set out for snack time." },
        { location_id: "hallway", summary: "A narrow passage connecting the rooms." },
      ],
      characters: [
        { character_id: "alice", summary: "Helped bake the snacks; was in the kitchen when they vanished." },
        { character_id: "bob", summary: "Waiting for snack time; was watching from the hallway." },
      ],
    },
  },
  world: {
    starting_location_id: "kitchen",
    locations: [
      {
        id: "kitchen",
        name: "Kitchen",
        description: "A bright kitchen with crumbs on the counter.",
        clues: [
          {
            id: "loc-crumbs",
            text: "Cookie crumbs lead toward the hallway.",
            role: "direct_evidence",
          },
          {
            id: "loc-open-window",
            text: "The kitchen window is open even though it is cold outside.",
            role: "red_herring",
          },
        ],
      },
      {
        id: "hallway",
        name: "Hallway",
        description: "A narrow hallway with coat hooks and a small rug.",
        clues: [
          {
            id: "loc-bag",
            text: "A lunch bag near the peg rack smells faintly of cookies.",
            role: "corroboration",
          },
        ],
      },
    ],
    characters: [
      {
        id: "alice",
        first_name: "Alice",
        last_name: "Smith",
        location_id: "kitchen",
        sex: "female",
        appearance: "Red hair and a floury apron.",
        background: "Alice helped bake the snacks.",
        personality: "Nervous but kind.",
        initial_attitude_towards_investigator: "Guarded but polite.",
        stated_alibi: "I was washing bowls by the sink.",
        motive: "She was hungry after skipping breakfast.",
        is_culprit: true,
        clues: [
          {
            id: "char-alice-bag",
            text: "Alice says she kept going back to the hallway for her lunch bag.",
            role: "supporting_evidence",
          },
        ],
        flavor_knowledge: ["Alice thinks Bob tells boring jokes."],
        actual_actions: [
          {
            sequence: 1,
            summary: "Alice helps finish setting out the snacks in the kitchen.",
          },
          {
            sequence: 2,
            summary: "Alice pockets the cookies and hides them in her lunch bag in the hallway.",
          },
        ],
      },
      {
        id: "bob",
        first_name: "Bob",
        last_name: "Jones",
        location_id: "hallway",
        sex: "male",
        appearance: "Short with glasses and a tidy sweater.",
        background: "Bob is waiting for snack time and watching everyone carefully.",
        personality: "Observant and slightly smug.",
        initial_attitude_towards_investigator: "Happy to gossip if asked nicely.",
        stated_alibi: "I was in the hallway the whole time.",
        motive: null,
        is_culprit: false,
        clues: [
          {
            id: "char-bob-saw-bag",
            text: "Bob saw Alice carrying her lunch bag before snack time.",
            role: "suspect_elimination",
          },
        ],
        flavor_knowledge: ["Bob is proud of arranging the hallway coat hooks by color."],
        actual_actions: [
          {
            sequence: 1,
            summary: "Bob waits in the hallway and watches people move between rooms.",
          },
        ],
      },
    ],
  },
  cover_image: {
    description: "A bright kitchen scene with an empty cookie plate on the counter, crumbs trailing toward the hallway. A girl in a floury apron stands nervously by the sink while a boy with glasses peers in from the hall with a knowing smirk.",
    location_ids: ["kitchen"],
    character_ids: ["alice", "bob"],
  },
  ground_truth: {
    what_happened: "Alice took the cookies from the kitchen and hid them in her lunch bag in the hallway.",
    why_it_happened: "She was hungry after skipping breakfast and could not resist them.",
    timeline: [
      "10:00 AM - The cookies are placed on the counter in the kitchen.",
      "10:05 AM - Alice pockets the cookies and hides them in her lunch bag in the hallway.",
      "10:10 AM - Bob notices Alice carrying the lunch bag.",
    ],
  },
  solution_paths: [
    {
      id: "solution-alice-cookie-bag",
      summary: "The cookie trail and lunch bag evidence point to Alice.",
      description: "The crumbs, the lunch bag smell, and Bob's observation all align with Alice taking the cookies.",
      location_clue_ids: ["loc-crumbs", "loc-bag"],
      character_clue_ids: ["char-alice-bag", "char-bob-saw-bag"],
    },
  ],
  red_herrings: [
    {
      id: "red-herring-open-window",
      summary: "The open window initially suggests an outside thief.",
      description: "The window is suspicious but unsupported once the lunch bag trail is uncovered.",
      location_clue_ids: ["loc-open-window"],
      character_clue_ids: [],
    },
  ],
  suspect_elimination_paths: [
    {
      id: "eliminate-bob",
      summary: "Bob can be ruled out because he only observed Alice and did not handle the cookies.",
      description: "Bob's hallway observation supports his innocence rather than his guilt.",
      location_clue_ids: ["loc-bag"],
      character_clue_ids: ["char-bob-saw-bag"],
    },
  ],
} as const;
