// The clue graph as the narrator meets it: the world view the engine builds
// from a case, the talk and search contracts with the mock that answers them,
// and the prompts, recorded in `snapshots/narrator/` (re-record with
// `npx vitest run tests/api/unit/clue-graph-narrator.test.ts -u`, then read the diff).

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClueGraphBlueprint, clueGraphCaseId, validateClueGraph, type ClueGraphCase } from "@my2/shared";
import { parseGraphTalkOutput, parseSearchOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import { createAIProviderFromProfile, mockGraphSearch, mockGraphTalk } from "../../../packages/game-engine/src/ai-provider.ts";
import { applyEvent, replay, type ClueGraphEvent } from "../../../packages/game-engine/src/clue-graph/play.ts";
import {
  buildGraphSearchContext,
  buildGraphTalkContext,
  searchOutcome,
} from "../../../packages/game-engine/src/clue-graph/narrator-context.ts";
import { buildRoleRequest } from "../../../packages/game-engine/src/role-request.ts";

function greenhouse(): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8")));
}

/** The case's events as a game history records them. */
function history(events: ClueGraphEvent[]) {
  return events.map((event, index) => ({
    sequence: index + 2,
    event_type: { move: "move", search: "search", talk: "talk", line: "ask" }[event.type],
    actor: "system",
    narration: "…",
    payload: { clue_graph: event, ...(event.type === "talk" || event.type === "line" ? { character_id: event.character } : {}) },
  }));
}

