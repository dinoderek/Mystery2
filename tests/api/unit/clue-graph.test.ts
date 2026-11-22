import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  buildClueGraphBlueprint,
  cheapestRoute,
  ClueGraphCaseSchema,
  reachClues,
  validateClueGraph,
  type ClueGraphCase,
} from "@my2/shared";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const committed = validateClueGraph(JSON.parse(fs.readFileSync(GREENHOUSE, "utf8")));

function greenhouse(): ClueGraphCase {
  return structuredClone(committed);
}

/** Every issue the validator raises, as `path: message` lines. */
function issues(value: unknown): string[] {
  try {
    validateClueGraph(value);
    return [];
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }
}

/** Sets, or with no value removes, the field at a dotted path, to break a case. */
function set(graph: ClueGraphCase, field: string, ...value: [unknown?]) {
  const keys = field.split(".");
  const parent = keys
    .slice(0, -1)
    .reduce<object>((object, key) => Reflect.get(object, key) as object, graph);
  if (value.length === 0) Reflect.deleteProperty(parent, keys.at(-1)!);
  else Reflect.set(parent, keys.at(-1)!, value[0]);
}

// The order the original Python prototype checker reached the clues of the
// graph the greenhouse case was converted from, kept as the golden.
const PROTOTYPE_ORDER = [
  "clue_boot_prints", "clue_glass_outside", "clue_welly_prints", "clue_snapped_bench",
  "clue_key_in_water_butt", "clue_rota_purple_ink", "clue_spare_key_book", "clue_ladder_tape",
  "hale_found_locked", "clue_hale_key_last_seen", "clue_hale_borrowed_pen", "hale_toby_fine",
  "react_hale_gloves", "clue_hale_toby_upset", "toby_alibi", "react_toby_sweeping",
  "react_toby_trainers", "toby_blames_thorne", "clue_toby_thorne_ladder", "toby_no_key",
  "react_toby_pocket", "clue_toby_mia_splat", "toby_drops_burglar", "toby_blames_mia",
  "mia_alibi", "react_mia_pen", "clue_mia_thorne_barbecue", "mia_admits_splat",
  "dobbs_rounds", "react_dobbs_slippers", "clue_dobbs_crash_time", "thorne_alibi",
  "clue_thorne_mia_cake", "thorne_never_set_foot", "react_thorne_boot", "clue_thorne_measured",
  "thorne_ladder_thursday", "toby_not_mia", "toby_confession",
];

describe("the greenhouse clue graph", () => {
  it("passes the schema and the validator", () => {
    expect(ClueGraphCaseSchema.safeParse(greenhouse()).success).toBe(true);
    expect(issues(greenhouse())).toEqual([]);
  });

  it("reaches every clue in the prototype checker's order", () => {
    expect(reachClues(greenhouse()).map((entry) => entry.id)).toEqual(PROTOTYPE_ORDER);
  });

  it("says how each clue is reached", () => {
    const by = Object.fromEntries(reachClues(greenhouse()).map((entry) => [entry.id, entry.by]));
    expect(by).toMatchObject({
      clue_boot_prints: "plain search",
      clue_glass_outside: "search the broken side window",
      hale_found_locked: "said on first meeting",
      clue_hale_key_last_seen: "ask about the missing key (prompted by opening)",
      react_hale_gloves: "seen with hale_toby_fine",
      toby_blames_mia: "show clue_welly_prints or clue_key_in_water_butt",
      toby_confession: "asked once toby_drops_burglar and toby_not_mia are out",
    });
  });

  it("names the culprit with a route of five turns", () => {
    const graph = greenhouse();
    expect(cheapestRoute(graph, graph.conclusions.culprit_toby.rule)).toBe(5);
  });
});

