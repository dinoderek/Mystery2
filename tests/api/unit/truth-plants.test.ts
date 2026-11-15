import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { loadTruthSet, TRUTH_ROOT } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { applyPatch, changedPaths, isWithin, PatchError } from "../../../evaluation/lib/truth/patch.ts";
import { verifyPlants } from "../../../evaluation/lib/truth/plant-checks.ts";
import type { PlantReport } from "../../../evaluation/lib/truth/plant-checks.ts";
import { buildBlueprintVariant, buildGameVariant, PlantError } from "../../../evaluation/lib/truth/plants.ts";
import type { NamedBlueprintPlant, NamedTurnVariant } from "../../../evaluation/lib/truth/plants.ts";
import type { PatchOp, StoredGame, TurnPlant } from "../../../evaluation/lib/truth/schemas.ts";
import { BlueprintPlantSchema, TurnVariantSchema, parseTruthFile } from "../../../evaluation/lib/truth/schemas.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function copyFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "truth-plants-"));
  scratch.push(dir);
  await fs.cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** The parts of a stored file these tests change or read. */
interface VariantFile {
  game: string;
  plants: { sequence: number; kind: string; severity: string; note: string; edits: Record<string, unknown>[]; caught_by: string[] }[];
}
interface PlantFile {
  base: string;
  kind: string;
  judge: string;
  note: string;
  patch: Record<string, unknown>[];
  caught_by: string[];
}
interface BlueprintFile {
  narrative: { premise: string };
  suspect_elimination_paths: { character_clue_ids: string[] }[];
}

async function readJson<T>(file: string): Promise<T> {
  return JSON.parse(await fs.readFile(file, "utf8")) as T;
}

const VARIANT_FILE = "plants/turns/medal-leak.json";
const PLANT_FILE = "plants/blueprints/mock-bob-not-ruled-out.json";

const readVariant = () => readJson<VariantFile>(path.join(FIXTURE, VARIANT_FILE));
const readPlant = () => readJson<PlantFile>(path.join(FIXTURE, PLANT_FILE));

let fixtureSet: TruthSet;
let baseGame: StoredGame;
let baseBlueprint: BlueprintFile;
beforeAll(async () => {
  fixtureSet = await loadTruthSet(FIXTURE);
  baseGame = fixtureSet.games[0].trace;
  baseBlueprint = await readJson<BlueprintFile>(path.join(FIXTURE, "bases/mock/blueprint.json"));
});

async function fixture(): Promise<TruthSet> {
  return fixtureSet;
}

async function game(): Promise<StoredGame> {
  return baseGame;
}

async function variantOf(id: string): Promise<NamedTurnVariant> {
  const variant = (await fixture()).turnVariants.find((candidate) => candidate.id === id);
  if (!variant) throw new Error(`no fixture variant ${id}`);
  return variant;
}

function plantOn(sequence: number, edits: TurnPlant["edits"]): TurnPlant {
  return { sequence, kind: "fabrication", severity: "minor", note: "a plant", edits, caught_by: [] };
}

function variantWith(...plants: TurnPlant[]): NamedTurnVariant {
  return { id: "made-up", game: "medal", plants };
}

function eventOf(trace: StoredGame, sequence: number): StoredGame["events"][number] {
  const event = trace.events.find((candidate) => candidate.sequence === sequence);
  if (!event) throw new Error(`no turn ${sequence}`);
  return event;
}

