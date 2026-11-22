// The validator's checks for generated stories (`docs/clue-graph.md`,
// "Validation" and "Sizes"): each broken fixture fails for its reason alone,
// both hand-written stories pass, and a case of each size passes at its floors
// and fails one count off them.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  ClueGraphCaseSchema,
  culpritRoutes,
  measureCase,
  SIZE_COUNTS,
  SIZE_TABLE,
  sizeBounds,
  validateClueGraph,
  type ClueGraphCase,
  type ClueGraphSize,
  type SizeCount,
} from "@my2/shared";
import { floors, sizedCase } from "./fixtures/clue-graph-sized.ts";

const load = (file: string) => validateClueGraph(JSON.parse(fs.readFileSync(`blueprints/clue-graph/${file}.json`, "utf8")));
const GREENHOUSE = load("greenhouse-prizewinner");
const DRAGON = load("dragon-crown");
const greenhouse = (): ClueGraphCase => structuredClone(GREENHOUSE);
const dragon = (): ClueGraphCase => structuredClone(DRAGON);

function issues(value: unknown): string[] {
  try {
    validateClueGraph(value);
    return [];
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
  }
}

/** The clue at `id`, to edit in place. */
function clue(graph: ClueGraphCase, id: string): Record<string, unknown> {
  return graph.clues[id] as unknown as Record<string, unknown>;
}

describe("the hand-written stories", () => {
  it("pass, each with routes to the culprit with and without the confession", () => {
    expect(culpritRoutes(GREENHOUSE)).toEqual([
      { clues: ["toby_confession"], confession: true, turns: 6 },
      { clues: ["clue_welly_prints", "clue_dobbs_crash_time", "clue_thorne_mia_cake"], confession: false, turns: 5 },
      {
        clues: [
          "clue_glass_outside",
          "clue_key_in_water_butt",
          "clue_spare_key_book",
          "clue_hale_key_last_seen",
          "clue_dobbs_crash_time",
          "clue_thorne_mia_cake",
        ],
        confession: false,
        turns: 8,
      },
    ]);
    expect(culpritRoutes(DRAGON).map((route) => route.confession)).toEqual([true, false, false]);
  });

  it("declare no size, so fit none and are checked for none", () => {
    expect(GREENHOUSE.metadata.size).toBeUndefined();
    expect(DRAGON.metadata.size).toBeUndefined();
    // Sam's alibi for Nina is the dragon crown's false alibi for someone else.
    expect(measureCase(DRAGON)).toMatchObject({ false_alibis: 1, hidden_spots: 1, shortest_route: 2 });
    expect(measureCase(GREENHOUSE)).toMatchObject({ false_alibis: 0, cleared_on_every_route: 1 });
  });

  it("counts a false alibi only where a route without the confession draws on it", () => {
    const graph = dragon();
    // Mr. Pike's sighting of Nina no longer follows from Sam taking his alibi back.
    clue(graph, "clue_pike_saw_nina").reached = { by: "asked", about: "Nina at lunchtime", prompted_by: ["nina_admits_practising"] };
    expect(issues(graph)).toEqual([]);
    expect(measureCase(graph).false_alibis).toBe(0);
  });
});

