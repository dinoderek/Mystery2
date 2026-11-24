// The clue graph is the one case format. These tests hold that end to end: the
// catalog loads nothing else, the retired formats' code and names do not come
// back anywhere in the repository, the evaluation registry and commands are
// graph-only, and the truth set stays gone. Each part's own behaviour is in its
// own tests; this file guards the whole.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { REGISTRY } from "../../../evaluation/core/registry.ts";
import { createLocalContentStore } from "../../../packages/game-engine/src/content.ts";
import type { LogWriter } from "../../../packages/game-engine/src/logging.ts";
import { readMockCase, readMockCaseGraph, MOCK_CASE_ID } from "../../testkit/src/mock-case.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const THIS_FILE = path.relative(ROOT, import.meta.filename);

/** Every file git would show: tracked, plus untracked files not ignored. */
function repoFiles(): string[] {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(listed.status, listed.stderr).toBe(0);
  return listed.stdout.split("\0").filter((file) => file && fs.existsSync(path.join(ROOT, file)));
}

/** A file's text, or null for a binary file (one holding a NUL byte). */
function textOf(file: string): string | null {
  const bytes = fs.readFileSync(path.join(ROOT, file));
  return bytes.includes(0) ? null : bytes.toString("utf8");
}

function recordingLogger(): LogWriter & { errors: unknown[] } {
  const errors: unknown[] = [];
  return { errors, log: () => {}, logError: (event, details) => errors.push({ event, details }) };
}

describe("the catalog", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-one-format-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function catalog(dirs: string[]) {
    return createLocalContentStore({ blueprintDirs: dirs, imagesDir: path.join(dir, "images"), sceneDirs: [] });
  }

  it("lists every committed case, each a clue graph, and rejects none", async () => {
    const committed = fs.readdirSync(path.join(ROOT, "blueprints/clue-graph")).filter((name) => name.endsWith(".json"));
    const logger = recordingLogger();

    const entries = await catalog([path.join(ROOT, "blueprints")]).listBlueprints(logger);

    expect(fs.readdirSync(path.join(ROOT, "blueprints")).sort()).toEqual(["clue-graph"]);
    expect(entries.map(({ source }) => source).sort()).toEqual(committed.sort());
    expect(new Set(entries.map(({ blueprint }) => blueprint.schema_version))).toEqual(new Set(["clue-graph/2"]));
    expect(logger.errors).toEqual([]);
  });

  it("rejects a V2 file and an MSF file by their format's name, and still lists the clue graph beside them", async () => {
    const blueprints = path.join(dir, "blueprints");
    fs.mkdirSync(blueprints);
    fs.writeFileSync(path.join(blueprints, "case.json"), JSON.stringify(readMockCaseGraph()));
    // The headers each retired format's files carried.
    fs.writeFileSync(
      path.join(blueprints, "old-v2.json"),
      JSON.stringify({ schema_version: "v2", id: "123e4567-e89b-12d3-a456-426614174000", metadata: {}, world: {} }),
    );
    fs.writeFileSync(
      path.join(blueprints, "old-msf.json"),
      JSON.stringify({ $format: "MSF-CASE/1", paired_blueprint_id: "7c3e9a52-4f1b-4d8e-9a6c-2b5f1e8d3a47", structure: {} }),
    );
    const logger = recordingLogger();

    const entries = await catalog([blueprints]).listBlueprints(logger);

    expect(entries.map(({ blueprint }) => blueprint.id)).toEqual([MOCK_CASE_ID]);
    expect(logger.errors).toEqual([
      { event: "blueprint.parse_failed", details: { object: "old-msf.json", error: "Unknown case format: MSF-CASE/1" } },
      { event: "blueprint.parse_failed", details: { object: "old-v2.json", error: "Unknown case format: v2" } },
    ]);
  });
});

describe("the world view", () => {
  it("is the clue graph's own, with none of the old format's empty fields", () => {
    const world = readMockCase();

    for (const key of ["solution_paths", "red_herrings", "suspect_elimination_paths"]) {
      expect(world, key).not.toHaveProperty(key);
    }
    expect(Object.keys(world.narrative.starting_knowledge)).toEqual(["mystery_summary"]);
    for (const character of world.world.characters) {
      for (const key of ["last_name", "background", "stated_alibi", "motive", "flavor_knowledge", "actual_actions", "agendas", "tells"]) {
        expect(character, `${character.id}.${key}`).not.toHaveProperty(key);
      }
    }
  });
});

