import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { runBlueprintGeneration } from "../../../scripts/lib/blueprints/generate-blueprints.mjs";

describe("blueprint generation flow", () => {
  it("copies the brief into a run directory and never writes top-level blueprints", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "blueprint-generation-flow-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "Generate a cozy cookie mystery.", "utf-8");

    const blueprintJson = await writeFile(
      path.join(tmpDir, "candidate.json"),
      "",
    ).then(async () => JSON.parse(
      await (await import("node:fs/promises")).readFile(
        path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
        "utf-8",
      ),
    ));

    const result = await runBlueprintGeneration({
      briefPath,
      count: 1,
      model: "test-model",
      apiKey: "test-key",
      draftsRoot: path.join(tmpDir, "drafts"),
      requestCandidateImpl: async () => JSON.stringify(blueprintJson),
    });

    const files = await readdir(result.runDir);
    expect(files).toContain("brief.md");
    expect(files).toContain("candidate-01.blueprint.json");
  });
});
