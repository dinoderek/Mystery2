// The clue graph as the narrator meets it: the world view the engine builds
// from a case, the talk and search contracts with the mock that answers them,
// and the prompts, recorded in `snapshots/narrator/` (re-record with
// `npx vitest run tests/api/unit/clue-graph-narrator.test.ts -u`, then read the diff).

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { buildClueGraphBlueprint, clueGraphCaseId, validateClueGraph, type ClueGraphCase } from "@my2/shared";
import { parseGraphTalkOutput, parseSearchOutput } from "../../../packages/game-engine/src/ai-contracts.ts";
import { createAIProviderFromProfile, mockGraphSearch, mockGraphTalk } from "../../../packages/game-engine/src/ai-provider.ts";
import { applyEvent, availableGates, replay, type ClueGraphEvent } from "../../../packages/game-engine/src/clue-graph/play.ts";
import {
  buildGraphSearchContext,
  buildGraphTalkContext,
  namedSpot,
  resolveGraphSearchWords,
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
    expect(output.narration).toContain(graph.clues.thorne_never_set_foot.fact);
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

  it("shares what the character knows when asked, and says plainly it does not know otherwise", () => {
    const context = buildGraphTalkContext(graph, replay(graph, [...atThorne, { type: "talk", character: "thorne" }]), "thorne", false);
    const knows = parseGraphTalkOutput(mockGraphTalk(context, "What do you know about prizes?"));
    for (const known of graph.characters.thorne.knows) expect(knows.narration).toContain(known.fact);
    expect(knows).toMatchObject({ opened: [], answered: [], notebook: [] });
    const unknown = parseGraphTalkOutput(mockGraphTalk(context, "Where were the swings?"));
    expect(unknown.narration).toContain("I don't know.");
    expect(unknown).toMatchObject({ opened: [], answered: [], notebook: [] });
  });

  it("earns nothing from gibberish, whatever was listed", () => {
    const context = buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", false);
    expect(parseGraphTalkOutput(mockGraphTalk(context, "xzqv"))).toMatchObject({ input_understood: false, opened: [] });
    expect(
      parseGraphTalkOutput({ narration: "What?", opened: ["a"], answered: ["b"], notebook: [{ id: "b", line: "B." }], input_understood: false }),
    ).toEqual({ narration: "What?", opened: [], answered: [], notebook: [], input_understood: false });
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
      finds: { id: "clue_boot_prints", text: graph.clues.clue_boot_prints.fact },
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

  it("finds nothing at a hidden spot named before its pointer, and never names it to the narrator", () => {
    const hidden = greenhouse();
    hidden.locations.greenhouse.spots[3].revealed_by = "react_toby_pocket";
    const start = replay(hidden, []);
    expect(resolveGraphSearchWords(hidden, start, "the water butt")).toEqual({
      outcome: { kind: "known", spot: null, finds: null },
      spot: "the water butt by the door",
    });
    const context = buildGraphSearchContext(hidden, start, "the water butt");
    expect(context.visible_spots).not.toContain("the water butt by the door");
    expect(JSON.stringify(context)).not.toContain("by the door");
  });

  it("lets a hidden spot win the words only by fitting them strictly better than every visible one", () => {
    const shelves = greenhouse();
    shelves.locations.greenhouse.spots = [
      { name: "the bottom shelf", revealed_by: "react_toby_pocket" },
      { name: "the top shelf" },
    ];
    shelves.clues.clue_snapped_bench.source = { location: "greenhouse", spot: "the top shelf" };
    shelves.clues.clue_glass_outside.source = { location: "greenhouse", spot: "the bottom shelf" };
    for (const id of ["clue_welly_prints", "clue_key_in_water_butt"]) shelves.clues[id].source = { location: "workshop", spot: "the cluttered tool bench" };
    const start = replay(shelves, []);
    expect(namedSpot(shelves, start, "the shelf")).toBe("the top shelf");
    expect(namedSpot(shelves, start, "the bottom shelf")).toBe("the bottom shelf");
    expect(searchOutcome(shelves, start, "the shelf")).toMatchObject({ kind: "known", spot: "the top shelf" });
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
  const accusing = { ...talking, mode: "accuse" as const, current_talk_character_id: null };

  it.each([
    ["graph_talk.greeting", { role: "graph_talk", character_id: "thorne", player_input: null, conversation_history: met.slice(0, 1) }],
    ["graph_talk.line", { role: "graph_talk", character_id: "thorne", player_input: "Whose boot prints are these?", conversation_history: met }],
    ["graph_search.known", { role: "graph_search", search_query: "the ladder", conversation_history: met }],
    ["graph_search.judge", { role: "graph_search", search_query: "the muddy bits", conversation_history: met }],
    ["graph_accusation", { role: "graph_accusation", session: accusing, player_input: "It was Toby.", conversation_history: met }],
    ["graph_accusation_round", { role: "graph_accusation_round", session: accusing, player_input: "It was Toby.", verdict: "not_yet", accused: "toby", cited: [], conversation_history: met }],
    ["graph_ending.lose", { role: "graph_ending", session: accusing, player_input: "It was Mr. Thorne.", verdict: "lose", conversation_history: met }],
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
    await expect(JSON.stringify(request.context, null, 2)).toMatchFileSnapshot(`snapshots/narrator/${name}.context.json`);
  });
});

describe("what a clue-graph narrator is handed", () => {
  const graph = greenhouse();
  const atThorne: ClueGraphEvent[] = [{ type: "move", location: "thorne_garden" }];
  const metThorne: ClueGraphEvent[] = [...atThorne, { type: "talk", character: "thorne" }];

  it("carries what a character knows on every talk, with what each fact points at", () => {
    const knows = [
      { fact: graph.characters.thorne.knows[0].fact },
      { fact: graph.characters.thorne.knows[1].fact, about: "Mr. Thorne's Garden" },
    ];
    expect(buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", true).character.knows).toEqual(knows);
    expect(buildGraphTalkContext(graph, replay(graph, metThorne), "thorne", false).character.knows).toEqual(knows);
  });

  it("carries how a character looks on the first meeting only", () => {
    expect(buildGraphTalkContext(graph, replay(graph, atThorne), "thorne", true).character.appearance).toEqual(
      graph.characters.thorne.appearance,
    );
    expect(buildGraphTalkContext(graph, replay(graph, metThorne), "thorne", false).character.appearance).toBeUndefined();
    const again = replay(graph, [...metThorne, { type: "move", location: "greenhouse" }, { type: "move", location: "thorne_garden" }]);
    expect(buildGraphTalkContext(graph, again, "thorne", true).character.appearance).toBeUndefined();
  });

  it("names the hidden spot a pointer clue shows, in talk and in search", () => {
    const pointing = structuredClone(graph);
    pointing.locations.greenhouse.spots[3].revealed_by = "react_toby_pocket";
    pointing.locations.potting_shed.spots[1].revealed_by = "clue_welly_prints";
    const spot = { spot: "the water butt by the door", location: "The Greenhouse" };
    const met = replay(pointing, [{ type: "move", location: "potting_shed" }, { type: "talk", character: "toby" }]);
    const answer = buildGraphTalkContext(pointing, met, "toby", false).state.answers_if_asked.find((entry) => entry.id === "toby_no_key")!;
    expect(answer.with).toEqual([{ id: "react_toby_pocket", does: pointing.clues.react_toby_pocket.fact, names_spot: spot }]);
    const search = buildGraphSearchContext(pointing, replay(pointing, []), "the smashed pumpkin");
    expect(search.outcome).toMatchObject({
      kind: "known",
      finds: { id: "clue_welly_prints", names_spot: { spot: "the row of key hooks", location: "The Potting Shed" } },
    });
    // A clue that points at nothing names no spot.
    expect(buildGraphSearchContext(graph, replay(graph, []), "the smashed pumpkin").outcome).not.toMatchObject({
      finds: { names_spot: expect.anything() },
    });
  });

  it("never carries a gated clue's fact before its gate is open to it", () => {
    // A gate is open to its clue once it is available: then the narrator holds its fact, to say when it opens,
    // and a bluffable gate elsewhere may name it as a clue to show.
    const gated = Object.keys(graph.clues).filter((id) => {
      const clue = graph.clues[id];
      return clue.kind === "statement" && clue.reached.by === "gated";
    });
    const plays: ClueGraphEvent[][] = [[]];
    for (const [character, person] of Object.entries(graph.characters))
      plays.push([...plays.at(-1)!, { type: "move", location: person.location }, { type: "talk", character }]);
    for (const events of plays) {
      const play = replay(graph, events);
      const available = new Set(Object.keys(graph.characters).flatMap((character) => availableGates(graph, play, character).map((gate) => gate.id)));
      const contexts = [
        ...Object.keys(graph.characters).flatMap((character) => [
          buildGraphTalkContext(graph, play, character, true),
          buildGraphTalkContext(graph, play, character, false),
        ]),
        ...Object.keys(graph.locations).map((location) => buildGraphSearchContext(graph, { ...play, at: location }, null)),
      ].map((context) => JSON.stringify(context));
      for (const id of gated) {
        if (available.has(id) || play.held.includes(id)) continue;
        for (const context of contexts) expect(context, `${events.length} events: ${id}`).not.toContain(graph.clues[id].fact);
      }
    }
    // A greeting carries no gate at all.
    for (const character of Object.keys(graph.characters)) {
      const greeting = JSON.stringify(buildGraphTalkContext(graph, replay(graph, []), character, true).state);
      for (const id of gated) expect(greeting).not.toContain(graph.clues[id].fact);
    }
  });
});
