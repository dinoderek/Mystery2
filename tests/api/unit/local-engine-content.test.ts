// The local `ContentStore` — blueprints and images read straight off disk.
//
// Two behaviours matter here and are easy to lose: one unparseable blueprint
// is skipped and logged rather than failing the whole catalog, and a blueprint
// filed under a name other than `<id>.json` is still found.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalContentStore,
  resolveImageFile,
} from "../../../packages/game-engine/src/content.ts";
import type { LogWriter } from "../../../packages/game-engine/src/logging.ts";
import { clueGraphCaseId } from "../../../packages/shared/src/clue-graph-case.ts";
import { MOCK_CASE_ID, readMockCase, readMockCaseGraph } from "../../testkit/src/mock-case.ts";
import { createProceduralScene, createSceneManifest } from "../../testkit/src/fixtures.ts";

const CASE_FILE = readMockCaseGraph();
const BLUEPRINT_ID = MOCK_CASE_ID;

let tempDir: string;
let primaryDir: string;
let fallbackDir: string;
let imagesDir: string;

interface RecordedLog {
  event: string;
  details?: Record<string, unknown>;
}

function recordingLogger(): LogWriter & { entries: RecordedLog[] } {
  const entries: RecordedLog[] = [];
  return {
    entries,
    log: (event, details) => entries.push({ event, details }),
    logError: (event, details) => entries.push({ event, details }),
  };
}

function store(dirs: string[] = [primaryDir, fallbackDir], listFixtures?: boolean) {
  return createLocalContentStore({ blueprintDirs: dirs, imagesDir, sceneDirs: [path.join(tempDir, "blueprint-scenes")], listFixtures });
}

/** The mock case with every image id taken out, as a committed case is filed. */
function caseWithoutImages() {
  const graph = structuredClone(CASE_FILE);
  delete graph.metadata.image_id;
  for (const person of Object.values(graph.characters)) delete person.portrait_image_id;
  for (const place of Object.values(graph.locations)) delete place.location_image_id;
  return graph;
}

