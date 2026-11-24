import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  allRoleRequestNames,
  buildNarrationPrompt,
  buildRoleRequest,
  type RoleRequestName,
} from "../../../packages/game-engine/src/role-request.ts";
import { buildClueGraphWorld, validateClueGraph, type ClueGraphWorld } from "@my2/shared";
import { readMockCase } from "../../testkit/src/mock-case.ts";

// role-request.ts is the single assembly path for narrator prompts. These tests
// exist because an earlier arrangement had two: the endpoint handlers,
// and a parallel implementation in the eval harness that called
// loadPromptTemplate WITHOUT a target age. clampTargetAge silently fell back to
// age 6, so every evaluated prompt was built for the wrong reader while being
// graded against the blueprint's real age. Nothing failed. Hence the
// assertions below: for EVERY role, the blueprint's age must actually appear in
// the assembled prompt.

const TARGET_AGE = 10; // the target_age of the greenhouse and the mock case

// The talk, search and accusation roles play the greenhouse.
let graphBlueprint: ClueGraphWorld;
// The opening, arrival, goodbye and accusation scene, on the default fixture.
let mockCase: ClueGraphWorld;

beforeAll(async () => {
  graphBlueprint = buildClueGraphWorld(
    validateClueGraph(JSON.parse(await readFile("blueprints/clue-graph/greenhouse-prizewinner.json", "utf-8"))),
  );
  mockCase = readMockCase();
});

function session(overrides: Record<string, unknown> = {}) {
  return {
    mode: "explore",
    current_location_id: "loc-kitchen",
    current_talk_character_id: null,
    time_remaining: 10,
    ...overrides,
  };
}

