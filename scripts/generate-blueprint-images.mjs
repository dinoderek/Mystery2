import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  buildImagePrompt,
  charactersAtLocation,
  createImageId,
  slugify,
} from "./lib/image-prompt-builder.mjs";
import { getBaseEnvPath, getBlueprintImagesDir, getBlueprintsDir, getImagesEnvPath } from "./local-config.mjs";
import { patchBlueprintFile } from "./lib/patch-blueprint-images.mjs";
import { resolveImageTargets } from "./lib/image-targets.mjs";
import { loadEnvFile } from "./supabase-utils.mjs";

const MAX_ERROR_BODY_LENGTH = 16_000;
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-1";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;

function parseCsv(value) {
  return String(value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePositiveInt(rawValue, fallback) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid AI_OPENROUTER_TIMEOUT_MS "${raw}". Expected a positive integer value.`,
    );
  }

  return parsed;
}

/**
 * Resolve a blueprint path by first checking `{configRoot}/blueprints/{value}`,
 * then falling back to the literal `value`. When `--blueprint-path` is omitted
 * entirely the function throws.
 */
export async function resolveBlueprintPath(value, repoRoot = process.cwd(), env = process.env) {
  if (!value) {
    throw new Error("Missing required --blueprint-path");
  }

  // If it's already an absolute path, use it directly.
  if (path.isAbsolute(value)) {
    return value;
  }

  const configCandidate = path.join(getBlueprintsDir(repoRoot, env), value);
  try {
    await fs.access(configCandidate);
    return configCandidate;
  } catch {
    // Fall back to the literal (cwd-relative) path.
    return value;
  }
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

export function parseGenerateImageArgs(argv, env = process.env) {
  const options = {
    blueprintPath: "",
    outputDir: getBlueprintImagesDir(),
    model: env.OPENROUTER_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    overwrite: false,
    dryRun: false,
    dryMode: false,
    parallel: false,
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
    if (token === "--parallel") {
      options.parallel = true;
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

export async function loadImageGenerationEnv(rootDir = process.cwd(), baseEnv = process.env) {
  const rootEnv = await loadEnvFile(getBaseEnvPath(rootDir, baseEnv), false);
  const imageEnv = await loadEnvFile(getImagesEnvPath(rootDir, baseEnv), false);

  return {
    ...rootEnv,
    ...imageEnv,
    ...baseEnv,
  };
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

function buildImageGenerationRequest({ model, prompt, referenceImages = [] }) {
  const contentParts = referenceImages.map((buf) => ({
    type: "image_url",
    image_url: {
      url: `data:image/png;base64,${buf.toString("base64")}`,
    },
  }));
  contentParts.push({ type: "text", text: prompt });

  return {
    model,
    messages: [
      {
        role: "user",
        content: contentParts.length === 1 ? prompt : contentParts,
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
  timeoutMs,
  referenceImages = [],
}) {
  const requestUrl = "https://openrouter.ai/api/v1/chat/completions";
  const requestBody = buildImageGenerationRequest({ model, prompt, referenceImages });
  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      requestUrl,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
      },
      timeoutMs,
    );
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImageGenerationError(
        `OpenRouter image generation timed out after ${timeoutMs}ms`,
        {
          phase: "generation",
          url: requestUrl,
          cause: error,
        },
      );
    }
    throw error;
  }

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

  let imageResponse;
  try {
    imageResponse = await fetchWithTimeout(fetchImpl, decoded, {}, timeoutMs);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ImageGenerationError(
        `Generated image download timed out after ${timeoutMs}ms`,
        {
          phase: "download",
          url: decoded,
          cause: error,
        },
      );
    }
    throw error;
  }
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

function buildOutputFilename(blueprintName, imageId) {
  return `${slugify(blueprintName)}.${imageId}.png`;
}

async function generateSingleTarget({
  target,
  blueprint,
  blueprintName,
  options,
  apiKey,
  fetchImpl,
  timeoutMs,
  referenceImages = [],
}) {
  const imageId = createImageId(blueprint.id, target.targetType, target.targetKey);
  const filename = buildOutputFilename(blueprintName, imageId);
  const outputPath = path.join(options.outputDir, filename);
  const label = formatTargetLabel(target);

  if (!options.overwrite) {
    try {
      await fs.access(outputPath);
      console.log(`[skip] ${label} — already exists: ${filename}`);
      return {
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "skipped",
        image_id: null,
        file_path: null,
        error_message: null,
      };
    } catch {
      // Continue with generation.
    }
  }

  if (options.dryRun) {
    console.log(`[dry-run] ${label} — would generate: ${filename}`);
    return {
      target_type: target.targetType,
      target_key: target.targetKey,
      status: "skipped",
      image_id: null,
      file_path: null,
      error_message: "dry-run",
    };
  }

  if (!apiKey) {
    console.log(`[error] ${label} — missing OPENROUTER_API_KEY`);
    return {
      target_type: target.targetType,
      target_key: target.targetKey,
      status: "failed",
      image_id: null,
      file_path: null,
      error_message: "Missing OPENROUTER_API_KEY",
    };
  }

  try {
    const refLabel = referenceImages.length > 0
      ? ` (${referenceImages.length} reference image(s))`
      : "";
    console.log(`[generate] ${label}${refLabel} — ${filename}...`);
    const promptOptions = referenceImages.length > 0
      ? { referenceImageCount: referenceImages.length }
      : {};
    const prompt = buildImagePrompt(blueprint, target, promptOptions);

    if (options.dryMode) {
      const requestBody = buildImageGenerationRequest({
        model: options.model,
        prompt,
        referenceImages,
      });
      console.log(
        `[dry-mode] ${label}:\n${JSON.stringify(
          {
            url: "https://openrouter.ai/api/v1/chat/completions",
            method: "POST",
            body: {
              ...requestBody,
              messages: requestBody.messages.map((msg) => ({
                ...msg,
                content: Array.isArray(msg.content)
                  ? msg.content.map((part) =>
                      part.type === "image_url"
                        ? { type: "image_url", image_url: { url: "[base64 data omitted]" } }
                        : part,
                    )
                  : msg.content,
              })),
            },
          },
          null,
          2,
        )}`,
      );
      return {
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "skipped",
        image_id: null,
        file_path: null,
        error_message: "dry-mode",
      };
    }

    const bytes = await generateImageAsset({
      prompt,
      model: options.model,
      apiKey,
      fetchImpl,
      timeoutMs,
      referenceImages,
    });
    await fs.writeFile(outputPath, bytes);
    console.log(`[done] ${label} — ${outputPath}`);

    return {
      target_type: target.targetType,
      target_key: target.targetKey,
      status: "generated",
      image_id: imageId,
      file_path: outputPath,
      error_message: null,
    };
  } catch (error) {
    const errorMessage = formatGenerationError(error);
    console.error(
      `[error] ${label}\n${errorMessage}`,
    );
    return {
      target_type: target.targetType,
      target_key: target.targetKey,
      status: "failed",
      image_id: null,
      file_path: null,
      error_message: errorMessage,
    };
  }
}

export async function runImageGeneration(rawOptions, dependencies = {}) {
  const options = { ...rawOptions };
  const fetchImpl = dependencies.fetchImpl ?? fetch;
  const env = dependencies.env ?? process.env;
  const apiKey = dependencies.apiKey ?? env.OPENROUTER_API_KEY ?? "";
  const timeoutMs = parsePositiveInt(
    env.AI_OPENROUTER_TIMEOUT_MS,
    DEFAULT_OPENROUTER_TIMEOUT_MS,
  );

  options.blueprintPath = await resolveBlueprintPath(
    options.blueprintPath,
    process.cwd(),
    env,
  );

  const blueprintRaw = await fs.readFile(options.blueprintPath, "utf-8");
  const blueprint = JSON.parse(blueprintRaw);

  if (blueprint.schema_version !== "v2") {
    throw new Error(
      `Blueprint schema_version must be "v2", got "${blueprint.schema_version ?? "undefined"}". ` +
        "V1 blueprints are no longer supported by the image generator.",
    );
  }

  const targets = resolveImageTargets(blueprint, {
    scope: options.scope,
    characterKeys: options.characterKeys,
    locationKeys: options.locationKeys,
  });

  const blueprintName = blueprint.metadata?.title ?? blueprint.id;

  // Split targets into two phases: portraits first, then locations.
  // This lets us feed generated character portraits as reference images
  // into the location scene generation for visual consistency.
  const phase1Targets = targets.filter((t) => t.targetType !== "location");
  const phase2Targets = targets.filter((t) => t.targetType === "location");

  const totalCount = targets.length;
  const hasPhase2 = phase2Targets.length > 0;
  console.log(
    `Generating images for "${blueprintName}" — ${totalCount} target(s)${options.parallel ? " (parallel)" : ""}` +
      (hasPhase2 ? ` (phase 1: ${phase1Targets.length} portrait(s), phase 2: ${phase2Targets.length} location(s))` : ""),
  );

  await fs.mkdir(options.outputDir, { recursive: true });

  const baseArgs = { blueprint, blueprintName, options, apiKey, fetchImpl, timeoutMs };

  // --- Phase 1: blueprint cover + character portraits ---
  const phase1Args = phase1Targets.map((target) => ({ ...baseArgs, target }));
  let phase1Results;
  if (options.parallel) {
    phase1Results = await Promise.all(phase1Args.map(generateSingleTarget));
  } else {
    phase1Results = [];
    for (const args of phase1Args) {
      phase1Results.push(await generateSingleTarget(args));
    }
  }

  // Build a map of character target_key → generated file_path for reference images.
  const portraitPaths = new Map();
  for (const result of phase1Results) {
    if (result.target_type === "character" && result.status === "generated" && result.file_path) {
      portraitPaths.set(result.target_key, result.file_path);
    }
  }

  // --- Phase 2: location scenes (with character portrait references) ---
  let phase2Results = [];
  if (phase2Targets.length > 0) {
    if (portraitPaths.size > 0) {
      console.log(`[info] ${portraitPaths.size} portrait(s) available as reference for location scenes`);
    }

    const phase2Args = await Promise.all(
      phase2Targets.map(async (target) => {
        const present = charactersAtLocation(blueprint, target.targetKey);
        const refBuffers = [];
        for (const character of present) {
          const portraitPath = portraitPaths.get(character.id);
          if (portraitPath) {
            try {
              refBuffers.push(await fs.readFile(portraitPath));
            } catch {
              // Portrait file unreadable — skip this reference.
            }
          }
        }
        return { ...baseArgs, target, referenceImages: refBuffers };
      }),
    );

    if (options.parallel) {
      phase2Results = await Promise.all(phase2Args.map(generateSingleTarget));
    } else {
      for (const args of phase2Args) {
        phase2Results.push(await generateSingleTarget(args));
      }
    }
  }

  const results = [...phase1Results, ...phase2Results];

  await patchBlueprintFile(options.blueprintPath, results);

  return {
    blueprint_id: blueprint.id,
    results,
  };
}

async function main() {
  const env = await loadImageGenerationEnv();
  const options = parseGenerateImageArgs(process.argv.slice(2), env);
  const output = await runImageGeneration(options, { env });
  console.log(JSON.stringify(output, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(formatGenerationError(error));
    process.exit(1);
  });
}
