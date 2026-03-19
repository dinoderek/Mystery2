import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  BlueprintGenerationError,
  generateBlueprint,
} from "../../../packages/blueprint-generator/src/index.ts";
import {
  parseGenerateBlueprintArgs,
  runBlueprintGenerationCli,
} from "../../../scripts/generate-blueprint.mjs";
import { validBlueprintV2 as validBlueprint } from "./fixtures/blueprint-v2.fixture.ts";

function createSuccessResponse(contentObject: unknown = validBlueprint) {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify(contentObject),
          },
        },
      ],
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("blueprint generator", () => {
  it("sends structured-output requirements to OpenRouter", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse());

    const blueprint = await generateBlueprint({
      storyBrief: {
        brief: "A child-friendly cookie mystery.",
        targetAge: 8,
        timeBudget: 12,
      },
      model: "openai/gpt-4.1-mini",
      openRouterApiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(blueprint.metadata.title).toBe(validBlueprint.metadata.title);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(init?.body));
    expect(body.provider).toEqual({ require_parameters: true });
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.response_format.json_schema.schema.type).toBe("object");
    expect(body.response_format.json_schema.schema.$ref).toBeUndefined();
    expect(body.response_format.json_schema.schema.required).toEqual([
      "schema_version",
      "id",
      "metadata",
      "narrative",
      "world",
      "ground_truth",
      "solution_paths",
      "red_herrings",
      "suspect_elimination_paths",
    ]);
    expect(body.response_format.json_schema.schema.metadata).toBeUndefined();
    expect(body.response_format.json_schema.schema.properties.metadata.required).toEqual([
      "title",
      "one_liner",
      "target_age",
      "time_budget",
      "art_style",
    ]);
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties.image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties.art_style.type,
    ).toEqual(["string", "null"]);
    expect(
      body.response_format.json_schema.schema.properties.world.properties.locations.items
        .properties.location_image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.world.properties.characters.items
        .properties.portrait_image_id,
    ).toBeUndefined();
    expect(body.messages[1].content).toContain("story_brief");
    expect(body.messages[0].content).toContain("## Internal Workflow");
    expect(body.messages[0].content).toContain("## Challenge Calibration");
    expect(body.messages[0].content).toContain("## Field Sizing Guidance");
    expect(body.messages[0].content).toContain("Every location clue and character clue must be intentionally authored.");
    expect(body.messages[0].content).toContain("Every location clue and character clue must belong to at least one authored");
    expect(body.messages[0].content).toContain("world.characters[].actual_actions[]");
    expect(body.messages[0].content).toContain("solution_paths[]");
    expect(body.messages[0].content).toContain("Do not output `image_id`, `location_image_id`, or `portrait_image_id`.");
  });

  it("maps structured-output incompatibility to a dedicated error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message: "response_format json_schema is not supported for this model",
          },
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      generateBlueprint({
        storyBrief: {
          brief: "A playground mystery.",
          targetAge: 7,
        },
        model: "unsupported/model",
        openRouterApiKey: "test-key",
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "UNSUPPORTED_STRUCTURED_OUTPUTS",
    });
  });

  it("rejects non-JSON assistant output", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not-json" } }],
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );

    await expect(
      generateBlueprint({
        storyBrief: {
          brief: "A school race mystery.",
          targetAge: 8,
        },
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "INVALID_JSON_RESPONSE",
    });
  });

  it("rejects schema-invalid JSON", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createSuccessResponse({
        id: "123e4567-e89b-12d3-a456-426614174000",
        metadata: {
          title: "Broken",
          one_liner: "Missing key sections",
          target_age: 8,
          time_budget: 10,
        },
      }),
    );

    await expect(
      generateBlueprint({
        storyBrief: {
          brief: "A broken mystery payload.",
          targetAge: 8,
        },
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "SCHEMA_VALIDATION_FAILED",
    });
  });

  it("drops any returned image fields before canonical validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      createSuccessResponse({
        ...validBlueprint,
        metadata: {
          ...validBlueprint.metadata,
          image_id: "generated-cover",
        },
        world: {
          ...validBlueprint.world,
          locations: validBlueprint.world.locations.map((location) => ({
            ...location,
            location_image_id: "generated-location",
          })),
          characters: validBlueprint.world.characters.map((character) => ({
            ...character,
            portrait_image_id: "generated-portrait",
          })),
        },
      }),
    );

    const blueprint = await generateBlueprint({
      storyBrief: {
        brief: "A mystery where the model invents image ids.",
        targetAge: 8,
      },
      model: "openai/gpt-4.1-mini",
      openRouterApiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });

    expect(blueprint.metadata.image_id).toBeUndefined();
    expect(blueprint.world.locations[0]?.location_image_id).toBeUndefined();
    expect(blueprint.world.characters[0]?.portrait_image_id).toBeUndefined();
  });

  it("rejects invalid story brief input", async () => {
    await expect(
      generateBlueprint({
        storyBrief: {
          brief: "",
          targetAge: 8,
        } as never,
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        fetchImpl: vi.fn() as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "INVALID_STORY_BRIEF",
    });
  });

  it("maps abort failures to a timeout error", async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );

    await expect(
      generateBlueprint({
        storyBrief: {
          brief: "A long-running mystery generation request.",
          targetAge: 8,
        },
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        timeoutMs: 1000,
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "OPENROUTER_ERROR",
      message: "OpenRouter blueprint generation request timed out",
    });
  });
});