describe("the graph checks", () => {
  it("rejects a clue never reached", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_dobbs_crash_time.reached.prompted_by", ["clue_mia_thorne_barbecue"]);
    set(graph, "clues.clue_mia_thorne_barbecue.reached.prompted_by", ["clue_dobbs_crash_time"]);
    expect(issues(graph)).toContain(
      'clues.clue_dobbs_crash_time: Clue "clue_dobbs_crash_time" is never reached from the opening',
    );
  });

  it("rejects an asked clue with no prompt", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_hale_key_last_seen.reached.prompted_by", []);
    expect(issues(graph)).toContain(
      'clues.clue_hale_key_last_seen.reached.prompted_by: Clue "clue_hale_key_last_seen" is asked, but nothing prompts the question',
    );
  });

  it("rejects a worded gate with no tell that hints at it", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_hale_toby_upset.reached.gate.line.hinted_by");
    expect(issues(graph)).toContain(
      'clues.clue_hale_toby_upset.reached.gate.line: Clue "clue_hale_toby_upset" has a worded gate with no tell that hints at it',
    );
  });

  it("rejects a false statement nothing reachable takes back", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_thorne_measured.takes_back");
    expect(issues(graph)).toEqual([
      'clues.thorne_never_set_foot: False statement "thorne_never_set_foot" has no reachable clue that takes it back',
    ]);
  });

  it("rejects a conclusion that cannot be reached", () => {
    const graph = greenhouse();
    // The bench's spot is hidden behind its own clue, so nothing opens it.
    graph.locations.greenhouse.spots[2].revealed_by = "clue_snapped_bench";
    expect(issues(graph)).toEqual([
      'clues.clue_snapped_bench: Clue "clue_snapped_bench" is never reached from the opening',
      'conclusions.how: Conclusion "how" cannot be reached',
    ]);
  });

  it("rejects a suspect with no clearing conclusion", () => {
    const graph = greenhouse();
    delete graph.conclusions.mia_cleared.clears;
    expect(issues(graph)).toEqual([
      'characters.mia: Suspect "mia" has no conclusion that clears them',
    ]);
  });

  it("rejects a culprit with no route within the turn budget", () => {
    const graph = greenhouse();
    graph.metadata.time_budget = 4;
    expect(issues(graph)).toEqual([
      'metadata.time_budget: Conclusion "culprit_toby" has no route within 4 turns without a bluff',
    ]);
    graph.metadata.time_budget = 5;
    expect(issues(graph)).toEqual([]);
  });

  it("rejects a spot, or a plain search, with more than one clue", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_snapped_bench.source.spot", "the smashed pumpkin");
    set(graph, "clues.clue_glass_outside.source.spot");
    expect(issues(graph)).toEqual([
      'locations.greenhouse: The plain search at "greenhouse" holds more than one clue: clue_boot_prints, clue_glass_outside',
      'locations.greenhouse: Spot "the smashed pumpkin" at "greenhouse" holds more than one clue: clue_welly_prints, clue_snapped_bench',
    ]);
  });

  it("rejects a cycle in the needs-first links", () => {
    const graph = greenhouse();
    set(graph, "clues.toby_drops_burglar.reached.gate.after", ["toby_blames_thorne", "toby_confession"]);
    expect(issues(graph)).toEqual(
      expect.arrayContaining([
        'clues.toby_drops_burglar.reached.gate.after: Clue "toby_drops_burglar" needs itself first: toby_drops_burglar → toby_confession → toby_drops_burglar',
        'clues.toby_drops_burglar: Clue "toby_drops_burglar" is never reached from the opening',
      ]),
    );
    set(graph, "clues.toby_drops_burglar.reached.gate.after", ["toby_drops_burglar"]);
    expect(issues(graph)).toContain(
      'clues.toby_drops_burglar.reached.gate.after: Clue "toby_drops_burglar" needs itself first: toby_drops_burglar → toby_drops_burglar',
    );
  });

  it("opens a hidden spot once its pointer is held", () => {
    const graph = greenhouse();
    graph.locations.greenhouse.spots[2].revealed_by = "clue_hale_toby_upset";
    expect(issues(graph)).toEqual([]);
    const order = reachClues(graph).map((entry) => entry.id);
    expect(order.indexOf("clue_snapped_bench")).toBeGreaterThan(order.indexOf("clue_hale_toby_upset"));
  });

  it("accepts an all-of gate, a tell seen on a subject and a physical gate", () => {
    const graph = greenhouse();
    set(graph, "clues.toby_blames_mia.reached.gate", {
      use: { all: ["clue_welly_prints", "clue_key_in_water_butt"] },
      physical: true,
    });
    set(graph, "clues.react_dobbs_slippers.reached", { by: "seen", subject: "the noise last night" });
    expect(issues(graph)).toEqual([]);
    const by = Object.fromEntries(reachClues(graph).map((entry) => [entry.id, entry.by]));
    expect(by.toby_blames_mia).toBe("show clue_welly_prints and clue_key_in_water_butt");
    expect(by.react_dobbs_slippers).toBe("seen when the noise last night comes up");
  });

  it("reports a missing reference instead of checking the graph", () => {
    const graph = greenhouse();
    graph.characters.mia.location = "fair";
    set(graph, "clues.clue_ladder_tape.source.spot", "the roof");
    set(graph, "clues.react_mia_pen.reached.with", "clue_spare_key_book");
    set(graph, "clues.toby_no_key.reached.prompted_by", ["opening", "nothing"]);
    set(graph, "clues.clue_hale_toby_upset.reached.gate.line.hinted_by", "hale_toby_fine");
    set(graph, "clues.toby_not_mia.reached.gate.use.any", ["ghost"]);
    set(graph, "clues.toby_not_mia.reached.gate.after", ["mia_alibi"]);
    set(graph, "clues.toby_confession.takes_back", ["toby_alibi", "clue_toby_thorne_ladder"]);
    graph.locations.workshop.spots[0].revealed_by = "missing";
    graph.locations.workshop.spots[1].name = graph.locations.workshop.spots[0].name;
    graph.opening.location = "moon";
    graph.conclusions.how.rule = { any: ["clue_snapped_bench", { all: ["unknown"] }] };
    graph.conclusions.motive.clears = "nobody";
    expect(issues(graph)).toEqual([
      'opening.location: Reference "moon" must name a location',
      'characters.mia.location: Reference "fair" must name a location',
      'locations.workshop.spots.0.revealed_by: Reference "missing" must name another clue',
      'locations.workshop.spots.1.name: Spot "the window over the garden" is listed twice',
      'clues.clue_ladder_tape.source.spot: Spot "the roof" must be one of "thorne_garden"\'s spots',
      'clues.clue_hale_toby_upset.reached.gate.line.hinted_by: Reference "hale_toby_fine" must name another tell from "hale"',
      'clues.toby_no_key.reached.prompted_by.1: Reference "nothing" must name another clue',
      'clues.toby_not_mia.reached.gate.after.0: Reference "mia_alibi" must name another clue from "toby"',
      'clues.toby_not_mia.reached.gate.use.any.0: Reference "ghost" must name another clue',
      'clues.toby_confession.takes_back.1: Reference "clue_toby_thorne_ladder" must name another false statement from "toby"',
      'clues.react_mia_pen.reached.with: Reference "clue_spare_key_book" must name another statement from "mia"',
      'conclusions.motive: Reference "nobody" must name a character',
      'conclusions.how.rule.any.1.all.0: Reference "unknown" must name a clue or conclusion',
    ]);
  });

  it("holds the culprit and the conclusions that name people to their roles", () => {
    const twoCulprits = greenhouse();
    twoCulprits.characters.mia.role = "culprit";
    expect(issues(twoCulprits)).toEqual([
      "characters: Exactly one character is the culprit, not 2",
      'conclusions.mia_cleared.clears: Conclusion "mia_cleared" must clear a suspect',
    ]);
    const wrongName = greenhouse();
    wrongName.conclusions.how.culprit = "mia";
    expect(issues(wrongName)).toEqual([
      "conclusions: Exactly one conclusion names the culprit, not 2",
      'conclusions.how.culprit: Conclusion "how" must name the culprit',
    ]);
  });

  it("rejects a conclusion sharing an ID with a clue, and a hint from someone else", () => {
    const graph = greenhouse();
    graph.conclusions.clue_snapped_bench = { text: "Shadowed.", rule: "clue_welly_prints" };
    set(graph, "clues.clue_hale_toby_upset.reached.gate.line.hinted_by", "react_toby_trainers");
    expect(issues(graph)).toEqual([
      'clues.clue_hale_toby_upset.reached.gate.line.hinted_by: Reference "react_toby_trainers" must name another tell from "hale"',
      'conclusions.clue_snapped_bench: Conclusion "clue_snapped_bench" shares its ID with a clue',
    ]);
  });

  it("never takes an inherited name for a reference", () => {
    const graph = greenhouse();
    graph.opening.location = "constructor";
    set(graph, "clues.clue_ladder_tape.source.location", "toString");
    graph.conclusions.how.rule = "toString";
    graph.conclusions.thorne_cleared.clears = "valueOf";
    set(graph, "clues.toby_no_key.reached.prompted_by", ["hasOwnProperty"]);
    expect(issues(graph)).toEqual([
      'opening.location: Reference "constructor" must name a location',
      'clues.clue_ladder_tape.source.location: Reference "toString" must name a location',
      'clues.toby_no_key.reached.prompted_by.0: Reference "hasOwnProperty" must name another clue',
      'conclusions.thorne_cleared: Reference "valueOf" must name a character',
      'conclusions.how.rule: Reference "toString" must name a clue or conclusion',
    ]);
  });

  it("rejects taking back a statement only reached after it", () => {
    const graph = greenhouse();
    set(graph, "clues.toby_no_key.reached.prompted_by", ["toby_confession"]);
    expect(issues(graph)).toEqual([
      'clues.toby_confession.takes_back: Clue "toby_confession" takes back "toby_no_key", which is only reached after it',
    ]);
  });

  it("stops at a spot listed twice", () => {
    const graph = greenhouse();
    graph.locations.greenhouse.spots[3].name = "the smashed pumpkin";
    expect(issues(graph)).toEqual([
      'locations.greenhouse.spots.3.name: Spot "the smashed pumpkin" is listed twice',
      'clues.clue_key_in_water_butt.source.spot: Spot "the water butt by the door" must be one of "greenhouse"\'s spots',
    ]);
  });

  it("rejects a conclusion that rests on itself", () => {
    const graph = greenhouse();
    graph.conclusions.nobody_broke_in.rule = { all: ["clue_glass_outside", "prints_explained"] };
    expect(issues(graph)).toEqual([
      'conclusions.nobody_broke_in.rule: Conclusion "nobody_broke_in" rests on itself: nobody_broke_in → prints_explained → nobody_broke_in',
      'conclusions.prints_explained.rule: Conclusion "prints_explained" rests on itself: prints_explained → nobody_broke_in → prints_explained',
    ]);
  });
});

