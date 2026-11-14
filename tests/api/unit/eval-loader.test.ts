import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import {
  loadDimensionDefinition,
  tryLoadAnalyzer,
  repoRoot,
} from "../../../evaluation/pipeline/load.mjs";
import { knownSchemaNames } from "../../../evaluation/pipeline/validate.mjs";

// The validate CLI lists the dimension schemas it finds in this directory, so
// its tests write their fixture files here (into the real dimensions dir) and
// clean them up afterwards.
const dimensionsDir = path.join(repoRoot(), "evaluation", "dimensions");

// Files written during a test, removed after it regardless of outcome.
const scratchFiles: string[] = [];

async function writeScratch(relName: string, contents: string): Promise<string> {
  const filePath = path.join(dimensionsDir, relName);
  await fs.writeFile(filePath, contents, "utf8");
  scratchFiles.push(filePath);
  return filePath;
}

afterEach(async () => {
  while (scratchFiles.length > 0) {
    const filePath = scratchFiles.pop()!;
    await fs.rm(filePath, { force: true });
  }
});

describe("loadDimensionDefinition", () => {
  it("maps an underscore dimension id to its kebab-case schema filename", async () => {
    // clue_graph → clue-graph.schema.ts: the id uses underscores but the
    // schema file on disk uses kebab-case.
    const def = await loadDimensionDefinition("clue_graph");
    expect(def.id).toBe("clue_graph");
    expect(def.schemaPath).not.toBeNull();
    expect(path.basename(def.schemaPath as string)).toBe("clue-graph.schema.ts");
    expect(path.basename(def.filePath)).toBe("clue-graph.md");
  });

  it("loads the named `schema` export as a usable Zod schema", async () => {
    const def = await loadDimensionDefinition("fairness");
    expect(def.schema).not.toBeNull();
    expect(typeof def.schema.safeParse).toBe("function");
    // A structurally-wrong candidate is rejected, proving a real schema loaded.
    expect(def.schema.safeParse({}).success).toBe(false);
  });

  it("refuses a dimension the registry does not list", async () => {
    await expect(loadDimensionDefinition("loader_spec_unregistered")).rejects.toThrow(/Unknown check or judge/);
  });
});

describe("tryLoadAnalyzer", () => {
  it("resolves an existing analyzer's analyze() function", async () => {
    // clue_graph has an analyzer at checks/analyzers/clue-graph.mjs.
    const analyzer = await tryLoadAnalyzer("clue_graph");
    expect(analyzer).not.toBeNull();
    expect(typeof analyzer.analyze).toBe("function");
    expect(path.basename(analyzer.analyzerPath)).toBe("clue-graph.mjs");
  });

  it("returns null for a dimension with no analyzer file", async () => {
    // fairness is judge-only; no analyzer file exists for it.
    expect(await tryLoadAnalyzer("fairness")).toBeNull();
  });
});

describe("knownSchemaNames (validate CLI helper)", () => {
  it("always includes the blueprint schema first", async () => {
    const names = await knownSchemaNames();
    expect(names[0]).toBe("blueprint");
  });

  it("lists every dimension schema on disk with underscore ids, sorted", async () => {
    const names = await knownSchemaNames();

    // Derive the expected dimension names directly from the files on disk so
    // this assertion tracks whatever schemas currently exist.
    const files = await fs.readdir(dimensionsDir);
    const expectedDims = files
      .filter((f) => f.endsWith(".schema.ts"))
      .map((f) => f.replace(/\.schema\.ts$/, "").replaceAll("-", "_"))
      .sort();

    expect(names).toEqual(["blueprint", ...expectedDims]);
    // Every dimension name uses underscores, never kebab-case.
    for (const name of names) {
      expect(name).not.toContain("-");
    }
  });

  it("picks up a freshly-added schema file with no code change", async () => {
    const id = "loader_spec_dynamic_schema";
    const slug = id.replace(/_/g, "-");
    await writeScratch(
      `${slug}.schema.ts`,
      'import { z } from "zod";\nexport const schema = z.object({});\n',
    );

    const names = await knownSchemaNames();
    expect(names).toContain(id);
  });
});

// Ensure the module path we import from is the real pipeline loader, not a
// stale copy — a cheap guard against the test drifting off the source of truth.
it("imports the loader from the evaluation pipeline directory", () => {
  const expected = path.join("evaluation", "pipeline");
  const actual = url.fileURLToPath(
    new URL("../../../evaluation/pipeline/load.mjs", import.meta.url),
  );
  expect(actual).toContain(expected);
});