describe("the story checks", () => {
  it("rejects a suspect cleared only on a statement later taken back", () => {
    const graph = dragon();
    // Nina's lasting clearing still reasons, but clears no one.
    delete graph.conclusions.nina_cleared.clears;
    expect(issues(graph)).toEqual([
      'characters.nina: Suspect "nina" is cleared only on statements later taken back',
    ]);
  });

  it("rejects a culprit with one route", () => {
    const graph = greenhouse();
    graph.conclusions.culprit_toby.rule = { all: ["clue_welly_prints", "mia_cleared"] };
    clue(graph, "clue_spare_key_book").colour = true;
    expect(issues(graph)).toEqual([
      'conclusions.culprit_toby.rule: Conclusion "culprit_toby" has one route to the culprit within the turn budget; it needs two',
    ]);
  });

  it("rejects a culprit whose every route needs the confession", () => {
    const graph = greenhouse();
    // Toby clearing Mia is his own admission, so it counts as the confession.
    graph.conclusions.culprit_toby.rule = { any: ["toby_confession", { all: ["toby_not_mia", "clue_welly_prints"] }] };
    clue(graph, "clue_spare_key_book").colour = true;
    expect(issues(graph)).toEqual([
      'conclusions.culprit_toby.rule: Conclusion "culprit_toby" has no route within the turn budget without the confession',
    ]);
  });

  it("counts a route that needs the confession on the way as needing it", () => {
    const graph = greenhouse();
    // A hammer under the bench, which only Toby's confession points to.
    graph.locations.greenhouse.spots.push({ name: "under the potting bench", revealed_by: "toby_confession" });
    graph.clues.clue_hammer = {
      kind: "evidence",
      fact: "A hammer with Toby's name taped to the handle lies under the potting bench.",
      source: { location: "greenhouse", spot: "under the potting bench" },
    };
    const hammerRoutes = [{ all: ["clue_hammer", "clue_welly_prints"] }, { all: ["clue_hammer", "mia_cleared"] }];
    graph.conclusions.culprit_toby.rule = { any: hammerRoutes };
    clue(graph, "clue_spare_key_book").colour = true;
    expect(culpritRoutes(graph).map((route) => route.confession)).toEqual([true, true]);
    expect(issues(graph)).toEqual([
      'conclusions.culprit_toby.rule: Conclusion "culprit_toby" has no route within the turn budget without the confession',
    ]);
    // With the welly prints alone as a third way, one route is free of it.
    graph.conclusions.culprit_toby.rule = { any: [...hammerRoutes, { all: ["clue_welly_prints", "mia_cleared"] }] };
    expect(culpritRoutes(graph).map(({ clues, confession }) => [clues.length, confession])).toEqual([
      [2, true],
      [3, true],
      [3, false],
    ]);
    expect(issues(graph)).toEqual([]);
  });

  it("reports a culprit rule with more routes than it checks", () => {
    const graph = greenhouse();
    const evidence = Object.keys(graph.clues).slice(0, 18);
    graph.conclusions.culprit_toby.rule = {
      any: ["toby_confession", { all: [0, 1, 2, 3, 4, 5, 6, 7, 8].map((pair) => ({ any: evidence.slice(pair * 2, pair * 2 + 2) })) }],
    };
    expect(issues(graph)).toContain(
      'conclusions.culprit_toby.rule: Conclusion "culprit_toby" has more than 256 routes to the culprit, too many to check',
    );
  });

  it("rejects a story where more than four clues in five are free", () => {
    const shape = { ...floors("small"), clues: 16 };
    const graph = sizedCase(shape);
    for (const [id, entry] of Object.entries(graph.clues))
      if (entry.kind === "tell") clue(graph, id).reached = { by: "seen", subject: "the weather" };
    expect(issues(graph)).toEqual(["clues: 13 of 16 clues are free from the opening; at most four in five may be"]);
    // Four in five is still fair.
    delete graph.clues[Object.keys(graph.clues).find((id) => id.startsWith("colour_"))!];
    expect(issues(graph)).toEqual([]);
  });

  it("rejects a character with more first words than a greeting carries", () => {
    const graph = greenhouse();
    clue(graph, "react_toby_trainers").reached = { by: "first_meeting" };
    expect(issues(graph)).toEqual(['characters.toby: Character "toby" has 4 first words; a greeting carries 3']);
  });

  it("rejects a clue nothing depends on unless it is marked colour, and colour on a clue something needs", () => {
    const graph = greenhouse();
    delete clue(graph, "dobbs_rounds").colour;
    clue(graph, "clue_glass_outside").colour = true;
    expect(issues(graph)).toEqual([
      'clues.clue_glass_outside.colour: Clue "clue_glass_outside" is marked colour, but something depends on it',
      'clues.dobbs_rounds: Clue "dobbs_rounds" supports, opens and prompts nothing, and is not marked colour',
    ]);
  });

  it("rejects a gate the character's own statements open", () => {
    const graph = greenhouse();
    // Mr. Thorne admits measuring when shown the boot prints, or now his own alibi.
    clue(graph, "clue_thorne_measured").reached = {
      by: "gated",
      gate: { after: ["thorne_never_set_foot"], use: { any: ["clue_boot_prints", "thorne_alibi"] } },
    };
    expect(issues(graph)).toEqual([
      'clues.clue_thorne_measured.reached.gate: Clue "clue_thorne_measured" opens on "thorne"\'s own statements alone',
    ]);
  });

  it("keeps a line of questioning hinted by the character's own tell, which needs the investigator's words", () => {
    // Nina's practising opens on a line her own card-hiding hints at.
    expect(DRAGON.clues.nina_admits_practising).toMatchObject({
      reached: { gate: { line: { hinted_by: "react_nina_cards" } } },
    });
  });
});

