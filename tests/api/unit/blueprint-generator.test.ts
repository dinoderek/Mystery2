import { describe, expect, it, vi } from "vitest";

import {
  buildBlueprintGenerationMarkdownDocument,
  buildBlueprintGenerationMarkdownPacket,
} from "../../../packages/blueprint-generator/src/chat-packet.ts";
import {
  buildBlueprintGenerationChatInput,
  generateBlueprint,
} from "../../../packages/blueprint-generator/src/index.ts";
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
  it("threads age-band guidance into the generation system prompt", async () => {
    const chatInput = await buildBlueprintGenerationChatInput({
      brief: "A child-friendly cookie mystery.",
      targetAge: 7,
      timeBudget: 12,
    });

    expect(chatInput.systemPrompt).toContain("Age-appropriate writing");
    expect(chatInput.systemPrompt).toContain("7 years old");
    expect(chatInput.systemPrompt.toLowerCase()).toContain("wall of text");
  });

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
    ).toEqual(["title", "one_liner", "target_age", "time_budget", "narration_style", "art_style", "visual_direction"]);
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties
        .image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.metadata.properties
        .art_style.type,
    ).toEqual(["string", "null"]);
    const vdSchema =
      body.response_format.json_schema.schema.properties.metadata.properties
        .visual_direction;
    expect(vdSchema).toBeDefined();
    // optional → nullable via anyOf wrapper
    const objectVariant = Array.isArray(vdSchema.anyOf)
      ? vdSchema.anyOf.find((v: Record<string, unknown>) => v.type === "object")
      : vdSchema;
    expect(objectVariant?.properties).toHaveProperty("art_style");
    expect(objectVariant?.properties).toHaveProperty("color_palette");
    expect(objectVariant?.properties).toHaveProperty("mood");
    expect(objectVariant?.properties).toHaveProperty("lighting");
    expect(objectVariant?.properties).toHaveProperty("texture");
    expect(objectVariant?.properties).toHaveProperty("portrait_background");
    expect(
      body.response_format.json_schema.schema.properties.world.properties
        .locations.items.properties.location_image_id,
    ).toBeUndefined();
    expect(
      body.response_format.json_schema.schema.properties.world.properties
        .characters.items.properties.portrait_image_id,
    ).toBeUndefined();
    // The clue `requires` gate survives the strict-output round-trip as a
    // nullable object carrying clue_ids + rationale (optional+nullable nests as
    // anyOf with a {type:"null"} variant). Assert the gate is present, carries
    // both fields, and remains nullable on both location and character clues.
    for (const owner of ["locations", "characters"] as const) {
      const requiresNode =
        body.response_format.json_schema.schema.properties.world.properties[
          owner
        ].items.properties.clues.items.properties.requires;
      expect(requiresNode).toBeDefined();
      const serialized = JSON.stringify(requiresNode);
      expect(serialized).toContain('"clue_ids"');
      expect(serialized).toContain('"rationale"');
      expect(serialized).toContain('{"type":"null"}');
    }
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

  it("sends a response schema that strict structured output accepts, with no untyped node", async () => {
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse());
    await generateBlueprint({
      storyBrief: { brief: "A child-friendly cookie mystery.", targetAge: 8 },
      model: "openai/gpt-4.1-mini",
      openRouterApiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });
    const schema = JSON.parse(String(fetchMock.mock.calls[0][1].body)).response_format.json_schema.schema;

    // OpenAI rejects a node without a `type`, such as `{ not: {} }`, the
    // rendering of `undefined` that an optional-and-nullable field gets.
    const untyped: string[] = [];
    const walk = (node: unknown, at: string): void => {
      if (!node || typeof node !== "object") return;
      if (!Array.isArray(node) && "not" in node) untyped.push(at);
      for (const [key, value] of Object.entries(node)) walk(value, `${at}.${key}`);
    };
    walk(schema, "$");
    expect(untyped).toEqual([]);

    const clue = schema.properties.world.properties.locations.items.properties.clues.items;
    expect(clue.properties.requires.anyOf.map((variant: { type: unknown }) => variant.type)).toEqual(["object", "null"]);
    expect(clue.properties.requires.anyOf[0].required).toEqual(["clue_ids", "rationale"]);
  });

  it("names the provider's error when OpenRouter answers 200 with an error instead of a completion", async () => {
    const message = "Invalid schema for response_format 'BlueprintV2': schema must have a 'type' key.";
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "gen-1", error: { message, code: 400 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    await expect(
      generateBlueprint({
        storyBrief: { brief: "A playground mystery.", targetAge: 7 },
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({
      code: "OPENROUTER_ERROR",
      message: `OpenRouter returned an error instead of a completion: ${message}`,
    });
  });

  it("drops a null the model sent for a field the schema only makes optional", async () => {
    const answer = structuredClone(validBlueprint) as unknown as { metadata: Record<string, unknown> };
    answer.metadata.art_style = null;
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse(answer));

    const blueprint = await generateBlueprint({
      storyBrief: { brief: "A child-friendly cookie mystery.", targetAge: 8 },
      model: "openai/gpt-4.1-mini",
      openRouterApiKey: "test-key",
      fetchImpl: fetchMock as typeof fetch,
    });
    expect(blueprint.metadata).not.toHaveProperty("art_style");
  });

  it("still fails a null for a field the schema requires", async () => {
    const answer = structuredClone(validBlueprint) as unknown as { metadata: Record<string, unknown> };
    answer.metadata.title = null;
    const fetchMock = vi.fn().mockResolvedValue(createSuccessResponse(answer));

    await expect(
      generateBlueprint({
        storyBrief: { brief: "A child-friendly cookie mystery.", targetAge: 8 },
        model: "openai/gpt-4.1-mini",
        openRouterApiKey: "test-key",
        fetchImpl: fetchMock as typeof fetch,
      }),
    ).rejects.toMatchObject({ code: "SCHEMA_VALIDATION_FAILED" });
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