describe("the culprit route", () => {
  it("gives only the greeting to a talk started on the last turn", () => {
    const graph = greenhouse();
    graph.metadata.time_budget = 2;
    expect(cheapestRoute(graph, "clue_dobbs_crash_time")).toBeNull();
    expect(cheapestRoute(graph, "react_dobbs_slippers")).toBe(2);
    graph.metadata.time_budget = 3;
    expect(cheapestRoute(graph, "clue_dobbs_crash_time")).toBe(2);
  });

  it("gives a last-turn greeting only its first three first words", () => {
    const graph = greenhouse();
    graph.metadata.time_budget = 2;
    expect(cheapestRoute(graph, "toby_blames_thorne")).toBe(2);
    expect(cheapestRoute(graph, "clue_toby_thorne_ladder")).toBeNull();
    graph.metadata.time_budget = 3;
    expect(cheapestRoute(graph, "clue_toby_thorne_ladder")).toBe(2);
  });

  it("stays quick on a case with every spot stocked", () => {
    // Fills every empty spot and plain search with a clue nothing needs.
    const graph = greenhouse();
    const taken = new Set(
      Object.values(graph.clues).flatMap((entry) =>
        entry.kind === "evidence" ? [`${entry.source.location}|${entry.source.spot ?? ""}`] : [],
      ),
    );
    for (const [location, place] of Object.entries(graph.locations))
      for (const spot of [undefined, ...place.spots.map((entry) => entry.name)])
        if (!taken.has(`${location}|${spot ?? ""}`))
          graph.clues[`filler_${location}_${spot ?? "plain"}`] = {
            kind: "evidence",
            fact: "Nothing much.",
            source: spot === undefined ? { location } : { location, spot },
          };
    const story = { all: ["toby_confession", "thorne_cleared", "motive", "how"] };
    graph.metadata.time_budget = 9;
    expect(cheapestRoute(graph, story)).toBeNull();
    graph.metadata.time_budget = 30;
    expect(cheapestRoute(graph, { all: Object.keys(graph.clues) })).toBe(26);
    graph.metadata.time_budget = 4;
    expect(issues(graph)).toEqual([
      'metadata.time_budget: Conclusion "culprit_toby" has no route within 4 turns without a bluff',
    ]);
  });

  it("keeps its bound sound past the alternatives it tracks", () => {
    const graph = greenhouse();
    expect(cheapestRoute(graph, { any: Object.keys(graph.clues).reverse() })).toBe(1);
    const pairs = ["clue_welly_prints", "clue_rota_purple_ink", "clue_spare_key_book", "clue_ladder_tape"].map(
      (far) => ({ any: [far, "clue_boot_prints", "clue_glass_outside"] }),
    );
    expect(cheapestRoute(graph, { all: [...pairs, ...pairs.map((pair) => ({ any: pair.any.slice(1) }))] })).toBe(1);
  });

  it("still counts a statement once it is taken back", () => {
    const graph = greenhouse();
    expect(cheapestRoute(graph, "thorne_never_set_foot")).toBe(2);
    expect(cheapestRoute(graph, { all: ["thorne_never_set_foot", "clue_thorne_measured"] })).toBe(3);
  });

  it("finds a route a conversation could pass by taking a clue back", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_thorne_measured.reached.gate.use.any", ["clue_toby_thorne_ladder"]);
    set(graph, "clues.thorne_ladder_thursday.reached.gate.use.any", ["react_toby_trainers"]);
    expect(cheapestRoute(graph, { all: ["thorne_never_set_foot", "thorne_ladder_thursday"] })).toBe(4);
  });

});

