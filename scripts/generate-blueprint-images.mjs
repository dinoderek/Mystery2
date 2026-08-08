import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_IMAGE_ASPECT_RATIO,
  buildImagePrompt,
  charactersAtLocation,
  createImageId,
} from "./lib/image-prompt-builder.mjs";
import { buildImageChatPacket, formatImageTargetLabel } from "./lib/image-chat-packet-builder.mjs";
import {
  getBaseEnvPath,
  getBlueprintImagesDir,
  getBlueprintsDir,
  getChatGenPromptsDir,
  getImagesEnvPath,
} from "./local-config.mjs";
import { patchBlueprintFile } from "./lib/patch-blueprint-images.mjs";
import { resolveImageTargets } from "./lib/image-targets.mjs";
import { loadEnvFile } from "./supabase-utils.mjs";

const MAX_ERROR_BODY_LENGTH = 16_000;
// OpenRouter serves image models from a dedicated Images API; image models are
// rejected by /chat/completions with a 404.
export const OPENROUTER_IMAGES_URL = "https://openrouter.ai/api/v1/images";
const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;
// The documented ratio union. Per-model support is a subset and is only
// discoverable via GET /api/v1/images/models, so this is a syntax check only.
const SUPPORTED_ASPECT_RATIOS = new Set([
  "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9", "auto",
]);
// gpt-image-1 and gpt-image-2 both advertise input_references 0-16.
const MAX_INPUT_REFERENCES = 16;

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
    chatPackets: false,
    chatPacketsCombined: false,
    importImages: false,
    importDir: "",
    outputDir: "",
    model: env.OPENROUTER_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
    aspectRatio: env.OPENROUTER_IMAGE_ASPECT_RATIO || DEFAULT_IMAGE_ASPECT_RATIO,
    dryRun: false,
    dryMode: false,
    parallel: false,
    scope: null,
    characterKeys: [],
    locationKeys: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (token === "--chat-packets") {
      options.chatPackets = true;
      continue;
    }
    if (token === "--chat-packets-combined") {
      options.chatPackets = true;
      options.chatPacketsCombined = true;
      continue;
    }
    if (token === "--import-images") {
      options.importImages = true;
      continue;
    }
    if (token === "--import-dir") {
      options.importDir = String(argv[index + 1] ?? "");
      index += 1;
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
    if (token === "--aspect-ratio") {
      options.aspectRatio = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (options.importImages && !options.importDir) {
    options.importDir = getBlueprintImagesDir(undefined, env);
  }
  if (!options.outputDir) {
    options.outputDir = options.chatPackets
      ? path.join(getChatGenPromptsDir(undefined, env), "images")
      : getBlueprintImagesDir(undefined, env);
  }
  if (!options.outputDir) {
    throw new Error("Missing required --output-dir");
  }
  if (!options.importImages && !options.chatPackets && !options.model) {
    throw new Error("Missing required --model");
  }
  if (!options.importImages && !SUPPORTED_ASPECT_RATIOS.has(options.aspectRatio)) {
    throw new Error(
      `Invalid --aspect-ratio "${options.aspectRatio}". Expected one of: ` +
        `${[...SUPPORTED_ASPECT_RATIOS].join(", ")}. Per-model support varies — ` +
        "see GET https://openrouter.ai/api/v1/images/models.",
    );
  }
  if (options.chatPackets && options.dryMode) {
    throw new Error("Cannot combine --chat-packets with --dry-mode");
  }
  if (options.chatPackets && options.dryRun) {
    throw new Error("Cannot combine --chat-packets with --dry-run");
  }
  if (options.importImages && options.chatPackets) {
    throw new Error("Cannot combine --import-images with --chat-packets");
  }
  if (options.importImages && options.dryRun) {
    throw new Error("Cannot combine --import-images with --dry-run");
  }
  if (options.importImages && options.dryMode) {
    throw new Error("Cannot combine --import-images with --dry-mode");
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

export class ImageGenerationError extends Error {
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

function extractProviderErrorMessage(responseBody) {
  try {
    const parsed = JSON.parse(responseBody);
    const message = parsed?.error?.message ?? parsed?.message;
    return typeof message === "string" && message.trim() ? message.trim() : null;
  } catch {
    return null;
  }
}

function describeImagesApiFailure(status, responseBody) {
  const summary =
    status === 502
      ? "OpenRouter image generation failed upstream (502): the provider returned no image (not billed)"
      : `OpenRouter image generation failed (${status})`;
  const providerMessage = extractProviderErrorMessage(responseBody);
  return providerMessage ? `${summary}: ${providerMessage}` : summary;
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

export function buildImageGenerationRequest({
  model,
  prompt,
  aspectRatio,
  referenceImages = [],
}) {
  const body = {
    model,
    prompt,
    aspect_ratio: aspectRatio,
    // buildOutputFilename() and the canonical image-id contract both assume PNG.
    output_format: "png",
  };

  // References go out in array order — the model uses ordinal position to match
  // the indexed legend generated by buildReferenceLegend().
  if (referenceImages.length > 0) {
    body.input_references = referenceImages.map((ref) => {
      const buf = ref.buffer ?? ref;
      return {
        type: "image_url",
        image_url: { url: `data:image/png;base64,${buf.toString("base64")}` },
      };
    });
  }

  return body;
}

function redactImageRequestBody(requestBody) {
  if (!Array.isArray(requestBody.input_references)) {
    return requestBody;
  }
  return {
    ...requestBody,
    input_references: requestBody.input_references.map((ref) => ({
      type: ref.type,
      image_url: { url: "[base64 data omitted]" },
    })),
  };
}

/**
 * A success payload carries a multi-megabyte base64 blob. Never let it reach an
 * error message — those are printed and persisted into the blueprint.
 */
function summarizeImagePayload(payload) {
  const summary = JSON.stringify(
    payload,
    (key, value) =>
      key === "b64_json" && typeof value === "string"
        ? `[${value.length} base64 chars omitted]`
        : value,
    2,
  );
  if (summary.length <= MAX_ERROR_BODY_LENGTH) {
    return summary;
  }
  return `${summary.slice(0, MAX_ERROR_BODY_LENGTH)}\n... [truncated ${summary.length - MAX_ERROR_BODY_LENGTH} chars]`;
}

export function parseImagePayload(payload) {
  const first = Array.isArray(payload?.data) ? payload.data[0] : null;
  if (!first || typeof first !== "object") {
    throw new ImageGenerationError("Images API response missing data[0]", {
      phase: "parse",
      responseBody: summarizeImagePayload(payload),
    });
  }

  const b64 = typeof first.b64_json === "string" ? first.b64_json.trim() : "";
  if (!b64) {
    const hint =
      typeof first.url === "string" && first.url
        ? "; data[0].url was returned instead, which this CLI does not support"
        : "";
    throw new ImageGenerationError(
      `Images API response missing data[0].b64_json${hint}`,
      {
        phase: "parse",
        responseBody: summarizeImagePayload(payload),
      },
    );
  }

  // media_type is present whenever the format is identifiable, and omitted only
  // when it could not be determined — so only reject a positive mismatch.
  const mediaType = typeof first.media_type === "string" ? first.media_type : null;
  if (mediaType && mediaType !== "image/png") {
    throw new ImageGenerationError(
      `Images API returned ${mediaType} but the CLI writes .png files (requested output_format=png)`,
      {
        phase: "parse",
        responseBody: summarizeImagePayload(payload),
      },
    );
  }

  return Buffer.from(b64, "base64");
}

export async function generateImageAsset({
  prompt,
  model,
  aspectRatio,
  apiKey,
  fetchImpl,
  timeoutMs,
  referenceImages = [],
}) {
  const requestBody = buildImageGenerationRequest({
    model,
    prompt,
    aspectRatio,
    referenceImages,
  });

  let response;
  try {
    response = await fetchWithTimeout(
      fetchImpl,
      OPENROUTER_IMAGES_URL,
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
          url: OPENROUTER_IMAGES_URL,
          cause: error,
        },
      );
    }
    throw error;
  }

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    throw new ImageGenerationError(
      describeImagesApiFailure(response.status, responseBody),
      {
        phase: "generation",
        status: response.status,
        statusText: response.statusText,
        url: OPENROUTER_IMAGES_URL,
        responseBody,
      },
    );
  }

  return parseImagePayload(await response.json());
}

function buildOutputFilename(baseImageId) {
  return `${baseImageId}.png`;
}

async function findUniqueOutput(outputDir, baseImageId) {
  const filename = buildOutputFilename(baseImageId);
  const outputPath = path.join(outputDir, filename);

  try {
    await fs.access(outputPath);
  } catch {
    return { imageId: `${baseImageId}.png`, filename, outputPath };
  }

  let count = 1;
  while (true) {
    const suffixedId = `${baseImageId}-${count}`;
    const fn = buildOutputFilename(suffixedId);
    const op = path.join(outputDir, fn);
    try {
      await fs.access(op);
    } catch {
      return { imageId: `${suffixedId}.png`, filename: fn, outputPath: op };
    }
    count += 1;
  }
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
  const baseImageId = createImageId(blueprintName, target.targetType, target.targetKey);
  const { imageId, filename, outputPath } = await findUniqueOutput(
    options.outputDir,
    baseImageId,
  );
  const label = formatImageTargetLabel(target);

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
    // Truncate here rather than in the request builder so the prompt legend
    // stays ordinally aligned with the references actually sent.
    const refs = referenceImages.slice(0, MAX_INPUT_REFERENCES);
    if (referenceImages.length > refs.length) {
      console.log(
        `[warn] ${label} — ${referenceImages.length} reference(s) exceed the ` +
          `${MAX_INPUT_REFERENCES} cap; sending the first ${refs.length}`,
      );
    }
    const refLabel = refs.length > 0 ? ` (${refs.length} reference image(s))` : "";
    console.log(`[generate] ${label}${refLabel} — ${filename}...`);
    const prompt = buildImagePrompt(blueprint, target, {
      referenceImages: refs,
      aspectRatio: options.aspectRatio,
    });

    if (options.dryMode) {
      const requestBody = buildImageGenerationRequest({
        model: options.model,
        prompt,
        aspectRatio: options.aspectRatio,
        referenceImages: refs,
      });
      console.log(
        `[dry-mode] ${label}:\n${JSON.stringify(
          {
            url: OPENROUTER_IMAGES_URL,
            method: "POST",
            body: redactImageRequestBody(requestBody),
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
      aspectRatio: options.aspectRatio,
      apiKey,
      fetchImpl,
      timeoutMs,
      referenceImages: refs,
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

async function importGeneratedImages({
  blueprint,
  blueprintName,
  options,
}) {
  const targets = resolveImageTargets(blueprint, {
    scope: options.scope,
    characterKeys: options.characterKeys,
    locationKeys: options.locationKeys,
  });

  const importDir = options.importDir || options.outputDir;
  console.log(
    `Importing images for "${blueprintName}" from ${importDir} — ${targets.length} target(s)`,
  );

  let entries;
  try {
    entries = await fs.readdir(importDir);
  } catch {
    console.error(`[error] Import directory not found: ${importDir}`);
    return {
      blueprint_id: blueprint.id,
      results: targets.map((target) => ({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "failed",
        image_id: null,
        file_path: null,
        error_message: `Import directory not found: ${importDir}`,
      })),
    };
  }

  const pngFiles = new Set(entries.filter((file) => file.endsWith(".png")));
  const results = [];

  for (const target of targets) {
    const baseImageId = createImageId(blueprintName, target.targetType, target.targetKey);
    const expectedFilename = `${baseImageId}.png`;
    const label = formatImageTargetLabel(target);

    if (pngFiles.has(expectedFilename)) {
      const filePath = path.join(importDir, expectedFilename);
      console.log(`[matched] ${label} — ${filePath}`);
      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "generated",
        image_id: expectedFilename,
        file_path: filePath,
        error_message: null,
      });
    } else {
      console.log(`[missing] ${label} — expected ${expectedFilename}`);
      results.push({
        target_type: target.targetType,
        target_key: target.targetKey,
        status: "skipped",
        image_id: null,
        file_path: null,
        error_message: `File not found: ${expectedFilename}`,
      });
    }
  }

  const matched = results.filter((r) => r.status === "generated");
  const missing = results.filter((r) => r.status !== "generated");
  console.log(
    `[summary] ${matched.length} matched, ${missing.length} missing`,
  );

  if (matched.length > 0) {
    await patchBlueprintFile(options.blueprintPath, results);
    console.log(`[patched] Blueprint updated with ${matched.length} image ID(s)`);
  }

  return {
    blueprint_id: blueprint.id,
    results,
  };
}

function buildChatPacketPath(outputDir, blueprintName, target) {
  const packetBaseName = createImageId(
    blueprintName,
    target.targetType,
    target.targetKey,
  );
  return path.join(outputDir, `${packetBaseName}.chat.md`);
}

async function exportImageChatPackets({
  blueprint,
  blueprintName,
  options,
}) {
  const targets = resolveImageTargets(blueprint, {
    scope: options.scope,
    characterKeys: options.characterKeys,
    locationKeys: options.locationKeys,
  });

  const mode = options.chatPacketsCombined ? "combined" : "individual";
  console.log(
    `Generating chat image packets for "${blueprintName}" - ${targets.length} target(s) (${mode})`,
  );

  await fs.mkdir(options.outputDir, { recursive: true });

  const results = [];
  const combinedSections = [];

  for (const target of targets) {
    const packetText = buildImageChatPacket({
      blueprint,
      target,
      aspectRatio: options.aspectRatio,
    });

    if (options.chatPacketsCombined) {
      combinedSections.push(packetText);
    } else {
      const outputPath = buildChatPacketPath(options.outputDir, blueprintName, target);
      await fs.writeFile(outputPath, packetText, "utf-8");
      console.log(`[chat-packet] ${formatImageTargetLabel(target)} - ${outputPath}`);
    }

    results.push({
      target_type: target.targetType,
      target_key: target.targetKey,
      status: "generated",
      image_id: null,
      file_path: options.chatPacketsCombined ? null : buildChatPacketPath(options.outputDir, blueprintName, target),
      error_message: null,
      output_kind: "chat_packet",
    });
  }

  if (options.chatPacketsCombined && combinedSections.length > 0) {
    const combinedName = createImageId(blueprintName, "all-targets");
    const combinedPath = path.join(options.outputDir, `${combinedName}.chat.md`);
    const combinedContent = combinedSections.join("\n---\n\n");
    await fs.writeFile(combinedPath, combinedContent, "utf-8");
    console.log(`[chat-packet-combined] ${targets.length} target(s) — ${combinedPath}`);
    for (const result of results) {
      result.file_path = combinedPath;
    }
  }

  return {
    blueprint_id: blueprint.id,
    results,
  };
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

  if (options.importImages) {
    return importGeneratedImages({
      blueprint,
      blueprintName,
      options,
    });
  }

  if (options.chatPackets) {
    return exportImageChatPackets({
      blueprint,
      blueprintName,
      options,
    });
  }

  // Split targets into three phases:
  //   Phase 1: character portraits (no references needed)
  //   Phase 2: location scenes (receive portrait references for characters at each location)
  //   Phase 3: blueprint cover (receives portrait + location scene references from cover_image)
  const phase1Targets = targets.filter((t) => t.targetType === "character");
  const phase2Targets = targets.filter((t) => t.targetType === "location");
  const phase3Targets = targets.filter((t) => t.targetType === "blueprint");

  const phaseSummary = [
    phase1Targets.length > 0 ? `phase 1: ${phase1Targets.length} portrait(s)` : null,
    phase2Targets.length > 0 ? `phase 2: ${phase2Targets.length} location(s)` : null,
    phase3Targets.length > 0 ? "phase 3: cover" : null,
  ].filter(Boolean).join(", ");

  console.log(
    `Generating images for "${blueprintName}" — ${targets.length} target(s)${options.parallel ? " (parallel)" : ""}` +
      (phaseSummary ? ` (${phaseSummary})` : ""),
  );

  await fs.mkdir(options.outputDir, { recursive: true });

  const baseArgs = { blueprint, blueprintName, options, apiKey, fetchImpl, timeoutMs };

  async function runPhase(phaseArgs) {
    if (options.parallel) {
      return Promise.all(phaseArgs.map(generateSingleTarget));
    }
    const results = [];
    for (const args of phaseArgs) {
      results.push(await generateSingleTarget(args));
    }
    return results;
  }

  // Maps populated after each phase and read by subsequent phases' helpers.
  const portraitPaths = new Map();
  const locationPaths = new Map();

  async function readPortraitRef(characterId) {
    const portraitPath = portraitPaths.get(characterId);
    if (!portraitPath) return null;
    const character = (blueprint.world?.characters ?? []).find((c) => c.id === characterId);
    try {
      return {
        label: `Portrait of ${character?.first_name ?? ""} ${character?.last_name ?? ""} (${character?.appearance ?? ""})`.trim(),
        buffer: await fs.readFile(portraitPath),
      };
    } catch {
      return null;
    }
  }

  async function readLocationRef(locationId) {
    const locationPath = locationPaths.get(locationId);
    if (!locationPath) return null;
    const location = (blueprint.world?.locations ?? []).find((l) => l.id === locationId);
    try {
      return {
        label: `Location scene — ${location?.name ?? locationId}`,
        buffer: await fs.readFile(locationPath),
      };
    } catch {
      return null;
    }
  }

  // --- Phase 1: character portraits ---
  const phase1Args = phase1Targets.map((target) => ({ ...baseArgs, target }));
  const phase1Results = await runPhase(phase1Args);

  // Populate portrait path map for phase 2 and 3 references.
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
        const refs = (
          await Promise.all(present.map((c) => readPortraitRef(c.id)))
        ).filter(Boolean);
        return { ...baseArgs, target, referenceImages: refs };
      }),
    );

    phase2Results = await runPhase(phase2Args);
  }

  // Populate location path map for phase 3 references.
  for (const result of phase2Results) {
    if (result.target_type === "location" && result.status === "generated" && result.file_path) {
      locationPaths.set(result.target_key, result.file_path);
    }
  }

  // --- Phase 3: blueprint cover (with portrait + location scene references) ---
  let phase3Results = [];
  if (phase3Targets.length > 0) {
    const coverImage = blueprint.cover_image;
    const refs = [];

    // Add portrait references from cover_image.character_ids.
    for (const charId of coverImage?.character_ids ?? []) {
      const ref = await readPortraitRef(charId);
      if (ref) refs.push(ref);
    }
    // Add location scene references from cover_image.location_ids.
    for (const locId of coverImage?.location_ids ?? []) {
      const ref = await readLocationRef(locId);
      if (ref) refs.push(ref);
    }

    if (refs.length > 0) {
      console.log(`[info] ${refs.length} reference(s) available for cover image`);
    }

    const phase3Args = phase3Targets.map((target) => ({
      ...baseArgs,
      target,
      referenceImages: refs,
    }));
    phase3Results = await runPhase(phase3Args);
  }

  const results = [...phase1Results, ...phase2Results, ...phase3Results];

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