// A retired format's name, as code, tests or docs would spell it. The names are
// matched without regard to case, except the two type names and MSF, which is
// matched as a word part in any of its spellings (`MSF-CASE/1`, `msf_snapshot`,
// `validateMsfCaseFile`, `isMsf`) but not inside a word (`itemsFor`).
const MSF = /Msf|MSF|(?<![a-z])msf/;
const RETIRED_NAMES: readonly RegExp[] = [
  /blueprint-schema-v2/i,
  MSF,
  /mystery-structure/i,
  /PlayableBlueprint/,
  /BlueprintV2/,
  /paired experiment/i,
];

// Files allowed a retired name, each with the one name it may hold.
const ALLOWED: Readonly<Record<string, readonly RegExp[]>> = {
  [THIS_FILE]: RETIRED_NAMES,
  // Builds the last database from before saves started over, by its DDL, to
  // prove it is refused: that schema had an `msf_snapshot` column.
  "tests/api/unit/local-engine-db.test.ts": [MSF],
};

// Code and docs know one case format, so neither says "V2", in either case: a
// third-party `/v2/` in code is caught too, and needs an entry here. Tests may: they
// write the old format's tag to prove it is refused. No file under
// `evaluation/judges/` may: the turn judges state the clue graph's rules.
const V2 = /\bV2\b/i;
const V2_ALLOWED = new Set<string>([]);
const mayNameV2 = (file: string) => file.startsWith("tests/") || file.endsWith(".test.ts") || V2_ALLOWED.has(file);

// Generated, not written: a lockfile's base64 hashes hold any three letters.
const GENERATED = new Set(["package-lock.json"]);

describe("the retired formats", () => {
  it("leave the turn judges none to name", () => {
    expect([...V2_ALLOWED].filter((file) => file.startsWith("evaluation/judges/"))).toEqual([]);
    const judges = repoFiles().filter((file) => file.startsWith("evaluation/judges/"));
    expect(judges.length).toBeGreaterThan(0);
    expect(judges.filter((file) => V2.test(textOf(file) ?? ""))).toEqual([]);
  });

  it("are matched as MSF spells them, and not inside an ordinary word", () => {
    for (const name of ["MSF-CASE/1", "msf_snapshot", "msf-case.ts", "validateMsfCaseFile", "MsfCaseFile", "msfSnapshot", "isMsf"]) {
      expect(MSF.test(name), name).toBe(true);
    }
    for (const word of ["itemsFor", "paramsFrom", "termsFound", "atomsfile"]) {
      expect(MSF.test(word), word).toBe(false);
    }
  });

  it("leave no module behind", () => {
    const gone = [
      "packages/shared/src/blueprint-schema-v2.ts",
      "packages/shared/src/msf-case.ts",
      "packages/shared/src/mystery-structure-progress.ts",
      "packages/shared/src/mystery-structure-schema.ts",
      "packages/shared/src/mystery-structure-solvability.ts",
      "packages/shared/src/mystery-structure-validator.ts",
      "docs/mystery-structure.md",
      "docs/msf-gameplay.md",
    ];
    expect(gone.filter((file) => fs.existsSync(path.join(ROOT, file)))).toEqual([]);
  });

  it("are named in no file of code, tests or docs, nor in any file's path", () => {
    const hits: string[] = [];
    for (const file of repoFiles()) {
      for (const name of RETIRED_NAMES) {
        if (name.test(file)) hits.push(`path ${file}: ${name}`);
      }
      if (GENERATED.has(path.basename(file))) continue;
      const text = textOf(file);
      if (text === null) continue;
      const allowed = ALLOWED[file] ?? [];
      for (const name of RETIRED_NAMES) {
        if (!allowed.includes(name) && name.test(text)) hits.push(`${file}: ${name}`);
      }
      if (!mayNameV2(file) && V2.test(text)) hits.push(`${file}: ${V2}`);
    }
    expect(hits).toEqual([]);
  });
});

describe("evaluation", () => {
  it("registers the clue-graph check, the four clue-graph judges and the game and turn judges, and nothing else", () => {
    expect(REGISTRY.map((entry) => entry.id)).toEqual([
      "clue_graph_valid",
      "cg_soundness",
      "cg_truth_agreement",
      "cg_character_grounding",
      "cg_step_sense",
      "clue_accounting",
      "spoiler_leak",
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
      "flesch",
      "age_appropriate_turn",
      "gm_broad",
    ]);
  });

  it("has no truth set, and no command that served it", () => {
    for (const dir of ["evaluation/truth", "evaluation/lib/truth", "evaluation/label"]) {
      expect(fs.existsSync(path.join(ROOT, dir)), dir).toBe(false);
    }
    expect(COMMANDS.map((command) => command.name)).toEqual([
      "judge blueprint",
      "validate",
      "judge game",
      "judge turn",
      "cases",
      "baseline save",
      "baseline compare",
      "play",
      "report",
    ]);
  });
});