function writeBlueprint(dir: string, filename: string, overrides = {}) {
  fs.writeFileSync(
    path.join(dir, filename),
    JSON.stringify({ ...CASE_FILE, ...overrides }),
  );
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-content-"));
  primaryDir = path.join(tempDir, "blueprints");
  fallbackDir = path.join(tempDir, "seed-blueprints");
  imagesDir = path.join(tempDir, "blueprint-images");
  for (const dir of [primaryDir, fallbackDir, imagesDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("listBlueprints", () => {
  it("loads only the supported formats from the committed catalog", async () => {
    const logger = recordingLogger();
    const entries = await store([path.resolve("blueprints")]).listBlueprints(logger);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(({ blueprint }) => blueprint.schema_version === "clue-graph/2")).toBe(true);
    expect(logger.entries).toEqual([]);
  });

  it("rejects a V2 case by its format's name, as an unknown format", async () => {
    writeBlueprint(primaryDir, "v2.json", { format: undefined, schema_version: "v2" });
    const logger = recordingLogger();
    expect(await store().listBlueprints(logger)).toEqual([]);
    expect(logger.entries).toEqual([{
      event: "blueprint.parse_failed",
      details: { object: "v2.json", error: "Unknown case format: v2" },
    }]);
  });

  it("rejects an unknown tagged format by filename", async () => {
    writeBlueprint(primaryDir, "retired.json", { format: undefined, $format: "retired-case/1" });
    const logger = recordingLogger();
    expect(await store().listBlueprints(logger)).toEqual([]);
    expect(logger.entries).toEqual([{
      event: "blueprint.parse_failed",
      details: { object: "retired.json", error: "Unknown case format: retired-case/1" },
    }]);
  });

  it("returns every readable blueprint with its filename as the source", async () => {
    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`);

    expect(await store(undefined, true).listBlueprints()).toEqual([
      { blueprint: expect.objectContaining({ id: BLUEPRINT_ID }), source: `${BLUEPRINT_ID}.json` },
    ]);
  });

  it("skips an unparseable blueprint and logs it, without failing the catalog", async () => {
    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`);
    fs.writeFileSync(path.join(primaryDir, "broken.json"), "{ not json");
    fs.writeFileSync(
      path.join(primaryDir, "wrong-shape.json"),
      JSON.stringify({ id: "nope" }),
    );
    fs.writeFileSync(path.join(primaryDir, "ignored.txt"), "not a blueprint");

    const logger = recordingLogger();
    const entries = await store().listBlueprints(logger);

    expect(entries.map((entry) => entry.blueprint.id)).toEqual([BLUEPRINT_ID]);
    expect(logger.entries.map((entry) => entry.event)).toEqual([
      "blueprint.parse_failed",
      "blueprint.parse_failed",
    ]);
    expect(logger.entries[0].details).toMatchObject({ object: "broken.json" });
  });

  it("skips a clue-graph/1 case and logs it once, as an unknown format", async () => {
    const graphDir = path.join(primaryDir, "clue-graph");
    fs.mkdirSync(graphDir);
    const greenhouse = JSON.parse(fs.readFileSync("blueprints/clue-graph/greenhouse-prizewinner.json", "utf8"));
    fs.writeFileSync(path.join(graphDir, "old.json"), JSON.stringify({ ...greenhouse, format: "clue-graph/1" }));

    const logger = recordingLogger();
    expect(await store().listBlueprints(logger)).toEqual([]);
    expect(logger.entries).toEqual([
      {
        event: "blueprint.parse_failed",
        details: { object: "old.json", error: "Unknown case format: clue-graph/1" },
      },
    ]);
  });

  it("logs an unreadable blueprint once, and again only once the file changes", async () => {
    const file = path.join(primaryDir, "v2.json");
    writeBlueprint(primaryDir, "v2.json", { format: undefined, schema_version: "v2" });
    const content = store();
    const logger = recordingLogger();

    await content.listBlueprints(logger);
    await content.listBlueprints(logger);
    await content.loadBlueprint("nope", logger);
    expect(logger.entries.map((entry) => entry.event)).toEqual(["blueprint.parse_failed"]);

    writeBlueprint(primaryDir, "v2.json", { format: undefined, schema_version: "v2-edited" });
    fs.utimesSync(file, new Date(), new Date(Date.now() + 5_000));
    await content.listBlueprints(logger);
    expect(logger.entries.map((entry) => entry.details?.error)).toEqual([
      "Unknown case format: v2",
      "Unknown case format: v2-edited",
    ]);
  });

  it("marks the test fixture unlisted unless fixtures are listed, and loads it by id either way", async () => {
    writeBlueprint(primaryDir, "mock-case.json");

    expect(await store().listBlueprints()).toEqual([expect.objectContaining({ unlisted: true })]);
    expect(await store().loadBlueprint(BLUEPRINT_ID, recordingLogger())).toMatchObject({ id: BLUEPRINT_ID });
    expect((await store(undefined, true).listBlueprints())[0]).not.toHaveProperty("unlisted");
  });

  it("offers players only the generated cases from the committed catalog", async () => {
    const committed = store([path.resolve("blueprints")]);
    const listed = (await committed.listBlueprints()).filter((entry) => !entry.unlisted);

    expect(listed.map((entry) => entry.blueprint.clue_graph.metadata.id).sort()).toEqual([
      "midnight-train",
      "missing-blue-rosette",
      "the-stopped-clock",
    ]);
    expect(await committed.loadBlueprint(clueGraphCaseId("dragon-crown"), recordingLogger())).not.toBeNull();
  });

  it("fills a case's missing image ids from images filed under their conventional names", async () => {
    fs.writeFileSync(path.join(primaryDir, "mock-case.json"), JSON.stringify(caseWithoutImages()));
    const content = store();

    const bare = (await content.listBlueprints())[0].blueprint;
    expect(bare.metadata.image_id).toBeUndefined();
    expect(bare.world.characters.every((person) => person.portrait_image_id === undefined)).toBe(true);

    for (const file of ["mock-case.blueprint.png", "mock-case.character-char-alice.png", "mock-case.location-loc-kitchen.png"]) {
      fs.writeFileSync(path.join(imagesDir, file), "png");
    }
    const filed = (await content.listBlueprints())[0].blueprint;
    expect(filed.metadata.image_id).toBe("mock-case.blueprint.png");
    expect(filed.world.characters.find((person) => person.id === "char-alice")?.portrait_image_id).toBe("mock-case.character-char-alice.png");
    expect(filed.world.characters.find((person) => person.id === "char-bob")?.portrait_image_id).toBeUndefined();
    expect(filed.world.locations.find((place) => place.id === "loc-kitchen")?.location_image_id).toBe("mock-case.location-loc-kitchen.png");
  });

  it("keeps the image ids a case names over the conventional files", async () => {
    writeBlueprint(primaryDir, "mock-case.json", { metadata: { ...CASE_FILE.metadata, image_id: "named-cover.png" } });
    fs.writeFileSync(path.join(imagesDir, "mock-case.blueprint.png"), "png");

    expect((await store().listBlueprints())[0].blueprint.metadata.image_id).toBe("named-cover.png");
  });

  it("lets the first directory win when a blueprint id appears twice", async () => {
    writeBlueprint(primaryDir, "authored.json", {
      metadata: { ...CASE_FILE.metadata, title: "From the config root" },
    });
    writeBlueprint(fallbackDir, `${BLUEPRINT_ID}.json`);

    const entries = await store().listBlueprints();

    expect(entries).toHaveLength(1);
    expect(entries[0].blueprint.metadata.title).toBe("From the config root");
  });

  it("returns a stable, name-ascending order", async () => {
    // Directory read order is filesystem-dependent; the catalog must not be.
    for (const [index, name] of ["zebra", "alpha", "mango"].entries()) {
      writeBlueprint(primaryDir, `${name}.json`, {
        metadata: { ...CASE_FILE.metadata, id: `case-${index}` },
      });
    }

    expect((await store().listBlueprints()).map((entry) => entry.source)).toEqual([
      "alpha.json",
      "mango.json",
      "zebra.json",
    ]);
  });

  it("treats an absent directory as an empty one", async () => {
    expect(
      await store([path.join(tempDir, "does-not-exist")]).listBlueprints(),
    ).toEqual([]);
  });
});

describe("loadBlueprint", () => {
  it("prefers the canonical <id>.json", async () => {
    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`);

    const blueprint = await store().loadBlueprint(BLUEPRINT_ID, recordingLogger());
    expect(blueprint?.id).toBe(BLUEPRINT_ID);
  });

  it("falls back to scanning for the embedded id", async () => {
    // Authored blueprints in the config root are not named after their id.
    writeBlueprint(primaryDir, "the-missing-cookies.json");

    const blueprint = await store().loadBlueprint(BLUEPRINT_ID, recordingLogger());
    expect(blueprint?.metadata.title).toBe(CASE_FILE.metadata.title);
  });

  it("returns null for an unknown id, and for one that tries to escape the directory", async () => {
    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`);
    const logger = recordingLogger();

    expect(await store().loadBlueprint("no-such-blueprint", logger)).toBeNull();
    expect(await store().loadBlueprint("../../../etc/passwd", logger)).toBeNull();
  });

  it("picks up an edit to a blueprint without a restart", async () => {
    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`);
    const content = store();

    expect((await content.loadBlueprint(BLUEPRINT_ID, recordingLogger()))?.metadata.title)
      .toBe(CASE_FILE.metadata.title);

    writeBlueprint(primaryDir, `${BLUEPRINT_ID}.json`, {
      metadata: { ...CASE_FILE.metadata, title: "Edited In Place" },
    });
    // The cache is keyed on the file's mtime and size, and mtime has
    // millisecond resolution — make sure the size differs too.
    expect((await content.loadBlueprint(BLUEPRINT_ID, recordingLogger()))?.metadata.title)
      .toBe("Edited In Place");
  });
});

describe("resolveImageFile", () => {
  const IMAGE = "mock-blueprint.blueprint.png";

  it("resolves image bytes only for a safe filename that exists", () => {
    fs.writeFileSync(path.join(imagesDir, IMAGE), "png-bytes");

    expect(resolveImageFile(imagesDir, IMAGE)).toBe(path.join(imagesDir, IMAGE));
    expect(resolveImageFile(imagesDir, "missing.png")).toBeNull();
    expect(resolveImageFile(imagesDir, "../escape.png")).toBeNull();
  });
});

describe("loadScenes", () => {
  const blueprint = readMockCase();
  const SCENES_ID = blueprint.id;
  it("prefers configured artwork and uses committed examples only when it is absent", async () => {
    const configured = path.join(tempDir, "configured-scenes");
    const committed = path.join(tempDir, "committed-scenes");
    fs.mkdirSync(configured); fs.mkdirSync(committed);
    const content = createLocalContentStore({ blueprintDirs: [primaryDir], imagesDir, sceneDirs: [configured, committed] });
    const fallback = createSceneManifest({ blueprint_id: SCENES_ID, scenes: [createProceduralScene({ location_id: blueprint.world.locations[0].id })] });
    fs.writeFileSync(path.join(committed, `${SCENES_ID}.json`), JSON.stringify(fallback));
    expect(await content.loadScenes(blueprint)).toEqual(fallback);
    fs.writeFileSync(path.join(configured, `${SCENES_ID}.json`), JSON.stringify(createSceneManifest({ blueprint_id: SCENES_ID })));
    expect((await content.loadScenes(blueprint))?.scenes).toEqual([]);
  });
  it("returns missing artwork as null, and reloads saved public recipes after an edit", async () => {
    const content = store();
    expect(await content.loadScenes(blueprint)).toBeNull();
    const dir = path.join(tempDir, "blueprint-scenes");
    fs.mkdirSync(dir);
    const file = path.join(dir, `${SCENES_ID}.json`);
    const scene = createProceduralScene({ location_id: blueprint.world.locations[0].id });
    const manifest = createSceneManifest({ blueprint_id: SCENES_ID, scenes: [scene] });
    fs.writeFileSync(file, JSON.stringify(manifest));
    expect(await content.loadScenes(blueprint)).toEqual(manifest);
    fs.writeFileSync(file, JSON.stringify({ ...manifest, scenes: [] }));
    expect((await content.loadScenes(blueprint))?.scenes).toEqual([]);
  });

  it("rejects invalid files and references, rather than quietly hiding a broken primary asset", async () => {
    const dir = path.join(tempDir, "blueprint-scenes");
    fs.mkdirSync(dir);
    const file = path.join(dir, `${SCENES_ID}.json`);
    fs.writeFileSync(file, "not json");
    await expect(store().loadScenes(blueprint)).rejects.toThrow();
    fs.writeFileSync(file, JSON.stringify(createSceneManifest({ blueprint_id: SCENES_ID, scenes: [createProceduralScene({ location_id: "not-a-place" })] })));
    await expect(store().loadScenes(blueprint)).rejects.toThrow("Unknown scene location");
    fs.rmSync(file);
    fs.mkdirSync(file);
    await expect(store().loadScenes(blueprint)).rejects.toThrow();
    expect(await store().loadScenes({ ...blueprint, id: "../escape" })).toBeNull();
  });
});
