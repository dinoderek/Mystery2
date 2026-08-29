import { readFile } from "node:fs/promises";

import { beforeAll, describe, expect, it } from "vitest";

import {
  allRoleRequestNames,
  buildNarrationPrompt,
  buildRoleRequest,
  resolveAccusationRole,
  resolveSearchRole,
  type RoleRequestName,
} from "../../../packages/game-engine/src/role-request.ts";

// role-request.ts is the single assembly path for narrator prompts. These tests
// exist because the previous arrangement had two: the endpoint handlers,
// and a parallel implementation in the eval harness that called
// loadPromptTemplate WITHOUT a target age. clampTargetAge silently fell back to
// age 6, so every evaluated prompt was built for the wrong reader while being
// graded against the blueprint's real age, and narration_style never reached
// the model at all. Nothing failed. Hence the assertions below: for EVERY role,
// the blueprint's age and voice must actually appear in the assembled prompt.

const TARGET_AGE = 10; // mock-blueprint's target_age
const NARRATION_STYLE = "salty harbor air and gull cries";

// deno-lint-ignore-file no-explicit-any
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let blueprint: any;

beforeAll(async () => {
  blueprint = JSON.parse(
    await readFile("blueprints/mock-blueprint.json", "utf-8"),
  );
  blueprint.metadata.narration_style = NARRATION_STYLE;
});

function session(overrides: Record<string, unknown> = {}) {
  return {
    mode: "explore",
    current_location_id: blueprint.world.locations[0].id,
    current_talk_character_id: null,
    time_remaining: 10,
    ...overrides,
  };
}

/** One representative input per role, so every role is actually assembled. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function inputFor(role: RoleRequestName): any {
  const locationId = blueprint.world.locations[0].id;
  const characterId = blueprint.world.characters[0].id;
  const common = { game_id: "case", blueprint, conversation_history: [] };

  switch (role) {
    case "intro":
      return { ...common, role };
    case "ambience":
      return {
        ...common,
        role,
        destination_id: locationId,
        has_visited_before: false,
        destination_history_json: "[]",
        destination_characters_json: "[]",
      };
    case "talk_start":
    case "talk_end":
      return {
        ...common,
        role,
        session: session({ mode: "talk", current_talk_character_id: characterId }),
        character_id: characterId,
        location_id: locationId,
      };
    case "talk_conversation":
      return {
        ...common,
        role,
        session: session({ mode: "talk", current_talk_character_id: characterId }),
        character_id: characterId,
        location_id: locationId,
        player_input: "Where were you?",
      };
    case "search_bare":
      return {
        ...common,
        role,
        session: session(),
        location_id: locationId,
        revealed_clue_ids: [],
        next_clue: null,
      };
    case "search_targeted":
      return {
        ...common,
        role,
        session: session(),
        location_id: locationId,
        revealed_clue_ids: [],
        next_clue: null,
        search_query: "under the bed",
      };
    case "accusation_start":
      return { ...common, role, session: session({ mode: "accuse" }) };
    case "accusation_judge":
      return {
        ...common,
        role,
        session: session({ mode: "accuse" }),
        player_input: "It was Alice.",
        round: 1,
      };
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
      "accusation_judge",
      "accusation_start",
      "ambience",
      "intro",
      "search_bare",
      "search_targeted",
      "talk_conversation",
      "talk_end",
      "talk_start",
    ]);
  });

  it("has a test input for every registered role", () => {
    for (const role of allRoleRequestNames()) {
      expect(() => inputFor(role), `missing test input for ${role}`).not.toThrow();
    }
  });
});

describe("every assembled prompt carries the blueprint's age and voice", () => {
  it.each(
    // Enumerated at module load so a newly registered role shows up here
    // automatically rather than silently going unasserted.
    ["intro", "ambience", "talk_start", "talk_conversation", "talk_end",
      "search_bare", "search_targeted", "accusation_start", "accusation_judge"] as RoleRequestName[],
  )("%s renders the blueprint target_age, not a fallback", async (role) => {
    const prompt = await promptFor(role);

    // The exact failure that went unnoticed: age 6 (MIN_TARGET_AGE) instead of
    // the blueprint's 10.
    expect(prompt).toContain(`is ${TARGET_AGE} years old`);
    expect(prompt).not.toContain("is 6 years old");
  });

  it.each(
    ["intro", "ambience", "talk_start", "talk_conversation", "talk_end",
      "search_bare", "search_targeted", "accusation_start", "accusation_judge"] as RoleRequestName[],
  )("%s layers the blueprint narration_style", async (role) => {
    expect(await promptFor(role)).toContain(NARRATION_STYLE);
  });

  it("covers every registered role in the assertions above", () => {
    // Guards the hand-written it.each lists against a role being added to the
    // registry but not to the lists.
    const asserted = new Set([
      "intro", "ambience", "talk_start", "talk_conversation", "talk_end",
      "search_bare", "search_targeted", "accusation_start", "accusation_judge",
    ]);
    for (const role of allRoleRequestNames()) {
      expect(asserted.has(role), `role "${role}" is not asserted above`).toBe(true);
    }
  });
});

describe("role-output requests carry a context", () => {
  it("builds a context whose role_name matches the requested role", async () => {
    const { role, context } = await buildRoleRequest(inputFor("talk_conversation"));
    expect(role).toBe("talk_conversation");
    expect(context).not.toBeNull();
    expect(context.role_name).toBe("talk_conversation");
  });

  it("refuses to assemble a narration role as a role-output request", async () => {
    await expect(buildRoleRequest(inputFor("intro"))).rejects.toThrow(
      /narration role/,
    );
  });

  it("refuses to assemble a role-output role as a narration prompt", () => {
    expect(() => buildNarrationPrompt(inputFor("talk_start"))).toThrow(
      /role-output role/,
    );
  });
});

describe("role resolution is shared, so handler and harness agree", () => {
  it("resolves search by whether the player supplied free text", () => {
    expect(resolveSearchRole(null)).toBe("search_bare");
    expect(resolveSearchRole("")).toBe("search_bare");
    expect(resolveSearchRole("   ")).toBe("search_bare");
    expect(resolveSearchRole("under the bed")).toBe("search_targeted");
  });

  it("resolves accusation by whether the player supplied reasoning", () => {
    expect(resolveAccusationRole(null)).toBe("accusation_start");
    expect(resolveAccusationRole("  ")).toBe("accusation_start");
    expect(resolveAccusationRole("It was Alice")).toBe("accusation_judge");
  });
});

describe("search word budget follows the outcome the backend already knows", () => {
  it("uses the roomier clue-reveal budget when a bare search will reveal a clue", async () => {
    const wordTarget = (s: string) =>
      Number(s.match(/aim for about (\d+) words/)?.[1] ?? 0);

    const empty = await promptFor("search_bare");
    const withClue = (
      await buildRoleRequest({
        ...inputFor("search_bare"),
        next_clue: { id: "clue-1", text: "A muddy footprint." },
      })
    ).prompt;

    expect(wordTarget(withClue)).toBeGreaterThan(wordTarget(empty));
  });
});
