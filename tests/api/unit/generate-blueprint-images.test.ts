import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadImageGenerationEnv,
  parseGenerateImageArgs,
  resolveBlueprintPath,
  runImageGeneration,
} from "../../../scripts/generate-blueprint-images.mjs";

const blueprintFixture = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  schema_version: "v2",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple mystery",
    target_age: 8,
    time_budget: 10,
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: [],
  },
  world: {
    starting_location_id: "Kitchen",
    locations: [{ name: "Kitchen", description: "A kitchen", clues: [] }],
    characters: [
      {
        first_name: "Alice",
        last_name: "Smith",
        location: "Kitchen",
        sex: "female",
        appearance: "Red hair",
        background: "Baker",
        personality: "Nervous",
        initial_attitude_towards_investigator: "guarded",
        location_id: "Kitchen",
        mystery_action_real: "Ate cookies",
        stated_alibi: "Reading",
        motive: "Hungry",
        is_culprit: true,
        knowledge: [],
      },
    ],
  },
  ground_truth: {
    what_happened: "Alice ate the cookies.",
    why_it_happened: "Hungry.",
    timeline: [],
  },
};

describe("generate-blueprint-images args parser", () => {
  it("parses selective target options", () => {
    const parsed = parseGenerateImageArgs([
      "--blueprint-path",
      "/tmp/mock.json",
      "--output-dir",
      "/tmp/out",
      "--model",
      "openai/gpt-image-1",
      "--character",
      "Alice",
      "--location",
      "Kitchen",
      "--overwrite",
    ]);

    expect(parsed).toMatchObject({
      blueprintPath: "/tmp/mock.json",
      outputDir: "/tmp/out",
      model: "openai/gpt-image-1",
      scope: "selected",
      overwrite: true,
      characterKeys: ["Alice"],
      locationKeys: ["Kitchen"],
    });
  });

  it("accepts empty blueprint path from args (validation deferred to resolveBlueprintPath)", () => {
    const parsed = parseGenerateImageArgs([]);
    expect(parsed.blueprintPath).toBe("");
  });

  it("parses dry mode flag", () => {
    const parsed = parseGenerateImageArgs([
      "--blueprint-path",
      "/tmp/mock.json",
      "--output-dir",
      "/tmp/out",
      "--model",
      "openai/gpt-image-1",
      "--dry-mode",
    ]);

    expect(parsed.dryMode).toBe(true);
  });

  it("parses --parallel flag", () => {
    const parsed = parseGenerateImageArgs([
      "--blueprint-path",
      "/tmp/mock.json",
      "--output-dir",
      "/tmp/out",
      "--parallel",
    ]);

    expect(parsed.parallel).toBe(true);
  });

  it("defaults parallel to false", () => {
    const parsed = parseGenerateImageArgs([
      "--blueprint-path",
      "/tmp/mock.json",
      "--output-dir",
      "/tmp/out",
    ]);

    expect(parsed.parallel).toBe(false);
  });

  it("uses env-backed model defaults when --model is omitted", () => {
    const parsed = parseGenerateImageArgs(
      [
        "--blueprint-path",
        "/tmp/mock.json",
        "--output-dir",
        "/tmp/out",
      ],
      { OPENROUTER_IMAGE_MODEL: "openai/custom-image-model" },
    );

    expect(parsed.model).toBe("openai/custom-image-model");
  });

  it("keeps explicit --model higher priority than env", () => {
    const parsed = parseGenerateImageArgs(
      [
        "--blueprint-path",
        "/tmp/mock.json",
        "--output-dir",
        "/tmp/out",
        "--model",
        "openai/cli-model",
      ],
      { OPENROUTER_IMAGE_MODEL: "openai/env-model" },
    );

    expect(parsed.model).toBe("openai/cli-model");
  });
});

describe("resolveBlueprintPath", () => {
  it("throws when value is empty", async () => {
    await expect(resolveBlueprintPath("")).rejects.toThrow(
      "Missing required --blueprint-path",
    );
  });

  it("returns absolute paths as-is", async () => {
    const result = await resolveBlueprintPath("/absolute/path/to/bp.json");
    expect(result).toBe("/absolute/path/to/bp.json");
  });

  it("resolves relative path via configRoot/blueprints when the file exists there", async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "bp-resolve-"));
    const blueprintsDir = path.join(configRoot, "blueprints");
    await mkdir(blueprintsDir, { recursive: true });
    await writeFile(path.join(blueprintsDir, "my-mystery.json"), "{}", "utf-8");

    const result = await resolveBlueprintPath("my-mystery.json", "/dummy", {
      MYSTERY_CONFIG_ROOT: configRoot,
    });

    expect(result).toBe(path.join(blueprintsDir, "my-mystery.json"));
  });

  it("falls back to the literal relative path when not found in configRoot/blueprints", async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "bp-resolve-miss-"));
    await mkdir(path.join(configRoot, "blueprints"), { recursive: true });

    const result = await resolveBlueprintPath("missing.json", "/dummy", {
      MYSTERY_CONFIG_ROOT: configRoot,
    });

    expect(result).toBe("missing.json");
  });
});