/** One representative input per role, so every role is actually assembled. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inputFor(role: RoleRequestName): any {
  const common = { game_id: "case", blueprint: mockCase, conversation_history: [] };

  switch (role) {
    case "intro":
      return { ...common, role };
    case "ambience":
      return { ...common, role, destination_id: "loc-kitchen" };
    case "talk_end":
      return {
        ...common,
        role,
        session: session({ mode: "talk", current_talk_character_id: "char-alice" }),
        character_id: "char-alice",
        location_id: "loc-kitchen",
      };
    case "graph_talk":
      return {
        ...common,
        role,
        blueprint: graphBlueprint,
        session: { ...session({ mode: "talk", current_talk_character_id: "hale" }), current_location_id: "greenhouse" },
        character_id: "hale",
        location_id: "greenhouse",
        player_input: "Where is the key?",
      };
    case "graph_search":
      return {
        ...common,
        role,
        blueprint: graphBlueprint,
        session: { ...session(), current_location_id: "greenhouse" },
        location_id: "greenhouse",
        search_query: null,
      };
    case "graph_accusation":
      return { ...common, role, blueprint: graphBlueprint, session: { ...session({ mode: "accuse" }), current_location_id: "greenhouse" }, player_input: "It was Toby." };
    case "graph_accusation_round":
    case "graph_ending":
      return {
        ...common,
        role,
        blueprint: graphBlueprint,
        session: { ...session({ mode: "accuse" }), current_location_id: "greenhouse" },
        player_input: "It was Toby.",
        verdict: role === "graph_ending" ? "lose" : "not_yet",
        accused: "toby",
        cited: [],
      };
    case "accusation_start":
      return { ...common, role, session: session({ mode: "accuse" }) };
    default:
      throw new Error(`No test input defined for role "${role}"`);
  }
}

const NARRATION_ROLES: RoleRequestName[] = ["intro", "ambience"];

async function promptFor(role: RoleRequestName): Promise<string> {
  const input = inputFor(role);
  return NARRATION_ROLES.includes(role)
    ? buildNarrationPrompt(input)
    : (await buildRoleRequest(input)).prompt;
}

describe("role coverage", () => {
  it("assembles every narrator role in the system", () => {
    expect(allRoleRequestNames().sort()).toEqual([
      "accusation_start",
      "ambience",
      "graph_accusation",
      "graph_accusation_round",
      "graph_ending",
      "graph_search",
      "graph_talk",
      "intro",
      "talk_end",
    ]);
  });

  it("has no role of the retired case format", () => {
    const names: string[] = allRoleRequestNames();
    for (const retired of ["talk_start", "talk_conversation", "search", "search_bare", "search_targeted", "accusation_judge"]) {
      expect(names).not.toContain(retired);
    }
  });

  it("has a test input for every registered role", () => {
    for (const role of allRoleRequestNames()) {
      expect(() => inputFor(role), `missing test input for ${role}`).not.toThrow();
    }
  });
});

const NARRATING: RoleRequestName[] = [
  "intro", "ambience", "talk_end", "accusation_start", "graph_talk", "graph_search",
  "graph_accusation_round", "graph_ending",
];

describe("every assembled prompt carries the blueprint's age", () => {
  it.each(NARRATING)("%s renders the blueprint target_age, not a fallback", async (role) => {
    const prompt = await promptFor(role);

    // The exact failure that went unnoticed: age 6 (MIN_TARGET_AGE) instead of
    // the blueprint's 10.
    expect(prompt).toContain(`is ${TARGET_AGE} years old`);
    expect(prompt).not.toContain("is 6 years old");
  });

  // A case sets no voice of its own: every role uses the standard style alone.
  it.each(NARRATING)("%s narrates in the standard style", async (role) => {
    const prompt = await promptFor(role);
    expect(prompt).toContain("## Narration style");
    expect(prompt).not.toContain("This mystery's own voice");
  });

  it("covers every registered role in the assertions above", () => {
    // Guards the hand-written lists against a role being added to the
    // registry but not to them.
    const asserted = new Set<string>([...NARRATING, "graph_accusation"]);
    for (const role of allRoleRequestNames()) {
      expect(asserted.has(role), `role "${role}" is not asserted above`).toBe(true);
    }
  });
});

describe("the accusation's judge", () => {
  it("writes nothing the player reads, so its prompt carries no reading age or voice", async () => {
    const prompt = await promptFor("graph_accusation");
    expect(prompt).not.toMatch(/years old|Length \(guidance/);
    expect(prompt).not.toContain("## Narration style");
  });
});

describe("role-output requests carry a context", () => {
  it("builds a context whose role_name matches the requested role", async () => {
    const { role, context } = await buildRoleRequest(inputFor("graph_talk"));
    expect(role).toBe("graph_talk");
    expect(context).not.toBeNull();
    expect(context.role_name).toBe("graph_talk");
  });

  it("names a search's context by the name its events carry", async () => {
    const { role, context } = await buildRoleRequest(inputFor("graph_search"));
    expect(role).toBe("graph_search");
    expect(context.role_name).toBe("search");
  });

  it("names the talk's location in the talk_end prompt, where the investigator stays", async () => {
    const input = inputFor("talk_end");
    const location = mockCase.world.locations.find((candidate) => candidate.id === input.location_id);
    const { prompt } = await buildRoleRequest(input);
    expect(prompt).toContain(`still in ${location?.name}`);
    expect(prompt).not.toContain("{{location_name}}");
  });

  it("refuses to assemble a narration role as a role-output request", async () => {
    await expect(buildRoleRequest(inputFor("intro"))).rejects.toThrow(
      /narration role/,
    );
  });

  it("refuses to assemble a role-output role as a narration prompt", () => {
    expect(() => buildNarrationPrompt(inputFor("graph_talk"))).toThrow(
      /role-output role/,
    );
  });
});

describe("arrival (ambience) derives its inputs from the session history", () => {
  // The prompt carries the character list as one JSON line.
  function charactersIn(prompt: string): Array<Record<string, unknown>> {
    const line = prompt.split("\n").find((l) => l.startsWith("Characters at destination: "));
    return JSON.parse(line!.slice("Characters at destination: ".length));
  }

  it("sends each present character's arrival pack and nothing about absent ones", () => {
    const blueprint = mockCase;
    const prompt = buildNarrationPrompt({
      role: "ambience",
      game_id: "case",
      blueprint,
      destination_id: "loc-kitchen",
      conversation_history: [],
    });
    const characters = charactersIn(prompt);
    expect(characters.map((c) => c.id)).toEqual(["char-alice"]);
    expect(Object.keys(characters[0]).sort()).toEqual([
      "appearance", "first_name", "id", "initial_attitude_towards_investigator",
      "personality", "sex",
    ]);
    expect(characters[0].initial_attitude_towards_investigator).toBe(
      blueprint.world.characters[0].initial_attitude_towards_investigator,
    );
    expect(prompt).not.toContain(blueprint.world.characters[0].clues[0].text);
    expect(prompt).not.toContain(blueprint.world.characters[1].appearance);
    expect(prompt).toContain("## Characters present");
  });

  it("leaves an empty location with no characters and no character rules", () => {
    const prompt = buildNarrationPrompt({
      role: "ambience",
      game_id: "case",
      blueprint: { ...mockCase, world: { ...mockCase.world, characters: [] } },
      destination_id: "loc-kitchen",
      conversation_history: [],
    });
    expect(charactersIn(prompt)).toEqual([]);
    expect(prompt).not.toContain("## Characters present");
    expect(prompt).toContain("Use only the characters, places and facts you are given.");
  });

  it("names the searchable areas, never a hidden one, and recognises a return visit", () => {
    const blueprint = mockCase;
    const first = buildNarrationPrompt({
      role: "ambience",
      game_id: "case",
      blueprint,
      destination_id: "loc-kitchen",
      conversation_history: [],
    });
    expect(first).toContain("the pantry shelf");
    expect(first).not.toContain("the laundry basket");
    expect(first).toContain("arriving here for the first time");

    const back = buildNarrationPrompt({
      role: "ambience",
      game_id: "case",
      blueprint,
      destination_id: "loc-kitchen",
      conversation_history: [
        {
          sequence: 1,
          event_type: "move",
          actor: "system",
          narration: "You step into the kitchen.",
          payload: { destination: "loc-kitchen", location_id: "loc-kitchen" },
        },
        {
          sequence: 2,
          event_type: "search",
          actor: "system",
          narration: "Under the shelf you find a trail of crumbs.",
          payload: { location_id: "loc-kitchen" },
        },
      ],
    });
    expect(back).toContain("acknowledge the return visit");
    expect(back).toContain('Last arrival here: "You step into the kitchen."');
    expect(first).not.toContain("Last arrival here");
    // Only the last arrival travels: earlier searches and their finds stay out.
    expect(back).not.toContain("trail of crumbs");
  });
});
