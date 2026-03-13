import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
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
});