describe("generate-blueprint CLI", () => {
  it("parses env-backed defaults", () => {
    const parsed = parseGenerateBlueprintArgs(
      ["--brief-file", "/tmp/story.json"],
      {
        OPENROUTER_BLUEPRINT_MODEL: "openai/gpt-4.1-mini",
        OPENROUTER_API_KEY: "env-key",
        AI_OPENROUTER_TIMEOUT_MS: "90000",
      },
    );

    expect(parsed).toEqual({
      briefFile: "/tmp/story.json",
      output: "",
      model: "openai/gpt-4.1-mini",
      openRouterApiKey: "env-key",
      timeoutMs: 90000,
    });
  });

  it("writes output file when requested", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "blueprint-cli-"));
    const briefPath = path.join(tmpDir, "brief.json");
    const outputPath = path.join(tmpDir, "blueprint.json");

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A library mystery for kids.",
        targetAge: 8,
      }),
      "utf-8",
    );

    const result = await runBlueprintGenerationCli(
      {
        briefFile: briefPath,
        output: outputPath,
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
      },
      {
        generateBlueprintImpl: vi.fn().mockResolvedValue(validBlueprint),
      },
    );

    expect(result.blueprint.id).toBe(validBlueprint.id);
    const written = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(written.metadata.title).toBe(validBlueprint.metadata.title);
  });

  it("returns stdout content when no output path is provided", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "blueprint-cli-stdout-"));
    const briefPath = path.join(tmpDir, "brief.json");

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A museum mystery for kids.",
        targetAge: 9,
      }),
      "utf-8",
    );

    const result = await runBlueprintGenerationCli(
      {
        briefFile: briefPath,
        output: "",
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
      },
      {
        generateBlueprintImpl: vi.fn().mockResolvedValue(validBlueprint),
      },
    );

    expect(result.outputText).toContain(validBlueprint.metadata.title);
  });

  it("surfaces generator failures", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "blueprint-cli-error-"));
    const briefPath = path.join(tmpDir, "brief.json");

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A park mystery for kids.",
        targetAge: 7,
      }),
      "utf-8",
    );

    await expect(
      runBlueprintGenerationCli(
        {
          briefFile: briefPath,
          output: "",
          model: "openai/gpt-4.1-mini",
          openRouterApiKey: "test-key",
        },
        {
          generateBlueprintImpl: vi.fn().mockRejectedValue(
            new BlueprintGenerationError(
              "OPENROUTER_ERROR",
              "OpenRouter request failed (500)",
            ),
          ),
        },
      ),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "OPENROUTER_ERROR",
    });
  });
});
