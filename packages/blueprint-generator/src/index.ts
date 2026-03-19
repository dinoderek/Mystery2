import { zodToJsonSchema } from "zod-to-json-schema";

import {
  BlueprintV2Schema,
  type BlueprintV2,
} from "../../shared/src/blueprint-schema-v2.ts";
import { BlueprintGenerationError } from "./errors.ts";
import { loadBlueprintGeneratorPrompt } from "./prompt.ts";
import { StoryBriefSchema, type StoryBrief } from "./story-brief.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;

export { BlueprintGenerationError } from "./errors.ts";
export { StoryBriefSchema, type StoryBrief } from "./story-brief.ts";

export interface GenerateBlueprintOptions {
  storyBrief: StoryBrief;
  model: string;
  openRouterApiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  baseUrl?: string;
  requestId?: string;
}

function makePropertyNullable(schema: Record<string, unknown>): Record<string, unknown> {
  const currentType = schema.type;

  if (typeof currentType === "string") {
    if (currentType === "null") return schema;
    return { ...schema, type: [currentType, "null"] };
  }

  if (Array.isArray(currentType)) {
    return currentType.includes("null")
      ? schema
      : { ...schema, type: [...currentType, "null"] };
  }

  const anyOf = Array.isArray(schema.anyOf) ? schema.anyOf : [];
  const hasNullVariant = anyOf.some((variant) =>
    typeof variant === "object" &&
    variant !== null &&
    !Array.isArray(variant) &&
    (variant as { type?: unknown }).type === "null"
  );

  if (hasNullVariant) {
    return schema;
  }

  return {
    anyOf: [schema, { type: "null" }],
  };
}

function normalizeStructuredOutputSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) {
    return schema.map(normalizeStructuredOutputSchema);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const normalized = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [key, normalizeStructuredOutputSchema(value)]),
  ) as Record<string, unknown>;

  if (
    normalized.properties &&
    typeof normalized.properties === "object" &&
    !Array.isArray(normalized.properties)
  ) {
    const properties = normalized.properties as Record<string, unknown>;
    const propertyNames = Object.keys(properties);
    const existingRequired = Array.isArray(normalized.required)
      ? normalized.required.filter((value): value is string => typeof value === "string")
      : [];
    const requiredSet = new Set(existingRequired);

    for (const propertyName of propertyNames) {
      const propertySchema = properties[propertyName];
      if (
        !requiredSet.has(propertyName) &&
        propertySchema &&
        typeof propertySchema === "object" &&
        !Array.isArray(propertySchema)
      ) {
        properties[propertyName] = makePropertyNullable(
          propertySchema as Record<string, unknown>,
        );
      }
    }

    normalized.properties = properties;
    normalized.required = propertyNames;
    normalized.additionalProperties = false;
  }

  return normalized;
}

function removeObjectProperties(
  schema: unknown,
  propertyNamesToRemove: readonly string[],
): unknown {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return schema;
  }

  const normalized = structuredClone(schema) as Record<string, unknown>;
  if (
    normalized.properties &&
    typeof normalized.properties === "object" &&
    !Array.isArray(normalized.properties)
  ) {
    const properties = normalized.properties as Record<string, unknown>;

    for (const propertyName of propertyNamesToRemove) {
      delete properties[propertyName];
    }

    normalized.properties = properties;

    if (Array.isArray(normalized.required)) {
      normalized.required = normalized.required.filter(
        (value): value is string =>
          typeof value === "string" && !propertyNamesToRemove.includes(value),
      );
    }
  }

  return normalized;
}

function asObjectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function buildBlueprintJsonSchema(): Record<string, unknown> {
  const raw = zodToJsonSchema(BlueprintV2Schema, {
    name: "BlueprintV2",
    $refStrategy: "none",
  }) as Record<string, unknown>;

  const definition = (raw.definitions as Record<string, unknown> | undefined)?.BlueprintV2;
  const normalizedDefinition =
    definition && typeof definition === "object" && !Array.isArray(definition)
      ? (normalizeStructuredOutputSchema(definition) as Record<string, unknown>)
      : null;

  if (normalizedDefinition) {
    const rootProperties = asObjectRecord(normalizedDefinition.properties);
    const worldSchema = asObjectRecord(rootProperties?.world);
    const worldProperties = asObjectRecord(worldSchema?.properties);
    const locationsSchema = asObjectRecord(worldProperties?.locations);
    const charactersSchema = asObjectRecord(worldProperties?.characters);

    const metadataSchema = removeObjectProperties(
      rootProperties?.metadata,
      ["image_id"],
    );
    const locationItemSchema = removeObjectProperties(
      locationsSchema?.items,
      ["location_image_id"],
    );
    const characterItemSchema = removeObjectProperties(
      charactersSchema?.items,
      ["portrait_image_id"],
    );

    if (rootProperties) {
      if (metadataSchema) {
        rootProperties.metadata = metadataSchema;
      }
      if (worldSchema && worldProperties) {
        if (locationItemSchema && locationsSchema) {
          locationsSchema.items = locationItemSchema;
        }
        if (characterItemSchema && charactersSchema) {
          charactersSchema.items = characterItemSchema;
        }
        rootProperties.world = worldSchema;
      }
      normalizedDefinition.properties = rootProperties;
    }

    return normalizedDefinition;
  }

  if ("$schema" in raw) delete raw.$schema;
  return normalizeStructuredOutputSchema(raw) as Record<string, unknown>;
}

