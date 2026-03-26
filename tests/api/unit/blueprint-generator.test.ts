import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  buildBlueprintGenerationMarkdownDocument,
  buildBlueprintGenerationMarkdownPacket,
} from "../../../packages/blueprint-generator/src/chat-packet.ts";
import {
  BlueprintGenerationError,
  generateBlueprint,
} from "../../../packages/blueprint-generator/src/index.ts";
import {
  parseGenerateBlueprintArgs,
  BlueprintVerificationError,
  runBlueprintGenerationCli,
  shouldExitNonZeroForBlueprintCliError,
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

const passingVerification = {
  overall_pass: true,
  dimensions: {
    brief_alignment: { yes: true, reasoning: "Aligned", issues: [] },
    ground_truth_quality: { yes: true, reasoning: "Grounded", issues: [] },
    solvable_paths_exist: { yes: true, reasoning: "Solvable", issues: [] },
    location_clues_have_role: { yes: true, reasoning: "Clear", issues: [] },
    character_clues_have_role: { yes: true, reasoning: "Clear", issues: [] },
    red_herrings_are_fair: { yes: true, reasoning: "Fair", issues: [] },
    no_dead_ends: { yes: true, reasoning: "No dead ends", issues: [] },
    consistent_facts: { yes: true, reasoning: "Consistent", issues: [] },
    no_redundant_clues: { yes: true, reasoning: "Distinct", issues: [] },
  },
  solution_paths: [
    {
      name: "main path",
      conclusion: "The culprit is identified.",
      reasoning_steps: [
        {
          claim: "A valid clue chain exists.",
          evidence_paths: ["solution_paths[0]"],
        },
      ],
    },
  ],
  location_clue_audit: [],
  character_clue_audit: [],
  red_herrings: [],
  dead_ends: [],
  redundant_clues: [],
};

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
      "cover_image",
      "ground_truth",
      "solution_paths",
      "red_herrings",
      "suspect_elimination_paths",
    ]);
    expect(body.response_format.json_schema.schema.metadata).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.metadata.required,
    ).toEqual(["title", "one_liner", "target_age", "time_budget", "art_style"]);
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties
        .image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties
        .art_style.type,
    ).toEqual(["string", "null"]);
    expect(
      body.response_format.json_schema.schema.properties.world.properties
        .locations.items.properties.location_image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.world.properties
        .characters.items.properties.portrait_image_id,
    ).toBeUndefined();
    expect(body.messages[1].content).toContain("story_brief");
    expect(body.messages[0].content).toContain("## Internal Workflow");
    expect(body.messages[0].content).toContain("## Challenge Calibration");
    expect(body.messages[0].content).toContain("## Field Sizing Guidance");
    expect(body.messages[0].content).toContain(
      "Every location clue and character clue must be intentionally authored.",
    );
    expect(body.messages[0].content).toContain(
      "Every location clue and character clue must belong to at least one authored",
    );
    expect(body.messages[0].content).toContain(
      "world.characters[].actual_actions[]",
    );
    expect(body.messages[0].content).toContain("solution_paths[]");
    expect(body.messages[0].content).toContain(
      "Do not output `image_id`, `location_image_id`, or `portrait_image_id`.",
    );
  });

  it("maps structured-output incompatibility to a dedicated error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            message:
              "response_format json_schema is not supported for this model",
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
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new DOMException("Aborted", "AbortError"));

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
  it("parses chat packet mode without requiring API env", () => {
    const parsed = parseGenerateBlueprintArgs(
      ["--chat-packet", "--brief-file", "/tmp/story.json"],
      {
        MYSTERY_CONFIG_ROOT: "/tmp/shared-config",
      },
    );

    expect(parsed).toMatchObject({
      briefFiles: ["/tmp/story.json"],
      chatPacket: true,
      output: "",
      outputFile: "/tmp/shared-config/chat-gen-prompts/blueprint-packet",
      models: [],
    });
  });

  it("ignores model flags in chat packet mode", () => {
    const parsed = parseGenerateBlueprintArgs(
      [
        "--chat-packet",
        "--brief-file",
        "/tmp/story.json",
        "--model",
        "openai/gpt-4.1-mini,google/gemini-2.5-flash",
      ],
      {},
    );

    expect(parsed.chatPacket).toBe(true);
    expect(parsed.models).toEqual([
      "openai/gpt-4.1-mini",
      "google/gemini-2.5-flash",
    ]);
  });

  it("parses env-backed defaults", () => {
    const parsed = parseGenerateBlueprintArgs(
      ["--brief-file", "/tmp/story.json"],
      {
        OPENROUTER_BLUEPRINT_MODEL: "openai/gpt-4.1-mini",
        OPENROUTER_API_KEY: "env-key",
        AI_OPENROUTER_TIMEOUT_MS: "90000",
      },
    );

    expect(parsed).toMatchObject({
      briefFiles: ["/tmp/story.json"],
      output: "",
      models: ["openai/gpt-4.1-mini"],
      verificationModel: "google/gemini-3-flash-preview",
      openRouterApiKey: "env-key",
      timeoutMs: 90000,
      parallelism: 1,
    });
    expect(parsed.outputFile).toMatch(/blueprints[/\\]blueprint$/);
  });

  it("parses repeated models, output-file mode, and parallelism", () => {
    const parsed = parseGenerateBlueprintArgs(
      [
        "--brief-file",
        "/tmp/one.json",
        "--brief-file",
        "/tmp/two.json",
        "--model",
        "openai/gpt-4.1-mini,google/gemini-2.5-flash",
        "--output-file",
        "/tmp/generated/blueprint",
        "--parallelism",
        "3",
      ],
      {
        OPENROUTER_API_KEY: "env-key",
      },
    );

    expect(parsed).toEqual({
      briefFiles: ["/tmp/one.json", "/tmp/two.json"],
      chatPacket: false,
      output: "",
      outputFile: "/tmp/generated/blueprint",
      models: ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"],
      verificationModel: "google/gemini-3-flash-preview",
      openRouterApiKey: "env-key",
      timeoutMs: 120000,
      parallelism: 3,
    });
  });

  it("parses an explicit verification model override", () => {
    const parsed = parseGenerateBlueprintArgs(
      [
        "--brief-file",
        "/tmp/story.json",
        "--model",
        "openai/gpt-4.1-mini",
        "--verification-model",
        "openai/gpt-4.1-mini",
      ],
      {
        OPENROUTER_API_KEY: "env-key",
      },
    );

    expect(parsed.verificationModel).toBe("openai/gpt-4.1-mini");
  });

  it("defaults output-file for multiple jobs when not specified", () => {
    const parsed = parseGenerateBlueprintArgs(
      [
        "--brief-file",
        "/tmp/one.json",
        "--brief-file",
        "/tmp/two.json",
        "--model",
        "openai/gpt-4.1-mini",
      ],
      {
        OPENROUTER_API_KEY: "env-key",
      },
    );
    expect(parsed.outputFile).toMatch(/blueprints[/\\]blueprint$/);
  });

  it("writes an exact output path when requested for a single job", async () => {
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
        briefFiles: [briefPath],
        output: outputPath,
        outputFile: "",
        models: ["openai/gpt-4.1-mini"],
        verificationModel: "google/gemini-3-flash-preview",
        openRouterApiKey: "test-key",
        parallelism: 1,
      },
      {
        generateBlueprintImpl: vi.fn().mockResolvedValue(validBlueprint),
        verifyBlueprintImpl: vi.fn().mockResolvedValue(passingVerification),
      },
    );

    expect(result.blueprint.id).toBe(validBlueprint.id);
    const written = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(written.metadata.title).toBe(validBlueprint.metadata.title);
    const verification = JSON.parse(
      await readFile(path.join(tmpDir, "blueprint.verification.json"), "utf-8"),
    );
    expect(verification.status).toBe("passed");
    expect(verification.overall_pass).toBe(true);
    expect(verification.verification_model).toBe(
      "google/gemini-3-flash-preview",
    );
  });

  it("writes one composed output file per brief/model combination", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-matrix-"),
    );
    const briefOnePath = path.join(tmpDir, "library-brief.json");
    const briefTwoPath = path.join(tmpDir, "museum-brief.json");
    const outputBase = path.join(tmpDir, "generated", "blueprint.json");

    await writeFile(
      briefOnePath,
      JSON.stringify({
        brief: "A library mystery for kids.",
        targetAge: 8,
      }),
      "utf-8",
    );
    await writeFile(
      briefTwoPath,
      JSON.stringify({
        brief: "A museum mystery for kids.",
        targetAge: 9,
      }),
      "utf-8",
    );

    const generateBlueprintImpl = vi
      .fn()
      .mockImplementation(async ({ storyBrief, model }) => ({
        ...validBlueprint,
        id: `${model}-${storyBrief.targetAge}`,
        metadata: {
          ...validBlueprint.metadata,
          title: `${storyBrief.brief} via ${model}`,
        },
      }));

    const result = await runBlueprintGenerationCli(
      {
        briefFiles: [briefOnePath, briefTwoPath],
        output: "",
        outputFile: outputBase,
        models: ["openai/gpt-4.1-mini", "google/gemini-2.5-flash"],
        verificationModel: "google/gemini-3-flash-preview",
        openRouterApiKey: "test-key",
        parallelism: 1,
      },
      {
        generateBlueprintImpl,
        verifyBlueprintImpl: vi.fn().mockResolvedValue(passingVerification),
      },
    );

    expect(result.outputs).toHaveLength(4);

    const writtenOne = JSON.parse(
      await readFile(
        path.join(
          tmpDir,
          "generated",
          "blueprint.openai_gpt-4.1-mini.library-brief.json",
        ),
        "utf-8",
      ),
    );
    const writtenTwo = JSON.parse(
      await readFile(
        path.join(
          tmpDir,
          "generated",
          "blueprint.google_gemini-2.5-flash.museum-brief.json",
        ),
        "utf-8",
      ),
    );

    expect(writtenOne.metadata.title).toContain("library mystery");
    expect(writtenTwo.metadata.title).toContain("google/gemini-2.5-flash");
    const verification = JSON.parse(
      await readFile(
        path.join(
          tmpDir,
          "generated",
          "blueprint.openai_gpt-4.1-mini.library-brief.verification.json",
        ),
        "utf-8",
      ),
    );
    expect(verification.status).toBe("passed");
  });

  it("returns stdout content when no output path is provided", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-stdout-"),
    );
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
        briefFiles: [briefPath],
        output: "",
        outputFile: "",
        models: ["openai/gpt-4.1-mini"],
        verificationModel: "google/gemini-3-flash-preview",
        openRouterApiKey: "test-key",
        parallelism: 1,
      },
      {
        generateBlueprintImpl: vi.fn().mockResolvedValue(validBlueprint),
      },
    );

    expect(result.outputText).toContain(validBlueprint.metadata.title);
  });

  it("writes markdown chat packets without invoking generation or verification", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-chat-packet-"),
    );
    const briefPath = path.join(tmpDir, "brief.json");
    const outputBase = path.join(tmpDir, "chat", "blueprint-packet");

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A chat-export mystery packet.",
        targetAge: 8,
      }),
      "utf-8",
    );

    const generateBlueprintImpl = vi.fn();
    const verifyBlueprintImpl = vi.fn();

    const result = await runBlueprintGenerationCli(
      {
        briefFiles: [briefPath],
        chatPacket: true,
        output: "",
        outputFile: outputBase,
        models: ["openai/gpt-4.1-mini"],
        verificationModel: "google/gemini-3-flash-preview",
        openRouterApiKey: "",
        parallelism: 1,
      },
      {
        generateBlueprintImpl,
        verifyBlueprintImpl,
      },
    );

    expect(generateBlueprintImpl).not.toHaveBeenCalled();
    expect(verifyBlueprintImpl).not.toHaveBeenCalled();
    expect(result.outputs).toHaveLength(1);

    const packetPath = path.join(
      tmpDir,
      "chat",
      "blueprint-packet.brief.chat.md",
    );
    const written = await readFile(packetPath, "utf-8");
    expect(written).toContain("# Blueprint Generation Packet");
    expect(written).toContain("## Generator Prompt");
    expect(written).toContain("## Response Schema (JSON Schema)");
    expect(written).toContain("\"story_brief\"");
  });

  it("surfaces generator failures", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-error-"),
    );
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
          briefFiles: [briefPath],
          output: "",
          outputFile: "",
          models: ["openai/gpt-4.1-mini"],
          verificationModel: "google/gemini-3-flash-preview",
          openRouterApiKey: "test-key",
          parallelism: 1,
        },
        {
          generateBlueprintImpl: vi
            .fn()
            .mockRejectedValue(
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

  it("writes blueprint and verification files before surfacing verification failures", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-verification-fail-"),
    );
    const briefPath = path.join(tmpDir, "brief.json");
    const outputPath = path.join(tmpDir, "blueprint.json");

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A fairground mystery for kids.",
        targetAge: 8,
      }),
      "utf-8",
    );

    await expect(
      runBlueprintGenerationCli(
        {
          briefFiles: [briefPath],
          output: outputPath,
          outputFile: "",
          models: ["openai/gpt-4.1-mini"],
          verificationModel: "openai/gpt-4.1-mini",
          openRouterApiKey: "test-key",
          parallelism: 1,
        },
        {
          generateBlueprintImpl: vi.fn().mockResolvedValue(validBlueprint),
          verifyBlueprintImpl: vi.fn().mockResolvedValue({
            ...passingVerification,
            overall_pass: false,
            dimensions: {
              ...passingVerification.dimensions,
              no_dead_ends: {
                yes: false,
                reasoning: "",
                issues: [
                  {
                    title: "Dead end",
                    details: "One clue chain cannot be resolved.",
                    evidence_paths: ["world.locations[0].clues[0]"],
                  },
                ],
              },
            },
            dead_ends: [
              {
                description: "An unresolved clue path.",
                why_it_is_a_dead_end: "It has no supporting resolution.",
                evidence_paths: ["world.locations[0].clues[0]"],
              },
            ],
            solution_paths: [],
          }),
        },
      ),
    ).rejects.toMatchObject({
      name: "BlueprintVerificationError",
    });

    const written = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(written.metadata.title).toBe(validBlueprint.metadata.title);

    const verification = JSON.parse(
      await readFile(path.join(tmpDir, "blueprint.verification.json"), "utf-8"),
    );
    expect(verification.status).toBe("failed");
    expect(verification.overall_pass).toBe(false);
    expect(verification.evaluation.dimensions.no_dead_ends.yes).toBe(false);
    expect(verification.verification_model).toBe("openai/gpt-4.1-mini");
  });

  it("writes invalid generated JSON and a verification file on generator schema-validation failure", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-schema-invalid-"),
    );
    const briefPath = path.join(tmpDir, "brief.json");
    const outputPath = path.join(tmpDir, "blueprint.json");
    const invalidBlueprint = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      metadata: {
        title: "Broken",
        one_liner: "Missing sections",
        target_age: 8,
        time_budget: 10,
      },
    };

    await writeFile(
      briefPath,
      JSON.stringify({
        brief: "A broken mystery for debugging.",
        targetAge: 8,
      }),
      "utf-8",
    );

    await expect(
      runBlueprintGenerationCli(
        {
          briefFiles: [briefPath],
          output: outputPath,
          outputFile: "",
          models: ["openai/gpt-4.1-mini"],
          verificationModel: "google/gemini-3-flash-preview",
          openRouterApiKey: "test-key",
          parallelism: 1,
        },
        {
          generateBlueprintImpl: vi.fn().mockRejectedValue(
            new BlueprintGenerationError(
              "SCHEMA_VALIDATION_FAILED",
              "Generated blueprint failed schema validation",
              {
                responseText: JSON.stringify(invalidBlueprint),
                issues: {
                  narrative: { _errors: ["Required"] },
                },
              },
            ),
          ),
        },
      ),
    ).rejects.toMatchObject({
      name: "BlueprintGenerationError",
      code: "SCHEMA_VALIDATION_FAILED",
    });

    const written = JSON.parse(await readFile(outputPath, "utf-8"));
    expect(written.metadata.title).toBe("Broken");

    const verification = JSON.parse(
      await readFile(path.join(tmpDir, "blueprint.verification.json"), "utf-8"),
    );
    expect(verification.status).toBe("error");
    expect(verification.error.code).toBe("SCHEMA_VALIDATION_FAILED");
    expect(verification.verification_model).toBe(
      "google/gemini-3-flash-preview",
    );
  });

  it("logs progress and can run jobs in parallel", async () => {
    const tmpDir = await mkdtemp(
      path.join(os.tmpdir(), "blueprint-cli-parallel-"),
    );
    const briefOnePath = path.join(tmpDir, "one.json");
    const briefTwoPath = path.join(tmpDir, "two.json");
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    let activeJobs = 0;
    let maxActiveJobs = 0;

    await writeFile(
      briefOnePath,
      JSON.stringify({
        brief: "A bakery mystery for kids.",
        targetAge: 8,
      }),
      "utf-8",
    );
    await writeFile(
      briefTwoPath,
      JSON.stringify({
        brief: "A train mystery for kids.",
        targetAge: 9,
      }),
      "utf-8",
    );

    await runBlueprintGenerationCli(
      {
        briefFiles: [briefOnePath, briefTwoPath],
        output: "",
        outputFile: path.join(tmpDir, "generated", "blueprint"),
        models: ["openai/gpt-4.1-mini"],
        verificationModel: "google/gemini-3-flash-preview",
        openRouterApiKey: "test-key",
        parallelism: 2,
      },
      {
        generateBlueprintImpl: vi.fn().mockImplementation(async () => {
          activeJobs += 1;
          maxActiveJobs = Math.max(maxActiveJobs, activeJobs);
          await new Promise((resolve) => setTimeout(resolve, 20));
          activeJobs -= 1;
          return validBlueprint;
        }),
        verifyBlueprintImpl: vi.fn().mockResolvedValue(passingVerification),
        logger,
      },
    );

    expect(maxActiveJobs).toBe(2);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("queued 2 job(s)"),
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("starting model=openai/gpt-4.1-mini"),
    );
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("wrote"));
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("wrote verification"),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not require a non-zero exit for file-writing verification failures", () => {
    const error = new BlueprintVerificationError("verification failed", {
      outputPath: "/tmp/blueprint.json",
    });

    expect(shouldExitNonZeroForBlueprintCliError(error, true)).toBe(false);
  });

  it("does not require a non-zero exit for file-writing schema validation failures", () => {
    const error = new BlueprintGenerationError(
      "SCHEMA_VALIDATION_FAILED",
      "Generated blueprint failed schema validation",
      {
        outputPath: "/tmp/blueprint.json",
      },
    );

    expect(shouldExitNonZeroForBlueprintCliError(error, true)).toBe(false);
  });

  it("still requires a non-zero exit for hard generation failures", () => {
    const error = new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "OpenRouter request failed (500)",
    );

    expect(shouldExitNonZeroForBlueprintCliError(error, true)).toBe(true);
  });
});