describe("loadImageGenerationEnv", () => {
  it("loads image env first, then falls back to .env.local, with shell env overrides", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-env-"));

    await writeFile(
      path.join(tmpDir, ".env.local"),
      'OPENROUTER_API_KEY="root-key"\nOPENROUTER_IMAGE_MODEL="root-model"\n',
      "utf-8",
    );
    await writeFile(
      path.join(tmpDir, ".env.images.local"),
      'OPENROUTER_API_KEY="image-key"\nOPENROUTER_IMAGE_MODEL="image-model"\n',
      "utf-8",
    );

    const env = await loadImageGenerationEnv(tmpDir, {
      OPENROUTER_API_KEY: "shell-key",
      OPENROUTER_IMAGE_MODEL: "shell-model",
    });

    expect(env.OPENROUTER_API_KEY).toBe("shell-key");
    expect(env.OPENROUTER_IMAGE_MODEL).toBe("shell-model");
  });

  it("falls back to .env.local when image env file is absent", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-env-root-"));

    await writeFile(
      path.join(tmpDir, ".env.local"),
      'OPENROUTER_API_KEY="root-key"\nOPENROUTER_IMAGE_MODEL="root-model"\n',
      "utf-8",
    );

    const env = await loadImageGenerationEnv(tmpDir, {});

    expect(env.OPENROUTER_API_KEY).toBe("root-key");
    expect(env.OPENROUTER_IMAGE_MODEL).toBe("root-model");
  });

  it("reads local env files only from the external config root when configured", async () => {
    const repoDir = await mkdtemp(path.join(os.tmpdir(), "image-env-repo-"));
    const configRoot = await mkdtemp(path.join(os.tmpdir(), "image-env-shared-"));

    await writeFile(
      path.join(repoDir, ".env.local"),
      'OPENROUTER_API_KEY="repo-root-key"\nOPENROUTER_IMAGE_MODEL="repo-root-model"\n',
      "utf-8",
    );
    await writeFile(
      path.join(repoDir, ".env.images.local"),
      'OPENROUTER_API_KEY="repo-image-key"\nOPENROUTER_IMAGE_MODEL="repo-image-model"\n',
      "utf-8",
    );
    await writeFile(
      path.join(configRoot, ".env.local"),
      'OPENROUTER_API_KEY="shared-root-key"\nOPENROUTER_IMAGE_MODEL="shared-root-model"\n',
      "utf-8",
    );
    await writeFile(
      path.join(configRoot, ".env.images.local"),
      'OPENROUTER_API_KEY="shared-image-key"\nOPENROUTER_IMAGE_MODEL="shared-image-model"\n',
      "utf-8",
    );

    const env = await loadImageGenerationEnv(repoDir, {
      MYSTERY_CONFIG_ROOT: configRoot,
    });

    expect(env.OPENROUTER_API_KEY).toBe("shared-image-key");
    expect(env.OPENROUTER_IMAGE_MODEL).toBe("shared-image-model");
  });
});

