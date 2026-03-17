import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadBlueprintGenerationEnv,
  parseGenerateBlueprintArgs,
} from "../../../scripts/generate-blueprints.mjs";
import { loadBlueprintGeneratorPrompt } from "../../../scripts/lib/blueprints/generator-prompt.mjs";
import { runBlueprintGeneration } from "../../../scripts/lib/blueprints/generate-blueprints.mjs";

const VALID_BLUEPRINT = JSON.stringify(JSON.parse(
  await readFile(
    path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
    "utf-8",
  ),
));

describe("generate blueprints", () => {
  it("parses CLI args", () => {
    expect(parseGenerateBlueprintArgs([
      "--brief",
      "/tmp/brief.md",
      "--output-name",
      "cookie-caper",
      "--count",
      "2",
    ])).toMatchObject({
      briefPath: "/tmp/brief.md",
      outputName: "cookie-caper",
      count: 2,
    });
  });

  it("uses blueprint-generation model env by default", () => {
    expect(
      parseGenerateBlueprintArgs(
        ["--brief", "/tmp/brief.md", "--output-name", "cookie-caper"],
        { OPENROUTER_BLUEPRINT_GENERATION_MODEL: "openai/custom-blueprint-model" },
      ),
    ).toMatchObject({
      briefPath: "/tmp/brief.md",
      outputName: "cookie-caper",
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

  it("fails fast when OpenRouter config is missing", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "generate-blueprints-missing-key-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Mystery brief", "utf-8");

    await expect(() =>
      runBlueprintGeneration({
        briefPath,
        outputName: "cookie-caper",
        count: 1,
        model: "test-model",
      })
    ).rejects.toThrow(
      "Blueprint generation configuration error:\n- Missing OPENROUTER_API_KEY; set it in `.env.local` or shell env before running `npm run generate:blueprints`.",
    );
  });

  it("includes response details when the provider rejects the request", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "generate-blueprints-401-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Mystery brief", "utf-8");

    await expect(() =>
      runBlueprintGeneration({
        briefPath,
        outputName: "cookie-caper",
        count: 1,
        model: "test-model",
        apiKey: "bad-key",
        draftsRoot: path.join(tmpDir, "drafts"),
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: "Invalid credentials" } }),
              {
                status: 401,
                statusText: "Unauthorized",
                headers: { "Content-Type": "application/json" },
              },
            ),
          ),
      })
    ).rejects.toThrow("OpenRouter rejected the API key");
  });

  it("writes candidate blueprints and raw model output to a draft run", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "generate-blueprints-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Mystery brief", "utf-8");
    const logMessages: string[] = [];

    const result = await runBlueprintGeneration({
      briefPath,
      outputName: "Cookie Caper",
      count: 2,
      model: "test-model",
      apiKey: "test-key",
      draftsRoot: path.join(tmpDir, "drafts"),
      now: new Date("2026-03-17T12:00:00.000Z"),
      logImpl: (message: string) => {
        logMessages.push(message);
      },
      requestCandidateImpl: async ({ prompt }: { prompt: string }) =>
        prompt.includes("# Mystery brief") && resultCounter++ === 0
          ? VALID_BLUEPRINT
          : "not-json",
    });

    const files = await readdir(result.runDir);
    expect(files).toContain("cookie-caper.1.blueprint.json");
    expect(files).toContain("cookie-caper.1.verification.json");
    expect(files).toContain("cookie-caper.2.blueprint.json");
    expect(files).toContain("cookie-caper.2.verification.json");
    expect(result.results).toEqual([
      expect.objectContaining({
        index: 1,
        verificationStatus: "pass",
      }),
      expect.objectContaining({
        index: 2,
        verificationStatus: "fail",
      }),
    ]);
    expect(logMessages).toContain(
      "[blueprint-generation] Generating blueprint 1 of 2 with model test-model...",
    );
    expect(logMessages).toContain(
      "[blueprint-generation] Generating blueprint 2 of 2 with model test-model...",
    );
  });

  it("injects the Blueprint V2 schema source into the generation prompt", async () => {
    const prompt = await loadBlueprintGeneratorPrompt();

    expect(prompt).toContain("Blueprint Schema Source of Truth");
    expect(prompt).toContain("export const BlueprintSchema = z.object({");
    expect(prompt).toContain("starting_location_key");
    expect(prompt).toContain("culprit_character_key");
    expect(prompt).toContain("Do not invent legacy Blueprint V1 fields");
    expect(prompt).not.toContain("EXACTLY ONE `is_culprit: true` character");
  });
});

let resultCounter = 0;
