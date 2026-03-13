import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildImagePrompt,
  createImageId,
} from "./lib/image-prompt-builder.mjs";
import { patchBlueprintFile } from "./lib/patch-blueprint-images.mjs";
import { resolveImageTargets } from "./lib/image-targets.mjs";

const MAX_ERROR_BODY_LENGTH = 16_000;

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseGenerateImageArgs(argv) {
  const options = {
    blueprintPath: "",
    outputDir: "generated/blueprint-images",
    model: process.env.OPENROUTER_IMAGE_MODEL || "openai/gpt-image-1",
    overwrite: false,
    dryRun: false,
    dryMode: false,
    scope: null,
    characterKeys: [],
    locationKeys: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--overwrite") {
      options.overwrite = true;
      continue;
    }
    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--dry-mode") {
      options.dryMode = true;
      continue;
    }
    if (token === "--all") {
      options.scope = "all";
      continue;
    }
    if (token === "--blueprint") {
      options.scope = "blueprint";
      continue;
    }
    if (token === "--characters") {
      options.scope = "characters";
      options.characterKeys = parseCsv(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--locations") {
      options.scope = "locations";
      options.locationKeys = parseCsv(argv[index + 1]);
      index += 1;
      continue;
    }
    if (token === "--character") {
      options.characterKeys.push(String(argv[index + 1] ?? "").trim());
      index += 1;
      continue;
    }
    if (token === "--location") {
      options.locationKeys.push(String(argv[index + 1] ?? "").trim());
      index += 1;
      continue;
    }
    if (token === "--blueprint-path") {
      options.blueprintPath = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--output-dir") {
      options.outputDir = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--model") {
      options.model = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!options.blueprintPath) {
    throw new Error("Missing required --blueprint-path");
  }
  if (!options.outputDir) {
    throw new Error("Missing required --output-dir");
  }
  if (!options.model) {
    throw new Error("Missing required --model");
  }

  if (options.scope === null) {
    options.scope =
      options.characterKeys.length > 0 || options.locationKeys.length > 0
        ? "selected"
        : "all";
  }

  return options;
}

class ImageGenerationError extends Error {
  constructor(message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = "ImageGenerationError";
    this.phase = details.phase ?? "generation";
    this.status = details.status ?? null;
    this.statusText = details.statusText ?? null;
    this.url = details.url ?? null;
    this.responseBody = details.responseBody ?? null;
  }
}