describe("runImageGeneration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs dry-run flow without mutating references", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const result = await runImageGeneration({
      blueprintPath,
      outputDir,
      model: "openai/gpt-image-1",
      scope: "all",
      overwrite: false,
      dryRun: true,
      characterKeys: [],
      locationKeys: [],
    });

    expect(result.blueprint_id).toBe(blueprintFixture.id);
    expect(result.results.length).toBe(3);
    expect(
      result.results.every((entry: { status: string }) => entry.status === "skipped"),
    ).toBe(true);

    const patched = JSON.parse(await readFile(blueprintPath, "utf-8"));
    expect(patched.metadata.image_id).toBeUndefined();
    expect(patched.world.locations[0].location_image_id).toBeUndefined();
    expect(patched.world.characters[0].portrait_image_id).toBeUndefined();
  });

  it("captures provider response details and stack traces for failed targets", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-error-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                error: {
                  message: "Route not found",
                  trace_id: "trace-404-abc",
                },
              }),
              {
                status: 404,
                statusText: "Not Found",
                headers: { "Content-Type": "application/json" },
              },
            ),
          ),
      },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      target_type: "blueprint",
      status: "failed",
      image_id: null,
      file_path: null,
    });
    expect(result.results[0].error_message).toContain("ImageGenerationError: OpenRouter image generation failed (404)");
    expect(result.results[0].error_message).toContain("HTTP status: 404 Not Found");
    expect(result.results[0].error_message).toContain("trace-404-abc");
    expect(result.results[0].error_message).toContain("Stack:");
  });

  it("captures timeout failures for long-running image generation requests", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-timeout-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        env: { AI_OPENROUTER_TIMEOUT_MS: "1000" },
        fetchImpl: () => Promise.reject(new DOMException("Aborted", "AbortError")),
      },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      target_type: "blueprint",
      status: "failed",
    });
    expect(result.results[0].error_message).toContain(
      "OpenRouter image generation timed out after 1000ms",
    );
    expect(result.results[0].error_message).toContain("Phase: generation");
  });

  it("uses OpenRouter chat completions image response format", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-chat-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        fetchImpl: (url: string | URL, init?: RequestInit) => {
          calls.push({
            url: String(url),
            body: JSON.parse(String(init?.body ?? "{}")),
          });
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      images: [
                        {
                          image_url: {
                            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        },
      },
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect(calls[0].body.model).toBe("openai/gpt-image-1");
    expect(calls[0].body.modalities).toEqual(["image", "text"]);
    expect(calls[0].body.image_config).toEqual({ aspect_ratio: "4:3" });
    expect(result.results[0].status).toBe("generated");
  });

  it("prints prompts and request parameters in dry mode without calling fetch", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-dry-mode-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const fetchImpl = vi.fn();

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        dryMode: true,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        fetchImpl,
      },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.results).toHaveLength(1);
    expect(result.results[0].status).toBe("skipped");
    expect(result.results[0].error_message).toBe("dry-mode");

    const renderedLogs = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(renderedLogs).toContain("[generate] Blueprint");
    expect(renderedLogs).toContain("[dry-mode] Blueprint:");
    expect(renderedLogs).toContain("\"url\": \"https://openrouter.ai/api/v1/chat/completions\"");
    expect(renderedLogs).toContain("\"model\": \"openai/gpt-image-1\"");
    expect(renderedLogs).toContain("\"modalities\": [");
    expect(renderedLogs).toContain("Target: Mystery cover image.");

    const patched = JSON.parse(await readFile(blueprintPath, "utf-8"));
    expect(patched.metadata.image_id).toBeUndefined();
  });

  it("uses env-provided key when dependency injection is absent", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-env-key-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const fetchImpl = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  images: [
                    {
                      image_url: {
                        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
                      },
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      )
    );

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        env: { OPENROUTER_API_KEY: "env-key" },
        fetchImpl,
      },
    );

    expect(fetchImpl).toHaveBeenCalled();
    expect(result.results[0].status).toBe("generated");
  });

  it("names output files as <blueprint-name>.<image-id>.png", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-filename-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "blueprint",
        overwrite: true,
        dryRun: false,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        fetchImpl: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      images: [
                        {
                          image_url: {
                            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          ),
      },
    );

    expect(result.results[0].status).toBe("generated");
    const filePath = result.results[0].file_path;
    const fileName = path.basename(filePath);
    // Filename IS the image_id (includes .png extension)
    expect(fileName).toBe(result.results[0].image_id);
    expect(fileName).toMatch(/\.png$/);
  });

  it("generates all targets in parallel when parallel option is set", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-parallel-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    const callOrder: string[] = [];
    const result = await runImageGeneration(
      {
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "all",
        overwrite: true,
        dryRun: false,
        parallel: true,
        characterKeys: [],
        locationKeys: [],
      },
      {
        apiKey: "test-key",
        fetchImpl: (url: string | URL) => {
          callOrder.push(String(url));
          return Promise.resolve(
            new Response(
              JSON.stringify({
                choices: [
                  {
                    message: {
                      images: [
                        {
                          image_url: {
                            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
                          },
                        },
                      ],
                    },
                  },
                ],
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          );
        },
      },
    );

    // All 3 targets (blueprint + 1 character + 1 location) should be generated
    expect(result.results).toHaveLength(3);
    expect(result.results.every((r: { status: string }) => r.status === "generated")).toBe(true);
  });
});