function thrownBy(run: () => unknown): Error {
  try {
    run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("applying a patch", () => {
  const document = { a: { b: [1, 2, 3], "x/y": "slash", "m~n": "tilde" }, name: "n" };

  it("applies each operation to a copy and leaves the original alone", () => {
    const ops: PatchOp[] = [
      { op: "test", path: "/name", value: "n" },
      { op: "replace", path: "/name", value: "m" },
      { op: "add", path: "/a/c", value: true },
      { op: "remove", path: "/a/x~1y" },
      { op: "replace", path: "/a/m~0n", value: "swapped" },
    ];
    const { value } = applyPatch(document, ops);
    expect(value).toEqual({ a: { b: [1, 2, 3], c: true, "m~n": "swapped" }, name: "m" });
    expect(document.name).toBe("n");
  });

  it("inserts into and removes from arrays, and reports the array as touched", () => {
    const inserted = applyPatch(document, [{ op: "add", path: "/a/b/1", value: 9 }, { op: "add", path: "/a/b/-", value: 10 }]);
    expect(inserted.value.a.b).toEqual([1, 9, 2, 3, 10]);
    expect(inserted.touched).toEqual(["/a/b"]);
    const removed = applyPatch(document, [{ op: "remove", path: "/a/b/0" }]);
    expect(removed.value.a.b).toEqual([2, 3]);
    expect(changedPaths(document, removed.value).every((place) => removed.touched.some((at) => isWithin(place, at)))).toBe(true);
  });

  it("touches what a replace and an add on an object name, and nothing for a test", () => {
    expect(applyPatch(document, [{ op: "test", path: "/name", value: "n" }]).touched).toEqual([]);
    expect(applyPatch(document, [{ op: "replace", path: "/a/b/2", value: 0 }]).touched).toEqual(["/a/b/2"]);
    expect(applyPatch(document, [{ op: "add", path: "/a/c", value: 0 }]).touched).toEqual(["/a/c"]);
  });

  it.each<[string, PatchOp, string]>([
    ["a test that does not hold", { op: "test", path: "/name", value: "other" }, 'operation 1 (test /name): expected "other", found "n"'],
    ["a test of nothing", { op: "test", path: "/missing", value: 1 }, "nothing there"],
    ["a replace of nothing", { op: "replace", path: "/a/missing", value: 1 }, "nothing there"],
    ["a remove of nothing", { op: "remove", path: "/a/b/7" }, "nothing there"],
    ["an add under nothing", { op: "add", path: "/nowhere/x", value: 1 }, 'nothing at "nowhere" on the way'],
    ["an add under a string", { op: "add", path: "/name/x", value: 1 }, "the parent is not an object or array"],
    ["an add past the end of an array", { op: "add", path: "/a/b/9", value: 1 }, "not a place in an array of 3"],
    ["an add at an array's key that is not an index", { op: "add", path: "/a/b/first", value: 1 }, "not a place in an array of 3"],
  ])("fails on %s", (_, op, message) => {
    const error = thrownBy(() => applyPatch(document, [op]));
    expect(error).toBeInstanceOf(PatchError);
    expect(error.message).toContain(message);
  });

  it("finds the pointers where two documents differ", () => {
    expect(changedPaths(document, structuredClone(document))).toEqual([]);
    expect(changedPaths({ a: [1, 2], b: 1 }, { a: [1, 3], c: 1 })).toEqual(["/a/1", "/b", "/c"]);
    expect(changedPaths({ a: [1, 2] }, { a: [1] })).toEqual(["/a"]);
    expect(changedPaths({ "x/y": 1 }, { "x/y": 2 })).toEqual(["/x~1y"]);
    expect(changedPaths(1, "one")).toEqual([""]);
    expect(isWithin("/a/b", "/a")).toBe(true);
    expect(isWithin("/ab", "/a")).toBe(false);
  });
});

describe("planting a turn", () => {
  it("applies a narration edit to the turn's narration", async () => {
    const base = await game();
    const { trace } = buildGameVariant(base, await variantOf("medal-spoiler"));
    expect(eventOf(trace, 4).narration).toBe('"I saw Dorn take the medal and slip toward the garden," Mara says.');
    expect(eventOf(base, 4).narration).toBe('"I saw a shadow slip toward the garden," Mara says.');
  });

  it("applies a narration edit to each narration part that holds the words", async () => {
    const base = structuredClone(await game());
    const event = eventOf(base, 3);
    event.narration_parts = [{ text: "Mara wipes her hands", speaker: { kind: "narrator" } }, { text: "She looks up." }];
    const variant = variantWith(plantOn(3, [{ type: "narration", find: "wipes her hands", replace: "dries her hands" }]));
    const { trace, plants } = buildGameVariant(base, variant);
    expect(eventOf(trace, 3).narration).toBe("Mara dries her hands and looks up.");
    expect(eventOf(trace, 3).narration_parts).toEqual([{ text: "Mara dries her hands", speaker: { kind: "narrator" } }, { text: "She looks up." }]);
    expect(plants[0].touched).toEqual(["/events/2/narration", "/events/2/narration_parts/0/text"]);
  });

  it("applies a recorded-field edit, such as a revealed clue id", async () => {
    const { trace, plants } = buildGameVariant(await game(), await variantOf("medal-spoiler"));
    expect(eventOf(trace, 7).payload).not.toHaveProperty("revealed_clue_id");
    expect(eventOf(trace, 7).payload?.revealed_clue_ids).toEqual([]);
    expect(plants.map((plant) => plant.sequence)).toEqual([4, 7]);
  });

  it("builds the same bytes every time, and never changes its base", async () => {
    const base = await game();
    const before = JSON.stringify(base);
    const variant = await variantOf("medal-spoiler");
    expect(JSON.stringify(buildGameVariant(base, variant).trace)).toBe(JSON.stringify(buildGameVariant(base, variant).trace));
    expect(JSON.stringify(base)).toBe(before);
  });

  it("fails, naming the plant, when its text is not in the turn or is in it twice", async () => {
    const base = structuredClone(await game());
    eventOf(base, 3).narration = "Mara looks up, then looks up again.";
    const missing = thrownBy(() => buildGameVariant(base, variantWith(plantOn(4, [{ type: "narration", find: "a thief", replace: "x" }]))));
    expect(missing).toBeInstanceOf(PlantError);
    expect(missing.message).toBe('variant "made-up", turn 4 (fabrication): the text "a thief" is not in the narration');
    const twice = thrownBy(() => buildGameVariant(base, variantWith(plantOn(3, [{ type: "narration", find: "looks up", replace: "x" }]))));
    expect(twice.message).toContain('turn 3 (fabrication): the text "looks up" is in the narration 2 times');
  });

  it("fails, naming the plant, when a test or a path of its patch is not in the turn", async () => {
    const base = await game();
    const wrongValue = plantOn(7, [{ type: "patch", ops: [{ op: "test", path: "/payload/revealed_clue_id", value: "clue_other" }] }]);
    expect(thrownBy(() => buildGameVariant(base, variantWith(wrongValue))).message).toContain(
      'variant "made-up", turn 7 (fabrication): edit 1: operation 1 (test /payload/revealed_clue_id): expected "clue_other", found "clue_garden_1"',
    );
    const noPath = plantOn(7, [{ type: "patch", ops: [{ op: "test", path: "/payload/missing", value: 1 }] }]);
    expect(thrownBy(() => buildGameVariant(base, variantWith(noPath))).message).toContain("turn 7 (fabrication): edit 1: operation 1 (test /payload/missing): nothing there");
  });

  it("fails, naming the plant, on a turn the game does not have", async () => {
    const error = thrownBy(() => buildGameVariant(structuredClone(baseGame), variantWith(plantOn(99, [{ type: "narration", find: "a", replace: "b" }]))));
    expect(error.message).toBe('variant "made-up", turn 99 (fabrication): the game has no turn 99');
  });

  it("fails, naming the plant, on a second plant on one turn", async () => {
    const edit: TurnPlant["edits"] = [{ type: "narration", find: "Mara", replace: "Maria" }];
    const variant = variantWith(plantOn(3, edit), plantOn(3, edit));
    expect(thrownBy(() => buildGameVariant(baseGame, variant)).message).toBe(
      'variant "made-up", turn 3 (fabrication): turn 3 already has a plant; a turn takes one',
    );
    const file = thrownBy(() => parseTruthFile(TurnVariantSchema, { game: "medal", plants: variant.plants }, "plants/turns/made-up.json")).message;
    expect(file).toContain("plants/turns/made-up.json: plants.1.sequence: turn 3 already has a plant");
  });

  it("fails when an edit changes what names the turn, or leaves a game no reader accepts", async () => {
    const rename = plantOn(3, [{ type: "patch", ops: [{ op: "test", path: "/sequence", value: 3 }, { op: "replace", path: "/sequence", value: 30 }] }]);
    expect(thrownBy(() => buildGameVariant(baseGame, variantWith(rename))).message).toContain("an edit changed the turn's sequence");
    const invalid = plantOn(3, [{ type: "patch", ops: [{ op: "test", path: "/narration", value: eventOf(baseGame, 3).narration }, { op: "replace", path: "/narration", value: 5 }] }]);
    expect(thrownBy(() => buildGameVariant(baseGame, variantWith(invalid))).message).toContain(
      'variant "made-up": the result is not a valid subject: events.2.narration: Expected string, received number',
    );
  });
});

describe("planting a blueprint", () => {
  const patchOf = (ops: PatchOp[]): NamedBlueprintPlant => ({
    id: "made-up",
    base: "mock",
    kind: "fairness",
    judge: "fairness",
    note: "a plant",
    patch: ops as NamedBlueprintPlant["patch"],
    caught_by: [],
  });

  it("applies the patch to a copy of the base", async () => {
    const original = structuredClone(baseBlueprint);
    const plant = (await fixture()).blueprintPlants[0];
    const { blueprint, touched } = buildBlueprintVariant(original, plant);
    expect((blueprint as BlueprintFile).suspect_elimination_paths[0].character_clue_ids).toEqual([]);
    expect(original.suspect_elimination_paths[0].character_clue_ids).toEqual(["clue-alice-saw-bob"]);
    expect(touched).toEqual(["/suspect_elimination_paths/0/character_clue_ids"]);
    expect(JSON.stringify(buildBlueprintVariant(original, plant).blueprint)).toBe(JSON.stringify(blueprint));
  });

  it("fails, naming the plant, when its target is not in the base", async () => {
    const error = thrownBy(() =>
      buildBlueprintVariant(structuredClone(baseBlueprint), patchOf([{ op: "test", path: "/metadata/title", value: "Another Title" }])),
    );
    expect(error).toBeInstanceOf(PlantError);
    expect(error.message).toBe(
      'plant "made-up" (fairness) on base "mock": operation 1 (test /metadata/title): expected "Another Title", found "Mock Blueprint"',
    );
  });

  it("fails, naming the plant, when the patch breaks the schema", async () => {
    const error = thrownBy(() =>
      buildBlueprintVariant(
        baseBlueprint,
        patchOf([
          { op: "test", path: "/metadata/target_age", value: 10 },
          { op: "replace", path: "/metadata/target_age", value: "ten" },
        ]),
      ),
    );
    expect(error.message).toContain('plant "made-up" (fairness) on base "mock": the result is not a valid subject: metadata.target_age:');
  });

  it("is a plant file the schema takes only with its record of checks", async () => {
    const plant = await readPlant();
    const without: Partial<PlantFile> = { ...plant };
    delete without.caught_by;
    expect(thrownBy(() => parseTruthFile(BlueprintPlantSchema, without, "plant.json")).message).toContain("caught_by: Required");
    expect(thrownBy(() => parseTruthFile(BlueprintPlantSchema, { ...plant, caught_by: ["a", "a"] }, "plant.json")).message).toContain(
      "caught_by: a check is named once",
    );
  });
});

function reportOf(reports: PlantReport[], plant: string): PlantReport {
  const report = reports.find((candidate) => candidate.plant === plant);
  if (!report) throw new Error(`no report for ${plant}: ${reports.map((candidate) => candidate.plant).join(", ")}`);
  return report;
}

describe("checking the plants", () => {
  it("records a plant that copies ground truth verbatim as caught by spoiler_leak, and one no check sees as caught by none", async () => {
    const reports = await verifyPlants(await fixture());
    expect(reportOf(reports, "medal-leak@3")).toEqual({ plant: "medal-leak@3", caughtBy: ["spoiler_leak"], problems: [] });
    expect(reportOf(reports, "medal-spoiler@4")).toEqual({ plant: "medal-spoiler@4", caughtBy: [], problems: [] });
    expect(reportOf(reports, "medal-spoiler@7")).toEqual({ plant: "medal-spoiler@7", caughtBy: [], problems: [] });
  });

  it("records the checks that newly report a blueprint plant, and none when none does", async () => {
    const reports = await verifyPlants(await fixture());
    expect(reportOf(reports, "mock-bob-not-ruled-out")).toEqual({
      plant: "mock-bob-not-ruled-out",
      caughtBy: ["no_orphan_clues"],
      problems: [],
    });
  });

  /** The fixture with a plant file written over, then checked. */
  async function checked(file: string, plant: unknown): Promise<PlantReport[]> {
    const dir = await copyFixture();
    await writeJson(path.join(dir, file), plant);
    return verifyPlants(await loadTruthSet(dir));
  }

  it("fails a record that is not what the checks report now, naming both", async () => {
    const variant = await readVariant();
    variant.plants[0].caught_by = [];
    expect(reportOf(await checked("plants/turns/medal-leak.json", variant), "medal-leak@3").problems).toEqual([
      "caught_by records none; the checks report spoiler_leak now",
    ]);
    const plant = await readPlant();
    plant.caught_by = ["fairness.analyzer", "no_orphan_clues"];
    expect(reportOf(await checked("plants/blueprints/mock-bob-not-ruled-out.json", plant), "mock-bob-not-ruled-out").problems).toEqual([
      "caught_by records fairness.analyzer, no_orphan_clues; the checks report no_orphan_clues now",
    ]);
  });

  it("records the reading-level check on a planted turn", async () => {
    const hard = "Notwithstanding unprecedented circumstances, Mara conscientiously reconsidered everything incomprehensible.";
    const variant = await readVariant();
    variant.plants = [{ ...variant.plants[0], kind: "not_age_fit", edits: [{ type: "narration", find: "Mara wipes her hands and looks up.", replace: hard }], caught_by: ["flesch"] }];
    expect(reportOf(await checked("plants/turns/medal-leak.json", variant), "medal-leak@3")).toEqual({ plant: "medal-leak@3", caughtBy: ["flesch"], problems: [] });
  });

  const HARD = "The unprecedented disappearance of extraordinarily delicious confectionery necessitated comprehensive investigation by representatives.";

  async function premisePlant(caughtBy: string[]): Promise<PlantFile> {
    const plant = await readPlant();
    return {
      ...plant,
      kind: "age_appropriate",
      judge: "age_appropriate",
      patch: [
        { op: "test", path: "/narrative/premise", value: "Someone stole the cookies." },
        { op: "replace", path: "/narrative/premise", value: HARD },
      ],
      caught_by: caughtBy,
    };
  }

  it("records an analyzer that newly fails a blueprint", async () => {
    const reports = await checked("plants/blueprints/mock-bob-not-ruled-out.json", await premisePlant(["age_appropriate.analyzer"]));
    expect(reportOf(reports, "mock-bob-not-ruled-out")).toEqual({
      plant: "mock-bob-not-ruled-out",
      caughtBy: ["age_appropriate.analyzer"],
      problems: [],
    });
  });

  it("does not count a check that already fails on the base", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "bases/mock/blueprint.json");
    const base = await readJson<BlueprintFile>(file);
    base.narrative.premise = HARD;
    await writeJson(file, base);
    const plant = await premisePlant([]);
    plant.patch = [
      { op: "test", path: "/metadata/one_liner", value: "A simple test mystery." },
      { op: "replace", path: "/metadata/one_liner", value: "A simple test puzzle." },
    ];
    await writeJson(path.join(dir, "plants/blueprints/mock-bob-not-ruled-out.json"), plant);
    expect(reportOf(await verifyPlants(await loadTruthSet(dir)), "mock-bob-not-ruled-out")).toEqual({
      plant: "mock-bob-not-ruled-out",
      caughtBy: [],
      problems: [],
    });
  });

  it("records none for a blueprint plant no check sees", async () => {
    const plant = await readPlant();
    const edited = {
      ...plant,
      patch: [
        { op: "test", path: "/metadata/one_liner", value: "A simple test mystery." },
        { op: "replace", path: "/metadata/one_liner", value: "A simple test puzzle." },
      ],
      caught_by: [],
    };
    expect(reportOf(await checked("plants/blueprints/mock-bob-not-ruled-out.json", edited), "mock-bob-not-ruled-out").problems).toEqual([]);
  });

  it("does not count a trace check that already fails on the game", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "games/medal/trace.json");
    const trace = await readJson<{ events: { sequence: number; narration: string }[] }>(file);
    const hard = "Notwithstanding unprecedented circumstances, Mara conscientiously reconsidered everything incomprehensible.";
    const turn = trace.events.find((event) => event.sequence === 3);
    if (!turn) throw new Error("no turn 3");
    turn.narration = `${hard} Mara wipes her hands and looks up.`;
    await writeJson(file, trace);
    const variant = await readVariant();
    variant.plants[0].edits = [{ type: "narration", find: "wipes her hands", replace: "dries her hands" }];
    variant.plants[0].caught_by = [];
    await writeJson(path.join(dir, VARIANT_FILE), variant);
    expect(reportOf(await verifyPlants(await loadTruthSet(dir)), "medal-leak@3")).toEqual({ plant: "medal-leak@3", caughtBy: [], problems: [] });
  });

  it("fails a plant that changes nothing", async () => {
    const variant = await readVariant();
    variant.plants[0].edits = [{ type: "narration", find: "Mara wipes her hands and looks up.", replace: "Mara wipes her hands and looks up." }];
    variant.plants[0].caught_by = [];
    expect(reportOf(await checked("plants/turns/medal-leak.json", variant), "medal-leak@3").problems).toContain("changes nothing");
    const plant = await readPlant();
    plant.patch = [{ op: "test", path: "/metadata/title", value: "Mock Blueprint" }, { op: "replace", path: "/metadata/title", value: "Mock Blueprint" }];
    plant.caught_by = [];
    expect(reportOf(await checked("plants/blueprints/mock-bob-not-ruled-out.json", plant), "mock-bob-not-ruled-out").problems).toContain("changes nothing");
  });

  it("fails a plant that stops the game reconstructing", async () => {
    const variant = await readVariant();
    variant.plants = [
      { ...variant.plants[0], sequence: 6, edits: [{ type: "patch", ops: [{ op: "test", path: "/payload/location_id", value: "loc_garden" }, { op: "replace", path: "/payload/location_id", value: "loc_nowhere" }] }], caught_by: [] },
    ];
    const reports = await checked("plants/turns/medal-leak.json", variant);
    expect(reportOf(reports, "medal-leak").problems[0]).toContain("no longer reconstructs: turn 6:");
  });

  it("names a plant that cannot be applied, and the stored game it was written against", async () => {
    const variant = await readVariant();
    variant.plants[0].edits[0].find = "Mara never says this.";
    const [report] = await checked("plants/turns/medal-leak.json", variant);
    expect(report.plant).toBe("medal-leak");
    expect(report.problems).toEqual(['variant "medal-leak", turn 3 (spoiler): the text "Mara never says this." is not in the narration']);
    const plant = await readPlant();
    plant.patch[0].value = "clue-nobody";
    expect(reportOf(await checked("plants/blueprints/mock-bob-not-ruled-out.json", plant), "mock-bob-not-ruled-out").problems[0]).toContain(
      'plant "mock-bob-not-ruled-out" (fairness) on base "mock": operation 1 (test /suspect_elimination_paths/0/character_clue_ids/0)',
    );
  });
});

describe("the plants in the truth set", () => {
  function problemsIn(reports: PlantReport[]): string[] {
    return reports.flatMap((report) => report.problems.map((problem) => `${report.plant}: ${problem}`));
  }

  it("all apply, stay valid subjects and match their record of checks, in the real set", async () => {
    const set = await loadTruthSet(path.join(repoRoot(), TRUTH_ROOT));
    const reports = await verifyPlants(set);
    expect(problemsIn(reports)).toEqual([]);
    // Every plant is reported once, so none is skipped.
    const plants = set.turnVariants.reduce((sum, variant) => sum + variant.plants.length, 0) + set.blueprintPlants.length;
    expect(plants).toBeGreaterThan(0);
    expect(reports).toHaveLength(plants);
  });

  it("all apply, stay valid subjects and match their record of checks, in the fixture", async () => {
    const reports = await verifyPlants(await fixture());
    expect(problemsIn(reports)).toEqual([]);
    expect(reports.map((report) => report.plant)).toEqual(["medal-leak@3", "medal-spoiler@4", "medal-spoiler@7", "mock-bob-not-ruled-out"]);
  });
});
