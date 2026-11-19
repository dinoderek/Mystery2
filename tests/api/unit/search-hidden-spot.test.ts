// A spot whose clues are all locked is hidden from the narrators until a clue
// points to it, and a targeted search that names it still finds its clue:
// specificity, not possession. The search turn runs on the mock narrator.

import { describe, expect, it } from "vitest";

import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import { createAIProviderFromProfile } from "../../../packages/game-engine/src/ai-provider.ts";
import type { BlueprintContext } from "../../../packages/game-engine/src/ai-context.ts";
import { isSpotHidden } from "../../../packages/game-engine/src/clue-discovery.ts";
import { buildNarrationPrompt } from "../../../packages/game-engine/src/role-request.ts";
import { searchNamesSpot } from "../../../packages/game-engine/src/search-target.ts";
import { resolveSearch } from "../../../packages/game-engine/src/turn/resolve-search.ts";
import type { TurnGame, TurnRuntime } from "../../../packages/game-engine/src/turn/types.ts";

const POINTER = {
  kind: "pointer" as const,
  clue_ids: ["clue_prints"],
  rationale: "The prints lead to the hooks out back.",
  target: { location_id: "hut", sub_location_id: "sl_hooks" },
};

const blueprint = {
  metadata: { title: "Case", one_liner: "One line", target_age: 8 },
  narrative: { premise: "Someone took the bell." },
  world: {
    starting_location_id: "hut",
    locations: [
      {
        id: "hut",
        name: "Ticket Hut",
        description: "A small wooden hut.",
        clues: [{ id: "clue_ticket", text: "A torn ticket." }],
        sub_locations: [
          { id: "sl_window", name: "the frosty window", hint: "Breath marks.", clues: [{ id: "clue_breath", text: "Breath on the glass." }] },
          { id: "sl_hooks", name: "the snowshoe hooks out back", hint: "Empty hooks.", clues: [{ id: "clue_wet", text: "Wet snowshoes.", requires: POINTER }] },
        ],
      },
    ],
    characters: [],
  },
  ground_truth: { what_happened: "", why_it_happened: "", timeline: [] },
  solution_paths: [],
  red_herrings: [],
  suspect_elimination_paths: [],
} satisfies BlueprintContext;

type Logged = { event: string; fields: Record<string, unknown> };

function play(query: string | null, discovered: string[] = []) {
  const logged: Logged[] = [];
  const runtime: TurnRuntime = {
    req: new Request("http://test/api/game-turn"),
    request_id: "req-1",
    game_id: "game-1",
    provider: createAIProviderFromProfile({ provider: "mock", model: "mock" }, { env: {} }),
    logger: {
      log: (event: string, fields: Record<string, unknown>) => logged.push({ event, fields }),
      logError: () => {},
    } as TurnRuntime["logger"],
  };
  const history = discovered.map((id, index) => ({
    sequence: index + 2,
    event_type: "search",
    actor: "system",
    narration: "found",
    payload: { location_id: "elsewhere", revealed_clue_ids: [id] },
  }));
  const game = {
    game_id: "game-1",
    session: { mode: "explore", current_location_id: "hut", discovered_clues: discovered, current_talk_character_id: null },
    blueprint,
    history,
    next_sequence: history.length + 2,
  } as unknown as TurnGame;
  return resolveSearch(game, runtime, query).then((outcome) => ({ outcome, logged }));
}

describe("a hidden spot", () => {
  it("is hidden while every clue in it is locked, and shown once one is unlocked or found", () => {
    const hooks = blueprint.world.locations[0].sub_locations[1];
    expect(isSpotHidden(hooks, new Set())).toBe(true);
    expect(isSpotHidden(hooks, new Set(["clue_prints"]))).toBe(false);
    expect(isSpotHidden(hooks, new Set(["clue_wet"]))).toBe(false);
    expect(isSpotHidden({ clues: [] }, new Set())).toBe(false);
  });

  it("is left out of the arrival's searchable areas until a clue points to it", () => {
    const arrive = (history: Array<Record<string, unknown>>) =>
      buildNarrationPrompt({
        role: "ambience",
        game_id: "game-1",
        blueprint,
        destination_id: "hut",
        conversation_history: history as never,
      });
    expect(arrive([])).toContain("the frosty window");
    expect(arrive([])).not.toContain("snowshoe hooks");
    const found = [{ sequence: 2, event_type: "search", actor: "system", narration: "", payload: { location_id: "x", revealed_clue_ids: ["clue_prints"] } }];
    expect(arrive(found)).toContain("the snowshoe hooks out back");
  });
});