describe("the clue graph schema", () => {
  it.each([
    ["an agenda", (graph: ClueGraphCase) => set(graph, "characters.toby.agendas", [{ type: "self_protect" }]), "characters.toby"],
    ["V2 tells", (graph: ClueGraphCase) => set(graph, "characters.toby.tells", [{ trigger: "key", behavior: "fidgets" }]), "characters.toby"],
    ["a part", (graph: ClueGraphCase) => set(graph, "clues.toby_drops_burglar.reached.gate.parts", [{ clue_ids: ["clue_glass_outside"] }]), "clues.toby_drops_burglar.reached.gate"],
    ["a conditional reveal", (graph: ClueGraphCase) => set(graph, "clues.toby_confession.reached", { by: "conditional_reveal", unlock: "toby_not_mia" }), "clues.toby_confession.reached.by"],
    ["an unknown field", (graph: ClueGraphCase) => set(graph, "leads", []), ""],
  ])("rejects %s", (_name, breakIt, at) => {
    const graph = greenhouse();
    breakIt(graph);
    const result = ClueGraphCaseSchema.safeParse(graph);
    expect(result.success).toBe(false);
    expect(result.error!.issues.map((issue) => issue.path.join("."))).toContain(at);
  });

  it.each([
    ["a false statement without why", (graph: ClueGraphCase) => set(graph, "clues.toby_alibi.why"), "clues.toby_alibi.why", "A false statement says why it is false"],
    ["a true statement with why", (graph: ClueGraphCase) => set(graph, "clues.mia_alibi.why", "Because."), "clues.mia_alibi.why", "Only a false statement carries why"],
    ["an ungated statement taking back", (graph: ClueGraphCase) => set(graph, "clues.dobbs_rounds.takes_back", ["toby_alibi"]), "clues.dobbs_rounds.takes_back", "Only a gated statement takes back earlier statements"],
    ["a seen tell naming both", (graph: ClueGraphCase) => set(graph, "clues.react_mia_pen.reached.subject", "shifts"), "clues.react_mia_pen.reached", "A seen tell names one statement (with) or one subject"],
    ["an empty gate", (graph: ClueGraphCase) => set(graph, "clues.toby_confession.reached.gate", {}), "clues.toby_confession.reached.gate", "A gate needs after, use or line"],
    ["a character without demeanor", (graph: ClueGraphCase) => set(graph, "characters.dobbs.demeanor", {}), "characters.dobbs.demeanor", "At least one stance needs a demeanor line"],
    ["a conclusion clearing and naming", (graph: ClueGraphCase) => set(graph, "conclusions.mia_cleared.culprit", "toby"), "conclusions.mia_cleared", "A conclusion clears, names the culprit or resolves, at most one"],
    ["a clue named opening", (graph: ClueGraphCase) => set(graph, "clues.opening", graph.clues.clue_boot_prints), "clues", 'Clue ID "opening" is reserved for the opening'],
    ["an empty map", (graph: ClueGraphCase) => set(graph, "conclusions", {}), "conclusions", "Must not be empty"],
    ["a duplicate reference", (graph: ClueGraphCase) => set(graph, "clues.toby_confession.reached.gate.after", ["toby_not_mia", "toby_not_mia"]), "clues.toby_confession.reached.gate.after.1", 'Duplicate reference "toby_not_mia"'],
  ])("rejects %s", (_name, breakIt, at, message) => {
    const graph = greenhouse();
    breakIt(graph);
    const result = ClueGraphCaseSchema.safeParse(graph);
    expect(result.error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`)).toContain(`${at}: ${message}`);
  });
});

describe("the clue graph/2 case file", () => {
  const artwork = {
    visual_direction: {
      art_style: "soft watercolour",
      color_palette: "leaf green, pumpkin orange, cream",
      mood: "cosy, with a hint of suspense",
      lighting: "early morning sun through glass",
    },
    cover: { facts: ["Big Bertha lies smashed in the greenhouse."], locations: ["greenhouse"], characters: ["toby", "hale"] },
  };

  it("rejects a clue-graph/1 file, naming the format", () => {
    const old = { ...greenhouse(), format: "clue-graph/1" };
    expect(issues(old)).toContain('format: Format "clue-graph/1" is not read: a case file is "clue-graph/2"');
  });

  it("rejects the clue-graph/1 fields", () => {
    const graph = greenhouse();
    set(graph, "clues.clue_boot_prints.text", "Huge boot prints.");
    set(graph, "locations.workshop.description", "A workshop.");
    const paths = ClueGraphCaseSchema.safeParse(graph).error!.issues.map((issue) => issue.path.join("."));
    expect(paths).toEqual(expect.arrayContaining(["clues.clue_boot_prints", "locations.workshop"]));
  });

  it("parses a case with knows, appearance, motive and both artwork fields", () => {
    const graph = { ...greenhouse(), ...artwork };
    expect(issues(graph)).toEqual([]);
    const parsed = validateClueGraph(graph);
    expect(parsed.characters.toby.knows[1]).toEqual({
      fact: "Mr. Thorne grows a giant pumpkin called Goliath next door.",
      points_at: { character: "thorne" },
    });
    expect(parsed.truth.motive).toMatch(/^Bertha was Toby's pumpkin/);
    expect(parsed.cover?.characters).toEqual(["toby", "hale"]);
  });

  it("parses a case with neither artwork field", () => {
    const graph = greenhouse();
    expect(graph.visual_direction).toBeUndefined();
    expect(graph.cover).toBeUndefined();
    expect(issues(graph)).toEqual([]);
  });

  it.each([
    ["one appearance fact", (graph: ClueGraphCase) => set(graph, "characters.dobbs.appearance", ["Old."]), "characters.dobbs.appearance"],
    ["no motive", (graph: ClueGraphCase) => set(graph, "truth.motive"), "truth.motive"],
    ["a pointer at two things", (graph: ClueGraphCase) => set(graph, "characters.toby.knows.0.points_at", { location: "greenhouse", character: "hale" }), "characters.toby.knows.0.points_at"],
    ["an empty cover", (graph: ClueGraphCase) => set(graph, "cover", { facts: [] }), "cover.facts"],
    ["unknown visual direction", (graph: ClueGraphCase) => set(graph, "visual_direction", { ...artwork.visual_direction, font: "serif" }), "visual_direction"],
  ])("rejects %s", (_name, breakIt, at) => {
    const graph = greenhouse();
    breakIt(graph);
    expect(ClueGraphCaseSchema.safeParse(graph).error?.issues.map((issue) => issue.path.join("."))).toContain(at);
  });

  it("rejects a pointer or a cover naming nothing in the case", () => {
    const graph = { ...greenhouse(), cover: { facts: ["A pumpkin."], locations: ["moon"], characters: ["ghost"] } };
    set(graph, "characters.toby.knows.0.points_at", { location: "attic" });
    set(graph, "characters.toby.knows.1.points_at", { character: "nobody" });
    expect(issues(graph)).toEqual([
      'characters.toby.knows.0.points_at.location: Reference "attic" must name a location',
      'characters.toby.knows.1.points_at.character: Reference "nobody" must name a character',
      'cover.locations.0: Reference "moon" must name a location',
      'cover.characters.0: Reference "ghost" must name a character',
    ]);
  });

  it("gives the world view its facts, appearance, motive and artwork", () => {
    const view = buildClueGraphBlueprint(validateClueGraph({ ...greenhouse(), ...artwork }));
    expect(view.schema_version).toBe("clue-graph/2");
    expect(view.world.locations.find((place) => place.id === "workshop")?.description).toBe(
      committed.locations.workshop.facts.join(" "),
    );
    expect(view.world.characters.find((person) => person.id === "dobbs")?.appearance).toBe(
      "Mr. Dobbs is an old man in brown overalls. He wears slippers indoors.",
    );
    expect(view.ground_truth.why_it_happened).toBe(committed.truth.motive);
    expect(view.metadata.visual_direction).toEqual(artwork.visual_direction);
    expect(view.cover_image).toEqual({
      description: "Big Bertha lies smashed in the greenhouse.",
      location_ids: ["greenhouse"],
      character_ids: ["toby", "hale"],
    });
    expect(buildClueGraphBlueprint(committed).cover_image.description).toBe(committed.metadata.title);
  });
});

describe("the clue graph command", () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, ["scripts/validate-clue-graph.mjs", ...args], {
      encoding: "utf8",
      timeout: 5000,
    });
  }

  it("validates a file, and reports invalid cases, file errors and usage apart", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-"));
    const file = path.join(dir, "case.json");
    try {
      expect(run([GREENHOUSE])).toMatchObject({
        status: 0,
        stdout: `OK: ${GREENHOUSE} (clue-graph/2, 39 clues, 8 conclusions)\n`,
      });
      const broken = greenhouse();
      broken.metadata.time_budget = 4;
      fs.writeFileSync(file, JSON.stringify(broken));
      expect(run([file])).toMatchObject({
        status: 1,
        stderr: expect.stringContaining('["metadata","time_budget"]: Conclusion "culprit_toby"'),
      });
      fs.writeFileSync(file, JSON.stringify({ ...greenhouse(), format: "clue-graph/1" }));
      expect(run([file])).toMatchObject({
        status: 1,
        stderr: expect.stringContaining('["format"]: Format "clue-graph/1" is not read: a case file is "clue-graph/2"'),
      });
      fs.writeFileSync(file, "{");
      expect(run([file])).toMatchObject({ status: 2, stderr: expect.stringContaining(file) });
      fs.writeFileSync(file, '{"format": "clue-graph/2", "format": "clue-graph/2"}');
      expect(run([file])).toMatchObject({ status: 2, stderr: expect.stringContaining("Duplicate JSON key") });
      expect(run([path.join(dir, "missing.json")])).toMatchObject({
        status: 2,
        stderr: expect.stringContaining("ENOENT"),
      });
      expect(run([])).toMatchObject({ status: 3, stderr: expect.stringContaining("usage:") });
      expect(run([file, "extra"])).toMatchObject({ status: 3 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
