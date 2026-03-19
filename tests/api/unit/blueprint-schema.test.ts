import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { BlueprintSchema } from "../../../packages/shared/src/blueprint-schema.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

const ROOT_DIR = process.cwd();

async function loadCanonicalBlueprints() {
  const sourceDirs = ["blueprints", "supabase/seed/blueprints"];
  const results = [];

  for (const relativeDir of sourceDirs) {
    const absoluteDir = path.join(ROOT_DIR, relativeDir);
    const entries = await readdir(absoluteDir, { withFileTypes: true }).catch(() => []);

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      const filePath = path.join(absoluteDir, entry.name);
      results.push({
        filePath,
        payload: JSON.parse(await readFile(filePath, "utf-8")),
      });
    }
  }

  return results;
}

describe("shared blueprint schema", () => {
  it("accepts all canonical blueprint fixtures", async () => {
    const fixtures = await loadCanonicalBlueprints();
    expect(fixtures.length).toBeGreaterThan(0);

    for (const fixture of fixtures) {
      expect(() => BlueprintSchema.parse(fixture.payload)).not.toThrow();
    }
  });

  it("rejects malformed blueprints", () => {
    expect(() =>
      BlueprintSchema.parse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        metadata: {
          title: "Broken Blueprint",
          one_liner: "Missing the rest of the schema",
          target_age: 8,
          time_budget: 10,
        },
      })
    ).toThrow();
  });

  it("does not accept Blueprint V2 authoring payloads", () => {
    expect(() => BlueprintSchema.parse(validBlueprintV2)).toThrow();
  });
});