const PATHS: Record<SizeCount, string> = {
  time_budget: "metadata.time_budget",
  locations: "locations",
  suspects: "characters",
  witnesses: "characters",
  clues: "clues",
  gated_clues: "clues",
  false_statements: "clues",
  hidden_spots: "locations",
  shortest_route: "conclusions.culprit_named.rule",
  culprit_routes: "conclusions.culprit_named.rule",
  false_alibis: "clues",
  cleared_on_every_route: "conclusions.culprit_named.rule",
};

describe.each(["small", "medium", "large"] as ClueGraphSize[])("a %s case", (size) => {
  it("passes at its floors, measured as built", () => {
    const graph = sizedCase(floors(size), size);
    expect(issues(graph)).toEqual([]);
    expect(measureCase(graph)).toEqual(floors(size));
  });

  const below = SIZE_COUNTS.filter((name) => SIZE_TABLE[size][name].min > 0);
  it.each(below)("fails with %s one below its floor", (name) => {
    const shape = { ...floors(size), [name]: floors(size)[name] - 1 };
    const graph = sizedCase(shape, size);
    expect(measureCase(graph)[name]).toBe(shape[name]);
    const found = issues(graph).filter((issue) => issue.includes(`a ${size} case needs`));
    expect(found).toEqual([expect.stringMatching(new RegExp(`^${PATHS[name]}: Has ${shape[name]} `))]);
    // A culprit left one route also fails the check every case has.
    if (name !== "culprit_routes") expect(issues(graph)).toEqual(found);
  });

  const capped = SIZE_COUNTS.filter((name) => SIZE_TABLE[size][name].max !== undefined);
  it.each(capped)("fails with %s one above its range", (name) => {
    const shape = { ...floors(size), [name]: SIZE_TABLE[size][name].max! + 1 };
    expect(issues(sizedCase(shape, size))).toEqual([
      expect.stringMatching(new RegExp(`^${PATHS[name]}: Has ${shape[name]} .*; a ${size} case needs`)),
    ]);
  });
});

describe("size overrides", () => {
  it("change only the count they name", () => {
    expect(sizeBounds("medium", { clues: { min: 20 } })).toEqual({ ...SIZE_TABLE.medium, clues: { min: 20 } });
    const shape = { ...floors("small"), time_budget: 10 };
    const graph = sizedCase(shape, "small");
    expect(issues(graph)).toEqual(["metadata.time_budget: Has 10 turns; a small case needs exactly 8"]);
    graph.metadata.size_overrides = { time_budget: { min: 10, max: 10 } };
    expect(issues(graph)).toEqual([]);
    const thin = sizedCase({ ...shape, locations: 2 }, "small");
    thin.metadata.size_overrides = { time_budget: { min: 9 } };
    expect(issues(thin)).toEqual(["locations: Has 2 locations; a small case needs exactly 3"]);
    thin.metadata.size_overrides.time_budget = { min: 11 };
    expect(issues(thin)).toEqual([
      "metadata.time_budget: Has 10 turns; metadata.size_overrides.time_budget needs at least 11",
      "locations: Has 2 locations; a small case needs exactly 3",
    ]);
  });

  it("are rejected without a size, past their range, or for a count there is not", () => {
    const parse = (metadata: object) =>
      ClueGraphCaseSchema.safeParse({ ...GREENHOUSE, metadata: { ...GREENHOUSE.metadata, ...metadata } })
        .error?.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    expect(parse({ size_overrides: { clues: { min: 3 } } })).toEqual(["metadata.size_overrides: Size overrides need a size"]);
    expect(parse({ size: "small", size_overrides: { clues: { min: 3, max: 2 } } })).toEqual([
      "metadata.size_overrides.clues: max must not be below min",
    ]);
    expect(parse({ size: "small", size_overrides: { rooms: { min: 3 } } })?.[0]).toMatch(/^metadata.size_overrides: Unrecognized key/);
    expect(parse({ size: "huge" })?.[0]).toMatch(/^metadata.size: /);
  });

  it("leave a case with no size unchecked for size", () => {
    expect(issues(sizedCase({ ...floors("small"), locations: 9, clues: 30 }))).toEqual([]);
  });
});

describe("the clue graph command on a size check", () => {
  it("exits 1, naming the field", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-size-"));
    const file = path.join(dir, "case.json");
    try {
      fs.writeFileSync(file, JSON.stringify(sizedCase({ ...floors("medium"), hidden_spots: 0 }, "medium")));
      expect(
        spawnSync(process.execPath, ["scripts/validate-clue-graph.mjs", file], { encoding: "utf8", timeout: 5000 }),
      ).toMatchObject({
        status: 1,
        stderr: '["locations"]: Has 0 hidden spots; a medium case needs at least 1\n',
      });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