describe("a targeted search", () => {
  it("that names the locked spot admits its clue, and logs why", async () => {
    const { outcome, logged } = await play("check the snowshoe hooks");

    expect(outcome.revealed_clues.map((clue) => ({ id: clue.id, off_script: clue.off_script }))).toEqual([
      { id: "clue_wet", off_script: true },
    ]);
    expect(outcome.event.payload.revealed_clue_id).toBe("clue_wet");
    // Declared on the event, so the evaluators read it as a bypass, not a leak.
    expect(outcome.event.payload.revealed_off_script).toEqual(["clue_wet"]);
    expect(logged).toContainEqual({
      event: "search.clue_admitted_by_target",
      fields: expect.objectContaining({
        ai_clue_id: "clue_wet",
        sub_location_id: "sl_hooks",
        search_query: "check the snowshoe hooks",
        reason: expect.stringContaining("named a locked spot"),
      }),
    });
  });

  it("that names the locked spot passes the requires check the evaluators run", async () => {
    const { outcome } = await play("check the snowshoe hooks");
    const event = { id: "s2", sequence: 2, actor: "system", narration: "", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z", ...outcome.event };
    const checks = runTraceMechanicalChecks({
      rawTrace: { blueprint, events: [event] } as never,
      context: { enforce_requires: true },
    }) as Array<{ id: string; status: string }>;

    expect(checks.find((check) => check.id === "clue_requires_violation")?.status).toBe("pass");
  });

  it("that names another spot finds that one, and never sees the hidden spot", async () => {
    const { outcome, logged } = await play("the frosty window");

    expect(outcome.revealed_clues.map((clue) => ({ id: clue.id, off_script: clue.off_script }))).toEqual([
      { id: "clue_breath", off_script: false },
    ]);
    expect(outcome.event.payload.revealed_off_script).toEqual([]);
    expect(logged.map((entry) => entry.event)).not.toContain("search.clue_admitted_by_target");
  });

  it("that names nothing does not reach the locked clue", async () => {
    const { outcome, logged } = await play("under the rug");

    // The mock is generous with open spots, but the hidden one is not among them.
    expect(outcome.revealed_clues.map((clue) => clue.id)).toEqual(["clue_breath"]);
    expect(logged.map((entry) => entry.event)).not.toContain("search.clue_admitted_by_target");
  });
});

describe("an untargeted search", () => {
  it("does not admit the locked clue", async () => {
    const { outcome, logged } = await play(null);

    expect(outcome.revealed_clues.map((clue) => clue.id)).toEqual(["clue_ticket"]);
    expect(logged.map((entry) => entry.event)).not.toContain("search.clue_admitted_by_target");
  });
});

describe("searchNamesSpot", () => {
  it("needs the spot's head word, not just a shared adjective", () => {
    expect(searchNamesSpot("search the dusty floor", "the dusty bookshelf", "Library")).toBe(false);
    expect(searchNamesSpot("check the muddy boots", "the pond's muddy edge", "Moonglow Pond")).toBe(false);
    expect(searchNamesSpot("search for snowshoes", "the snowshoe hooks out back", "Ticket Hut")).toBe(false);
    expect(searchNamesSpot("the dusty bookshelf", "the dusty bookshelf", "Library")).toBe(true);
  });

  it("folds plurals, a final -e or -y, and accents", () => {
    expect(searchNamesSpot("the cookies", "the cookie tin", "Kitchen")).toBe(true);
    expect(searchNamesSpot("the berry bush", "the berries bushes", "Garden")).toBe(true);
    expect(searchNamesSpot("the café counter", "the cafe counter", "Shop")).toBe(true);
  });

  it("matches the spot's own words, plurals included, at least half of them", () => {
    expect(searchNamesSpot("the hooks", "the snowshoe hooks out back", "Ticket Hut")).toBe(true);
    expect(searchNamesSpot("look under the willows", "under the weeping willow", "Moonglow Pond")).toBe(true);
    expect(searchNamesSpot("follow the fern path", "The Fading Fern Path", "Heartwood Hollow")).toBe(true);
    expect(searchNamesSpot("the ferns", "The Fading Fern Path", "Heartwood Hollow")).toBe(false);
  });

  it("ignores where-to-look words and the place's own name", () => {
    expect(searchNamesSpot("look behind it", "behind the big woodpile", "Woodshed")).toBe(false);
    expect(searchNamesSpot("search the pond", "the pond's muddy edge", "Moonglow Pond")).toBe(false);
    expect(searchNamesSpot("the muddy edge", "the pond's muddy edge", "Moonglow Pond")).toBe(true);
    expect(searchNamesSpot("anything", "under it", "Hut")).toBe(false);
  });
});