async function readResponseBody(response) {
  try {
    const text = await response.text();
    if (text.length <= MAX_ERROR_BODY_LENGTH) {
      return text;
    }
    return `${text.slice(0, MAX_ERROR_BODY_LENGTH)}\n... [truncated ${text.length - MAX_ERROR_BODY_LENGTH} chars]`;
  } catch (error) {
    return `[unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function formatGenerationError(error) {
  if (error instanceof Error) {
    const lines = [];
    lines.push(`${error.name}: ${error.message}`);

    const typed = /** @type {Error & {
      phase?: string | null,
      status?: number | null,
      statusText?: string | null,
      url?: string | null,
      responseBody?: string | null
    }} */ (error);

    if (typed.phase) lines.push(`Phase: ${typed.phase}`);
    if (typeof typed.status === "number") {
      const statusLine = typed.statusText
        ? `${typed.status} ${typed.statusText}`
        : `${typed.status}`;
      lines.push(`HTTP status: ${statusLine}`);
    }
    if (typed.url) lines.push(`URL: ${typed.url}`);
    if (typed.responseBody) lines.push(`Response body:\n${typed.responseBody}`);
    if (error.cause) {
      lines.push(
        `Cause: ${error.cause instanceof Error ? error.cause.stack ?? error.cause.message : String(error.cause)}`,
      );
    }
    if (error.stack) lines.push(`Stack:\n${error.stack}`);
    return lines.join("\n");
  }

  return String(error);
}

function formatTargetLabel(target) {
  if (target.targetType === "blueprint") {
    return "Blueprint";
  }

  return `${target.targetType === "character" ? "Character" : "Location"} ${target.targetKey}`;
}

function decodeDataUrl(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/u.exec(dataUrl);
  if (!match) {
    throw new Error("Image data URL is not base64 encoded");
  }
  return Buffer.from(match[2], "base64");
}

function buildImageGenerationRequest({ model, prompt }) {
  return {
    model,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    modalities: ["image", "text"],
    image_config: {
      aspect_ratio: "4:3",
    },
    stream: false,
  };
}

function parseImagePayload(payload) {
  const message = payload?.choices?.[0]?.message;
  const first = Array.isArray(message?.images) ? message.images[0] : null;
  if (!first || typeof first !== "object") {
    throw new ImageGenerationError(
      "Image provider response missing choices[0].message.images[0]",
      {
        phase: "parse",
        responseBody: JSON.stringify(payload, null, 2),
      },
    );
  }

  const nestedUrl =
    first?.image_url?.url ??
    first?.imageUrl?.url ??
    first?.url ??
    null;

  if (typeof nestedUrl === "string" && nestedUrl.length > 0) {
    if (nestedUrl.startsWith("data:")) {
      return decodeDataUrl(nestedUrl);
    }
    return nestedUrl;
  }

  throw new ImageGenerationError(
    "Image provider response missing image URL",
    {
      phase: "parse",
      responseBody: JSON.stringify(payload, null, 2),
    },
  );
}

async function generateImageAsset({
  prompt,
  model,
  apiKey,
  fetchImpl,
}) {
  const requestUrl = "https://openrouter.ai/api/v1/chat/completions";
  const requestBody = buildImageGenerationRequest({ model, prompt });
  const response = await fetchImpl(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    throw new ImageGenerationError(
      `OpenRouter image generation failed (${response.status})`,
      {
        phase: "generation",
        status: response.status,
        statusText: response.statusText,
        url: requestUrl,
        responseBody,
      },
    );
  }

  const payload = await response.json();
  const decoded = parseImagePayload(payload);
  if (Buffer.isBuffer(decoded)) {
    return decoded;
  }

  const imageResponse = await fetchImpl(decoded);
  if (!imageResponse.ok) {
    const responseBody = await readResponseBody(imageResponse);
    throw new ImageGenerationError(
      `Failed to download generated image (${imageResponse.status})`,
      {
        phase: "download",
        status: imageResponse.status,
        statusText: imageResponse.statusText,
        url: decoded,
        responseBody,
      },
    );
  }
  const bytes = await imageResponse.arrayBuffer();
  return Buffer.from(bytes);
}

export async function runImageGeneration(rawOptions, dependencies = {}) {
  const options = { ...rawOptions };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const apiKey = dependencies.apiKey ?? process.env.OPENROUTER_API_KEY ?? "";

  const blueprintRaw = await fs.readFile(options.blueprintPath, "utf-8");
  const blueprint = JSON.parse(blueprintRaw);

  const targets = resolveImageTargets(blueprint, {
    scope: options.scope,
    characterKeys: options.characterKeys,
    locationKeys: options.locationKeys,
  });

  await fs.mkdir(options.outputDir, { recursive: true });

  const results = [];
  for (const target of targets) {
    const imageId = createImageId(blueprint.id, target.targetType, target.targetKey);
    const outputPath = path.join(options.outputDir, `${imageId}.png`);

    if (!options.overwrite) {
      try {
        await fs.access(outputPath);
        results.push({
          target_type: target.targetType,
          target_key: target.targetKey,
          status: "skipped",
          image_id: null,
          file_path: null,
          error_message: null,
        });
        continue;
      } catch {
        // Continue with generation.
      }
    }

    if (options.dryRun) {
      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "skipped",
        image_id: null,
        file_path: null,
        error_message: "dry-run",
      });
      continue;
    }

    if (!apiKey) {
      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "failed",
        image_id: null,
        file_path: null,
        error_message: "Missing OPENROUTER_API_KEY",
      });
      continue;
    }

    try {
      console.log(`Starting generation for ${formatTargetLabel(target)}...`);
      const prompt = buildImagePrompt(blueprint, target);

      if (options.dryMode) {
        const requestBody = buildImageGenerationRequest({
          model: options.model,
          prompt,
        });
        console.log(
          `Dry mode request for ${formatTargetLabel(target)}:\n${JSON.stringify(
            {
              url: "https://openrouter.ai/api/v1/chat/completions",
              method: "POST",
              body: requestBody,
            },
            null,
            2,
          )}`,
        );
        results.push({
          target_type: target.targetType,
          target_key: target.targetKey,
          status: "skipped",
          image_id: null,
          file_path: null,
          error_message: "dry-mode",
        });
        continue;
      }

      const bytes = await generateImageAsset({
        prompt,
        model: options.model,
        apiKey,
        fetchImpl,
      });
      await fs.writeFile(outputPath, bytes);
      console.log(`Generated image for ${formatTargetLabel(target)}: ${outputPath}`);

      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "generated",
        image_id: imageId,
        file_path: outputPath,
        error_message: null,
      });
    } catch (error) {
      const errorMessage = formatGenerationError(error);
      console.error(
        `[image-generation] target=${target.targetType}:${target.targetKey ?? "blueprint"}\n${errorMessage}`,
      );
      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "failed",
        image_id: null,
        file_path: null,
        error_message: errorMessage,
      });
    }
  }

  await patchBlueprintFile(options.blueprintPath, results);

  return {
    blueprint_id: blueprint.id,
    results,
  };
}

async function main() {
  const options = parseGenerateImageArgs(process.argv.slice(2));
  const output = await runImageGeneration(options);
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatGenerationError(error));
    process.exit(1);
  });
}
