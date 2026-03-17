import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadBlueprintGenerationEnv,
  parseGenerateBlueprintArgs,
} from "../../../scripts/generate-blueprints.mjs";
import { runBlueprintGeneration } from "../../../scripts/lib/blueprints/generate-blueprints.mjs";

const VALID_BLUEPRINT = JSON.stringify(JSON.parse(
  await readFile(
    path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
    "utf-8",
  ),
));

describe("generate blueprints", () => {
  it("parses CLI args", () => {
    expect(parseGenerateBlueprintArgs(["--brief", "/tmp/brief.md", "--count", "2"])).toMatchObject({
      briefPath: "/tmp/brief.md",
      count: 2,
    });
  });

  it("uses blueprint-generation model env by default", () => {
    expect(
      parseGenerateBlueprintArgs(
        ["--brief", "/tmp/brief.md"],
        { OPENROUTER_BLUEPRINT_GENERATION_MODEL: "openai/custom-blueprint-model" },
      ),
    ).toMatchObject({
      briefPath: "/tmp/brief.md",
      model: "openai/custom-blueprint-model",
    });
  });

  it("loads OpenRouter settings from .env.local with shell overrides", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "generate-blueprints-env-"));

    await writeFile(
      path.join(tmpDir, ".env.local"),
      [
        'OPENROUTER_API_KEY="root-key"',
        'OPENROUTER_BLUEPRINT_GENERATION_MODEL="root-model"',
      ].join("\n"),
      "utf-8",
    );

    const env = await loadBlueprintGenerationEnv(tmpDir, {
      OPENROUTER_BLUEPRINT_GENERATION_MODEL: "shell-model",
    });

    expect(env.OPENROUTER_API_KEY).toBe("root-key");
    expect(env.OPENROUTER_BLUEPRINT_GENERATION_MODEL).toBe("shell-model");
  });

  it("writes candidate blueprints and raw model output to a draft run", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "generate-blueprints-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Mystery brief", "utf-8");

    const result = await runBlueprintGeneration({
      briefPath,
      count: 2,
      model: "test-model",
      apiKey: "test-key",
      draftsRoot: path.join(tmpDir, "drafts"),
      now: new Date("2026-03-17T12:00:00.000Z"),
      requestCandidateImpl: async ({ prompt }: { prompt: string }) =>
        prompt.includes("# Mystery brief") && resultCounter++ === 0
          ? VALID_BLUEPRINT
          : "not-json",
    });

    const files = await readdir(result.runDir);
    expect(files).toContain("brief.md");
    expect(files).toContain("candidate-01.blueprint.json");
    expect(files).toContain("candidate-02.raw-model-output.txt");
  });
});

let resultCounter = 0;