describe("the clue-graph world view", () => {
  it("names the case by a stable UUID and keeps the graph beside a rule-free world", () => {
    const graph = greenhouse();
    const world = buildClueGraphBlueprint(graph);
    expect(world.id).toBe(clueGraphCaseId("greenhouse-prizewinner"));
    expect(world.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(clueGraphCaseId("another-case")).not.toBe(world.id);
    expect(world.clue_graph).toBe(graph);
    expect(world.metadata.title).toBe("The Smashed Prize Pumpkin — clue graph");
    expect(world.solution_paths).toEqual([]);
    expect(world.world.characters.map((person) => [person.first_name, person.sex, person.is_culprit])).toEqual([
      ["Ms. Hale", "female", false],
      ["Toby", "male", true],
      ["Mia", "female", false],
      ["Mr. Dobbs", "male", false],
      ["Mr. Thorne", "male", false],
    ]);
    const greenhouseRoom = world.world.locations.find((place) => place.id === "greenhouse")!;
    expect(greenhouseRoom.clues.map((clue) => clue.id)).toEqual(["clue_boot_prints"]);
    expect(greenhouseRoom.sub_locations.map((spot) => [spot.id, spot.clues.map((clue) => clue.id)])).toEqual([
      ["the-broken-side-window", ["clue_glass_outside"]],
      ["the-smashed-pumpkin", ["clue_welly_prints"]],
      ["the-toppled-bench", ["clue_snapped_bench"]],
      ["the-water-butt-by-the-door", ["clue_key_in_water_butt"]],
    ]);
  });

  it("points a hidden spot's clue at the spot's pointer, so an arrival keeps it quiet", () => {
    const graph = greenhouse();
    graph.locations.greenhouse.spots[3].revealed_by = "react_toby_pocket";
    const spot = buildClueGraphBlueprint(graph).world.locations[0].sub_locations[3];
    expect(spot.clues[0].requires).toMatchObject({ kind: "pointer", clue_ids: ["react_toby_pocket"] });
  });
});

describe("the clue-graph talk contract and mock", () => {
  const graph = greenhouse();
  const atThorne: ClueGraphEvent[] = [{ type: "move", location: "thorne_garden" }];

  it("greets with the first words due and earns nothing", () => {
    const context = buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", true);
    expect(context.state.gates).toEqual([]);
    expect(context.state.answers_if_asked).toEqual([]);
    const output = parseGraphTalkOutput(mockGraphTalk(context, null));
    expect(output).toMatchObject({ opened: [], answered: [], input_understood: true });
    expect(output.narration).toContain(graph.clues.thorne_never_set_foot.text);
  });

  it("answers what a line asks about, and opens a gate the line uses or bluffs", () => {
    const met = replay(graph, [...atThorne, { type: "talk", character: "thorne" }]);
    const context = buildGraphTalkContext(graph, met, "thorne", false);
    expect(context.state.gates.map((gate) => [gate.id, gate.bluffable])).toEqual([
      ["clue_thorne_measured", true],
      ["thorne_ladder_thursday", true],
    ]);
    expect(parseGraphTalkOutput(mockGraphTalk(context, "Look: clue_boot_prints!"))).toMatchObject({
      opened: ["clue_thorne_measured"],
      answered: [],
    });
    expect(parseGraphTalkOutput(mockGraphTalk(context, "Nice day.")).opened).toEqual([]);

    const atDobbs = replay(graph, [{ type: "move", location: "workshop" }, { type: "talk", character: "dobbs" }]);
    const dobbs = buildGraphTalkContext(graph, atDobbs, "dobbs", false);
    expect(parseGraphTalkOutput(mockGraphTalk(dobbs, "Tell me about the noise last night")).answered).toEqual([
      "clue_dobbs_crash_time",
    ]);
  });

  it("opens a worded gate by its id, and a plain-question gate on the truth", () => {
    const met = replay(graph, [...atThorne, { type: "talk", character: "thorne" }]);
    const context = buildGraphTalkContext(graph, met, "thorne", false);
    const worded = { ...context.state.gates[0], opens_with: { line: "Be kind." } };
    const plain = { ...context.state.gates[1], opens_with: { asked_plainly: true as const } };
    const state = { ...context, state: { ...context.state, gates: [worded, plain] } };
    expect(parseGraphTalkOutput(mockGraphTalk(state, `About ${worded.id}`)).opened).toEqual([worded.id]);
    expect(parseGraphTalkOutput(mockGraphTalk(state, "Tell me the truth")).opened).toEqual([plain.id]);
  });

  it("earns nothing from gibberish, whatever was listed", () => {
    const context = buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", false);
    expect(parseGraphTalkOutput(mockGraphTalk(context, "xzqv"))).toMatchObject({ input_understood: false, opened: [] });
    expect(
      parseGraphTalkOutput({ narration: "What?", opened: ["a"], answered: ["b"], input_understood: false }),
    ).toEqual({ narration: "What?", opened: [], answered: [], input_understood: false });
    expect(parseGraphTalkOutput({ narration: "Hi.", opened: ["a", "a", 3] }).opened).toEqual(["a"]);
  });

  it("is what the mock provider answers for the graph_talk role", async () => {
    const provider = createAIProviderFromProfile({ provider: "mock", model: "mock" });
    const context = buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", true);
    const output = await provider.generateRoleOutput({
      role: "graph_talk",
      prompt: "",
      context: { graph_talk_context: context, player_input: null },
      parse: parseGraphTalkOutput,
    });
    expect(output.narration).toContain("Mr. Thorne is here");
  });
});

describe("the clue-graph search outcome and mock", () => {
  const graph = greenhouse();

  it("knows what a plain or a named search finds, and lets the narrator judge loose words", () => {
    const start = replay(graph, []);
    expect(searchOutcome(graph, start, null)).toEqual({
      kind: "known",
      spot: null,
      finds: { id: "clue_boot_prints", text: graph.clues.clue_boot_prints.text },
    });
    expect(searchOutcome(graph, start, "the toppled bench")).toMatchObject({ kind: "known", spot: "the toppled bench" });
    const loose = searchOutcome(graph, start, "the busted glass");
    expect(loose.kind === "judge" && loose.candidates.map((candidate) => candidate.spot)).toEqual([
      null,
      "the broken side window",
      "the smashed pumpkin",
      "the toppled bench",
      "the water butt by the door",
    ]);
    const searched = applyEvent(graph, start, { type: "search" }).play;
    expect(searchOutcome(graph, searched, null)).toEqual({ kind: "known", spot: null, finds: null });
  });

  it("finds nothing at a hidden spot named before its pointer", () => {
    const hidden = greenhouse();
    hidden.locations.greenhouse.spots[3].revealed_by = "react_toby_pocket";
    const outcome = searchOutcome(hidden, replay(hidden, []), "the water butt");
    expect(outcome).toEqual({ kind: "known", spot: "the water butt by the door", finds: null });
    const context = buildGraphSearchContext(hidden, replay(hidden, []), "the water butt");
    expect(context.visible_spots).not.toContain("the water butt by the door");
  });

  it("answers a known outcome as given, finds nothing on a judged one, and nothing for gibberish", () => {
    const start = replay(graph, []);
    const known = parseSearchOutput(mockGraphSearch(buildGraphSearchContext(graph, start, "the smashed pumpkin")));
    expect(known).toMatchObject({ revealed_clue_id: "clue_welly_prints", input_understood: true });
    expect(parseSearchOutput(mockGraphSearch(buildGraphSearchContext(graph, start, "the busted glass"))).revealed_clue_id).toBeNull();
    expect(parseSearchOutput(mockGraphSearch(buildGraphSearchContext(graph, start, "xzqv")))).toMatchObject({
      input_understood: false,
      costs_turn: false,
    });
  });
});

describe("the clue-graph prompts", () => {
  const graph = greenhouse();
  const blueprint = buildClueGraphBlueprint(graph);
  const talking = { mode: "talk" as const, current_location_id: "thorne_garden", current_talk_character_id: "thorne", time_remaining: 9 };
  const met = history([
    { type: "move", location: "thorne_garden" },
    { type: "talk", character: "thorne" },
  ]);

  it.each([
    ["graph_talk.greeting", { role: "graph_talk", character_id: "thorne", player_input: null, conversation_history: met.slice(0, 1) }],
    ["graph_talk.line", { role: "graph_talk", character_id: "thorne", player_input: "Whose boot prints are these?", conversation_history: met }],
    ["graph_search.known", { role: "graph_search", search_query: "the ladder", conversation_history: met }],
    ["graph_search.judge", { role: "graph_search", search_query: "the muddy bits", conversation_history: met }],
    ["accusation_judge", { role: "accusation_judge", player_input: "It was Toby.", round: 1, conversation_history: met }],
  ] as const)("%s is as recorded", async (name, input) => {
    const request = await buildRoleRequest({
      game_id: "case",
      blueprint,
      session: talking,
      location_id: "thorne_garden",
      ...input,
    } as Parameters<typeof buildRoleRequest>[0]);
    expect(request.prompt).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    await expect(request.prompt).toMatchFileSnapshot(`snapshots/narrator/${name}.prompt.txt`);
    if (name !== "accusation_judge")
      await expect(JSON.stringify(request.context, null, 2)).toMatchFileSnapshot(`snapshots/narrator/${name}.context.json`);
  });
});
