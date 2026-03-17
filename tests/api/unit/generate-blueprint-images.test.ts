import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadImageGenerationEnv,
  parseGenerateImageArgs,
  runImageGeneration,
} from "../../../scripts/generate-blueprint-images.mjs";

const blueprintFixture = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    title: "Mock Blueprint",
    one_liner: "A simple mystery",
    target_age: 8,
    time_budget: 10,
    visual: {
      style: "storybook watercolor",
      mood: "cozy mystery",
      palette: "warm red and cream",
      lighting_or_atmosphere: "soft kitchen light",
      cover: {
        summary: "A playful cookie mystery cover.",
        visual_anchors: ["cookie jar", "detective notebook"],
      },
    },
  },
  narrative: {
    premise: "Someone stole the cookies.",
    starting_knowledge: [],
  },
  world: {
    starting_location_key: "kitchen",
    locations: [{
      location_key: "kitchen",
      name: "Kitchen",
      description: "A kitchen",
      search_context: ["A cookie jar sits open."],
      visual: {
        summary: "A warm kitchen with a cookie jar.",
        visual_anchors: ["cookie jar", "mixing bowl"],
      },
    }],
    characters: [
      {
        character_key: "alice",
        first_name: "Alice",
        last_name: "Smith",
        location_key: "kitchen",
        roleplay: {
          persona: "Nervous baker",
          background: "Baker",
          attitude: "guarded",
        },
        private_alibi: "Reading",
        private_motive: "Hungry",
        visual: {
          summary: "A red-haired baker with a worried look.",
          visual_anchors: ["red hair", "apron"],
        },
      },
    ],
  },
  evidence: [
    {
      evidence_key: "cookie-jar",
      player_text: "The cookie jar is open.",
      fact_summary: "Someone opened the jar recently.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [{ surface: "start", location_key: "kitchen" }],
    },
    {
      evidence_key: "crumbs",
      player_text: "There are crumbs on the floor.",
      fact_summary: "Fresh crumbs were left behind.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [{ surface: "search", location_key: "kitchen" }],
    },
    {
      evidence_key: "alice-hungry",
      player_text: "Alice admits she was hungry.",
      fact_summary: "Alice had motive.",
      essential: true,
      related_location_keys: ["kitchen"],
      related_character_keys: ["alice"],
      acquisition_paths: [{ surface: "talk", location_key: "kitchen", character_key: "alice" }],
    },
  ],
  ground_truth: {
    culprit_character_key: "alice",
    what_happened: "Alice ate the cookies.",
    why_it_happened: "Hungry.",
    explanation: "Alice ate the cookies because she was hungry.",
    suspect_truths: [
      {
        character_key: "alice",
        actual_activity: "Ate cookies",
        stated_alibi: "Reading",
        motive: "Hungry",
        contradiction_evidence_keys: ["cookie-jar", "crumbs"],
      },
    ],
    timeline: [
      {
        timeline_entry_key: "alice-eats-cookies",
        order: 0,
        summary: "Alice eats the cookies.",
        location_key: "kitchen",
        character_key: "alice",
      },
    ],
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
      "alice",
      "--location",
      "kitchen",
      "--overwrite",
    ]);

    expect(parsed).toMatchObject({
      blueprintPath: "/tmp/mock.json",
      outputDir: "/tmp/out",
      model: "openai/gpt-image-1",
      scope: "selected",
      overwrite: true,
      characterKeys: ["alice"],
      locationKeys: ["kitchen"],
    });
  });

  it("fails without required blueprint path", () => {
    expect(() => parseGenerateImageArgs([])).toThrow("Missing required --blueprint-path");
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

describe("loadImageGenerationEnv", () => {
  it("loads .env.local with shell env overrides", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-env-"));

    await writeFile(
      path.join(tmpDir, ".env.local"),
      'OPENROUTER_API_KEY="root-key"\nOPENROUTER_IMAGE_MODEL="root-model"\n',
      "utf-8",
    );

    const env = await loadImageGenerationEnv(tmpDir, {
      OPENROUTER_API_KEY: "shell-key",
      OPENROUTER_IMAGE_MODEL: "shell-model",
    });

    expect(env.OPENROUTER_API_KEY).toBe("shell-key");
    expect(env.OPENROUTER_IMAGE_MODEL).toBe("shell-model");
  });

  it("loads values from .env.local when shell env is absent", async () => {
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

  it("fails fast when live image generation is missing OpenRouter config", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "gen-images-missing-key-"));
    const blueprintPath = path.join(tmpDir, "blueprint.json");
    const outputDir = path.join(tmpDir, "images");

    await writeFile(blueprintPath, JSON.stringify(blueprintFixture, null, 2), "utf-8");

    await expect(() =>
      runImageGeneration({
        blueprintPath,
        outputDir,
        model: "openai/gpt-image-1",
        scope: "all",
        overwrite: false,
        dryRun: false,
        dryMode: false,
        characterKeys: [],
        locationKeys: [],
      }, { env: {} })
    ).rejects.toThrow(
      "Image generation configuration error:\n- Missing OPENROUTER_API_KEY; set it in `.env.local` or shell env before running `npm run generate:images`.",
    );
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
    expect(renderedLogs).toContain("Starting generation for Blueprint...");
    expect(renderedLogs).toContain("Dry mode request for Blueprint:");
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
});