function extractAssistantContent(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string }> } }>;
  })?.choices?.[0]?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("");
  }

  throw new BlueprintGenerationError(
    "OPENROUTER_ERROR",
    "OpenRouter response missing assistant content",
  );
}

function stripGeneratedImageFields(parsedJson: unknown): unknown {
  if (!parsedJson || typeof parsedJson !== "object" || Array.isArray(parsedJson)) {
    return parsedJson;
  }

  const blueprint = structuredClone(parsedJson) as {
    metadata?: { image_id?: unknown };
    world?: {
      locations?: Array<{ location_image_id?: unknown }>;
      characters?: Array<{ portrait_image_id?: unknown }>;
    };
  };

  if (blueprint.metadata && "image_id" in blueprint.metadata) {
    delete blueprint.metadata.image_id;
  }

  if (Array.isArray(blueprint.world?.locations)) {
    for (const location of blueprint.world.locations) {
      if (location && "location_image_id" in location) {
        delete location.location_image_id;
      }
    }
  }

  if (Array.isArray(blueprint.world?.characters)) {
    for (const character of blueprint.world.characters) {
      if (character && "portrait_image_id" in character) {
        delete character.portrait_image_id;
      }
    }
  }

  return blueprint;
}

function mapOpenRouterError(
  responseBody: string,
  status: number,
  model: string,
  requestBody: Record<string, unknown>,
): BlueprintGenerationError {
  const normalized = responseBody.toLowerCase();

  if (
    status >= 400 &&
    status < 500 &&
    (
      normalized.includes("json_schema") ||
      normalized.includes("response_format") ||
      normalized.includes("structured") ||
      normalized.includes("require_parameters")
    )
  ) {
    return new BlueprintGenerationError(
      "UNSUPPORTED_STRUCTURED_OUTPUTS",
      `Model "${model}" could not satisfy structured-output requirements`,
      { status, responseBody, model, requestBody },
    );
  }

  return new BlueprintGenerationError(
    "OPENROUTER_ERROR",
    `OpenRouter request failed (${status})`,
    { status, responseBody, model, requestBody },
  );
}

export async function generateBlueprint(
  options: GenerateBlueprintOptions,
): Promise<BlueprintV2> {
  const parsedBrief = StoryBriefSchema.safeParse(options.storyBrief);
  if (!parsedBrief.success) {
    throw new BlueprintGenerationError(
      "INVALID_STORY_BRIEF",
      "Story brief did not match the expected schema",
      { issues: parsedBrief.error.format() },
    );
  }

  const model = options.model.trim();
  if (!model) {
    throw new BlueprintGenerationError("OPENROUTER_ERROR", "Missing model");
  }

  const openRouterApiKey = options.openRouterApiKey.trim();
  if (!openRouterApiKey) {
    throw new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "Missing OpenRouter API key",
    );
  }

  const prompt = await loadBlueprintGeneratorPrompt();
  const fetchImpl = options.fetchImpl ?? fetch;
  const requestBody = {
    model,
    messages: [
      { role: "system" as const, content: prompt },
      {
        role: "user" as const,
        content: JSON.stringify({
          story_brief: parsedBrief.data,
          instructions:
            "Return only a JSON object that satisfies the provided response schema.",
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "BlueprintV2",
        strict: true,
        schema: buildBlueprintJsonSchema(),
      },
    },
    provider: {
      require_parameters: true,
    },
  };

  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(options.baseUrl ?? OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
        ...(options.requestId ? { "X-Request-Id": options.requestId } : {}),
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BlueprintGenerationError(
        "OPENROUTER_ERROR",
        "OpenRouter blueprint generation request timed out",
        { model, requestBody },
        error,
      );
    }

    throw new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "OpenRouter blueprint generation request failed",
      { model, requestBody },
      error,
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw mapOpenRouterError(responseBody, response.status, model, requestBody);
  }

  const payload = await response.json();
  const responseText = extractAssistantContent(payload);

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(responseText);
  } catch (error) {
    throw new BlueprintGenerationError(
      "INVALID_JSON_RESPONSE",
      "OpenRouter returned non-JSON blueprint output",
      { responseText, model, requestBody },
      error,
    );
  }

  parsedJson = stripGeneratedImageFields(parsedJson);

  const blueprint = BlueprintV2Schema.safeParse(parsedJson);
  if (!blueprint.success) {
    throw new BlueprintGenerationError(
      "SCHEMA_VALIDATION_FAILED",
      "Generated blueprint failed schema validation",
      {
        issues: blueprint.error.format(),
        responseText,
        model,
        requestBody,
      },
    );
  }

  return blueprint.data;
}