describe("blueprint generation chat packet builder", () => {
  it("assembles a markdown document with prompt, schemas, and response rules", () => {
    const markdown = buildBlueprintGenerationMarkdownDocument({
      title: "Blueprint Generation Packet",
      systemPrompt: "System prompt body",
      userMessageJson: {
        story_brief: {
          brief: "A library mystery.",
          targetAge: 8,
        },
      },
      responseSchema: { type: "object", properties: { id: { type: "string" } } },
      storyBriefSchemaSource: "export const StoryBriefSchema = z.object({});",
      blueprintSchemaSource: "export const BlueprintV2Schema = z.object({});",
    });

    expect(markdown).toContain("# Blueprint Generation Packet");
    expect(markdown).toContain("## Generator Prompt");
    expect(markdown).toContain("## User Message JSON");
    expect(markdown).toContain("## Response Contract");
    expect(markdown).toContain("## Response Schema (JSON Schema)");
    expect(markdown).toContain("## Story Brief Schema Reference");
    expect(markdown).toContain("## Blueprint V2 Schema Reference");
    expect(markdown).toContain("Do not output generated image fields");
  });

  it("builds a packet from the live generator prompt inputs", async () => {
    const packet = await buildBlueprintGenerationMarkdownPacket({
      storyBrief: {
        brief: "A school mystery about a missing trophy.",
        targetAge: 8,
      },
    });

    expect(packet.outputText).toContain("## Generator Prompt");
    expect(packet.outputText).toContain("## User Message JSON");
    expect(packet.outputText).toContain("## Response Schema (JSON Schema)");
    expect(packet.outputText).toContain("\"story_brief\"");
    expect(packet.outputText).toContain("Do not output `image_id`");
  });
});
