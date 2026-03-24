import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { zodToJsonSchema } from "zod-to-json-schema";

import {
  BlueprintGenerationError,
  StoryBriefSchema,
  generateBlueprint,
} from "../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../packages/shared/src/blueprint-schema-v2.ts";
import {
  BLUEPRINT_EVALUATION_PROMPT,
  BlueprintEvaluationOutputSchema,
} from "../packages/shared/src/evaluation/index.ts";
import { getBaseEnvPath } from "./local-config.mjs";
import { loadEnvFile } from "./supabase-utils.mjs";

const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_VERIFICATION_MODEL = "google/gemini-3-flash-preview";

function parsePositiveInt(
  rawValue,
  fallback,
  label = "AI_OPENROUTER_TIMEOUT_MS",
) {
  const raw = String(rawValue ?? "").trim();
  if (!raw) return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${label} "${raw}". Expected a positive integer value.`,
    );
  }

  return parsed;
}

function parseModelList(rawValue) {
  return String(rawValue ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function sanitizeFilenameSegment(rawValue, fallback) {
  const sanitized = String(rawValue ?? "")
    .trim()
    .replace(/[\\/]+/g, "_")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return sanitized || fallback;
}

function stripJsonExtension(filePath) {
  return filePath.endsWith(".json") ? filePath.slice(0, -5) : filePath;
}

function buildGeneratedOutputPath(outputFile, model, briefFile) {
  const baseOutputFile = stripJsonExtension(outputFile);
  const modelSegment = sanitizeFilenameSegment(model, "model");
  const briefSegment = sanitizeFilenameSegment(
    path.parse(briefFile).name,
    "blueprint",
  );

  return `${baseOutputFile}.${modelSegment}.${briefSegment}.json`;
}

function buildVerificationOutputPath(outputPath) {
  return `${stripJsonExtension(outputPath)}.verification.json`;
}

function formatGenerationJob(job) {
  return `model=${job.model} brief=${job.briefFile}`;
}

function createCliLogger() {
  return {
    info(message) {
      process.stderr.write(`${message}\n`);
    },
    error(message) {
      process.stderr.write(`${message}\n`);
    },
  };
}

class BlueprintBatchGenerationError extends Error {
  constructor(message, failures, results) {
    super(message);
    this.name = "BlueprintBatchGenerationError";
    this.failures = failures;
    this.results = results;
  }
}

export class BlueprintVerificationError extends Error {
  constructor(message, details = {}, cause) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = "BlueprintVerificationError";
    this.details = details;
  }
}

function buildSummaryEntry({
  status,
  briefFile,
  model,
  verificationModel,
  outputPath,
  verificationFile,
  verificationStatus = null,
  overallPass = null,
}) {
  return {
    status,
    brief_file: briefFile,
    model,
    verification_model: verificationModel,
    blueprint_file: outputPath || null,
    verification_file: verificationFile || null,
    verification_status: verificationStatus,
    overall_pass: overallPass,
  };
}

export function parseGenerateBlueprintArgs(argv, env = process.env) {
  const options = {
    briefFiles: [],
    output: "",
    outputFile: "",
    models: parseModelList(
      env.OPENROUTER_BLUEPRINT_MODEL || env.AI_MODEL || "",
    ),
    verificationModel: DEFAULT_VERIFICATION_MODEL,
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
    timeoutMs: parsePositiveInt(
      env.AI_OPENROUTER_TIMEOUT_MS,
      DEFAULT_OPENROUTER_TIMEOUT_MS,
    ),
    parallelism: 1,
  };
  let cliModelsSpecified = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--brief-file") {
      options.briefFiles.push(String(argv[index + 1] ?? ""));
      index += 1;
      continue;
    }
    if (token === "--output") {
      options.output = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--output-file") {
      options.outputFile = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--model") {
      if (!cliModelsSpecified) {
        options.models = [];
        cliModelsSpecified = true;
      }
      options.models.push(...parseModelList(argv[index + 1]));
      index += 1;
      continue;
    }
    if (token === "--openrouter-api-key") {
      options.openRouterApiKey = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--verification-model") {
      options.verificationModel = String(argv[index + 1] ?? "").trim();
      index += 1;
      continue;
    }
    if (token === "--parallel") {
      options.parallelism = Number.POSITIVE_INFINITY;
      continue;
    }
    if (token === "--parallelism") {
      options.parallelism = parsePositiveInt(
        argv[index + 1],
        1,
        "--parallelism",
      );
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (options.briefFiles.length === 0) {
    throw new Error("Missing required --brief-file");
  }
  if (options.models.length === 0) {
    throw new Error(
      "Missing required --model (or OPENROUTER_BLUEPRINT_MODEL / AI_MODEL env)",
    );
  }
  if (!options.openRouterApiKey) {
    throw new Error(
      "Missing required --openrouter-api-key (or OPENROUTER_API_KEY env)",
    );
  }
  if (!options.verificationModel) {
    throw new Error("Missing required --verification-model");
  }
  if (options.output && options.outputFile) {
    throw new Error("Choose either --output or --output-file, not both");
  }

  const jobCount = options.briefFiles.length * options.models.length;
  if (jobCount > 1 && options.output) {
    throw new Error(
      "--output can only be used with a single --brief-file and single --model",
    );
  }
  if (jobCount > 1 && !options.outputFile) {
    throw new Error(
      "Multiple --brief-file/--model combinations require --output-file",
    );
  }

  return options;
}

export async function loadBlueprintGenerationEnv(
  rootDir = process.cwd(),
  baseEnv = process.env,
) {
  const rootEnv = await loadEnvFile(getBaseEnvPath(rootDir, baseEnv), false);
  return { ...rootEnv, ...baseEnv };
}

function makePropertyNullable(schema) {
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
  const hasNullVariant = anyOf.some(
    (variant) =>
      typeof variant === "object" &&
      variant !== null &&
      !Array.isArray(variant) &&
      variant.type === "null",
  );

  if (hasNullVariant) {
    return schema;
  }

  return {
    anyOf: [schema, { type: "null" }],
  };
}

function normalizeStructuredOutputSchema(schema) {
  if (Array.isArray(schema)) {
    return schema.map(normalizeStructuredOutputSchema);
  }

  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const normalized = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => [
      key,
      normalizeStructuredOutputSchema(value),
    ]),
  );

  if (
    normalized.properties &&
    typeof normalized.properties === "object" &&
    !Array.isArray(normalized.properties)
  ) {
    const properties = normalized.properties;
    const propertyNames = Object.keys(properties);
    const existingRequired = Array.isArray(normalized.required)
      ? normalized.required.filter((value) => typeof value === "string")
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
        properties[propertyName] = makePropertyNullable(propertySchema);
      }
    }

    normalized.properties = properties;
    normalized.required = propertyNames;
    normalized.additionalProperties = false;
  }

  return normalized;
}

function buildStructuredOutputSchema(zodSchema, name) {
  const raw = zodToJsonSchema(zodSchema, {
    name,
    $refStrategy: "none",
  });
  const definition = raw.definitions?.[name];
  const root =
    definition && typeof definition === "object" && !Array.isArray(definition)
      ? definition
      : raw;
  const normalized = normalizeStructuredOutputSchema(root);

  if (
    normalized &&
    typeof normalized === "object" &&
    !Array.isArray(normalized) &&
    "$schema" in normalized
  ) {
    delete normalized.$schema;
  }

  return normalized;
}

function extractAssistantContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;

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

function mapStructuredOutputError(
  responseBody,
  status,
  model,
  requestBody,
  label,
) {
  const normalized = responseBody.toLowerCase();

  if (
    status >= 400 &&
    status < 500 &&
    (normalized.includes("json_schema") ||
      normalized.includes("response_format") ||
      normalized.includes("structured") ||
      normalized.includes("require_parameters"))
  ) {
    return new BlueprintGenerationError(
      "UNSUPPORTED_STRUCTURED_OUTPUTS",
      `Model "${model}" could not satisfy structured-output requirements for ${label}`,
      { status, responseBody, model, requestBody },
    );
  }

  return new BlueprintGenerationError(
    "OPENROUTER_ERROR",
    `OpenRouter ${label} request failed (${status})`,
    { status, responseBody, model, requestBody },
  );
}

function buildVerificationRequestBody({ storyBrief, blueprint, model }) {
  return {
    model,
    messages: [
      {
        role: "system",
        content: BLUEPRINT_EVALUATION_PROMPT,
      },
      {
        role: "user",
        content: JSON.stringify({
          story_brief: storyBrief,
          blueprint,
          instructions:
            "Return only a JSON object that satisfies the provided response schema.",
        }),
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "BlueprintEvaluationOutput",
        strict: true,
        schema: buildStructuredOutputSchema(
          BlueprintEvaluationOutputSchema,
          "BlueprintEvaluationOutput",
        ),
      },
    },
    provider: {
      require_parameters: true,
    },
  };
}

async function verifyGeneratedBlueprint(options) {
  const parsedBrief = StoryBriefSchema.safeParse(options.storyBrief);
  if (!parsedBrief.success) {
    throw new BlueprintGenerationError(
      "INVALID_STORY_BRIEF",
      "Story brief did not match the expected schema for verification",
      { issues: parsedBrief.error.format() },
    );
  }

  const parsedBlueprint = BlueprintV2Schema.safeParse(options.blueprint);
  if (!parsedBlueprint.success) {
    throw new BlueprintGenerationError(
      "SCHEMA_VALIDATION_FAILED",
      "Generated blueprint did not match the Blueprint V2 schema for verification",
      { issues: parsedBlueprint.error.format() },
    );
  }

  const model = String(options.model ?? "").trim();
  if (!model) {
    throw new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "Missing model for blueprint verification",
    );
  }

  const openRouterApiKey = String(options.openRouterApiKey ?? "").trim();
  if (!openRouterApiKey) {
    throw new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "Missing OpenRouter API key for blueprint verification",
    );
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const requestBody = buildVerificationRequestBody({
    storyBrief: parsedBrief.data,
    blueprint: parsedBlueprint.data,
    model,
  });
  const controller = new globalThis.AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_OPENROUTER_TIMEOUT_MS;
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetchImpl(options.baseUrl ?? OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openRouterApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new BlueprintGenerationError(
        "OPENROUTER_ERROR",
        "OpenRouter blueprint verification request timed out",
        { model, requestBody },
        error,
      );
    }

    throw new BlueprintGenerationError(
      "OPENROUTER_ERROR",
      "OpenRouter blueprint verification request failed",
      { model, requestBody },
      error,
    );
  } finally {
    globalThis.clearTimeout(timeout);
  }

  if (!response.ok) {
    const responseBody = await response.text();
    throw mapStructuredOutputError(
      responseBody,
      response.status,
      model,
      requestBody,
      "blueprint verification",
    );
  }

  const payload = await response.json();
  const responseText = extractAssistantContent(payload);

  let parsedJson;
  try {
    parsedJson = JSON.parse(responseText);
  } catch (error) {
    throw new BlueprintGenerationError(
      "INVALID_JSON_RESPONSE",
      "OpenRouter returned non-JSON blueprint verification output",
      { responseText, model, requestBody },
      error,
    );
  }

  const verification = BlueprintEvaluationOutputSchema.safeParse(parsedJson);
  if (!verification.success) {
    throw new BlueprintGenerationError(
      "SCHEMA_VALIDATION_FAILED",
      "Blueprint verification output failed schema validation",
      {
        issues: verification.error.format(),
        responseText,
        model,
        requestBody,
      },
    );
  }

  return verification.data;
}

function buildVerificationRecord({
  status,
  job,
  outputPath,
  verification,
  verificationModel,
  error,
}) {
  return {
    status,
    verified_at: new Date().toISOString(),
    model: job.model,
    verification_model: verificationModel,
    brief_file: job.briefFile,
    blueprint_file: outputPath,
    overall_pass: verification?.overall_pass ?? null,
    evaluation: verification ?? null,
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            ...(error instanceof BlueprintGenerationError
              ? {
                  code: error.code,
                  details: error.details,
                }
              : {}),
          }
        : error === undefined
          ? null
          : {
              name: "UnknownError",
              message: String(error),
            },
  };
}

function formatBlueprintGenerationError(error) {
  if (error instanceof BlueprintBatchGenerationError) {
    const lines = [`${error.name}: ${error.message}`];

    for (const failure of error.failures) {
      lines.push(`Job: ${formatGenerationJob(failure.job)}`);
      lines.push(formatBlueprintGenerationError(failure.error));
    }

    return lines.join("\n\n");
  }

  if (error instanceof BlueprintVerificationError) {
    const lines = [`${error.name}: ${error.message}`];
    if (typeof error.details.model === "string") {
      lines.push(`Model: ${error.details.model}`);
    }
    if (typeof error.details.verificationModel === "string") {
      lines.push(`Verification model: ${error.details.verificationModel}`);
    }
    if (typeof error.details.outputPath === "string") {
      lines.push(`Blueprint file: ${error.details.outputPath}`);
    }
    if (typeof error.details.verificationFile === "string") {
      lines.push(`Verification file: ${error.details.verificationFile}`);
    }
    if (
      Array.isArray(error.details.failedDimensions) &&
      error.details.failedDimensions.length > 0
    ) {
      lines.push(
        `Failed dimensions: ${error.details.failedDimensions.join(", ")}`,
      );
    }
    if (error.cause) {
      lines.push(`Cause:\n${formatBlueprintGenerationError(error.cause)}`);
    }
    return lines.join("\n");
  }

  if (!(error instanceof BlueprintGenerationError)) {
    return error instanceof Error
      ? (error.stack ?? error.message)
      : String(error);
  }

  const lines = [`${error.name} [${error.code}]: ${error.message}`];
  if (typeof error.details.status === "number") {
    lines.push(`HTTP status: ${error.details.status}`);
  }
  if (typeof error.details.model === "string") {
    lines.push(`Model: ${error.details.model}`);
  }
  if (typeof error.details.responseBody === "string") {
    lines.push(`Response body:\n${error.details.responseBody}`);
  }
  if (typeof error.details.responseText === "string") {
    lines.push(`Response text:\n${error.details.responseText}`);
  }
  if (error.details.issues !== undefined) {
    lines.push(`Issues:\n${JSON.stringify(error.details.issues, null, 2)}`);
  }
  if (error.stack) {
    lines.push(`Stack:\n${error.stack}`);
  }
  return lines.join("\n");
}

function buildBlueprintGenerationSummary(resultOrError) {
  const outputs = Array.isArray(resultOrError?.outputs)
    ? resultOrError.outputs
    : Array.isArray(resultOrError?.results)
      ? resultOrError.results
      : [];

  const summary = {
    total_jobs: outputs.length,
    succeeded_jobs: outputs.filter((entry) => entry.status === "fulfilled")
      .length,
    failed_jobs: outputs.filter((entry) => entry.status !== "fulfilled").length,
    jobs: outputs.map((entry) =>
      entry.status === "fulfilled" ? entry.summary : (entry.summary ?? null),
    ),
  };

  return `${JSON.stringify(summary, null, 2)}\n`;
}

function getValidationFailureOutputText(error) {
  if (
    !(error instanceof BlueprintGenerationError) ||
    error.code !== "SCHEMA_VALIDATION_FAILED" ||
    typeof error.details.responseText !== "string"
  ) {
    return "";
  }

  const parsed = JSON.parse(error.details.responseText);
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function isNonFatalFileWritingError(error) {
  if (error instanceof BlueprintVerificationError) {
    return (
      typeof error.details.outputPath === "string" &&
      error.details.outputPath.length > 0
    );
  }

  if (error instanceof BlueprintGenerationError) {
    return (
      error.code === "SCHEMA_VALIDATION_FAILED" &&
      typeof error.details.outputPath === "string" &&
      error.details.outputPath.length > 0
    );
  }

  if (error instanceof BlueprintBatchGenerationError) {
    return (
      error.failures.length > 0 &&
      error.failures.every((failure) =>
        isNonFatalFileWritingError(failure.error),
      )
    );
  }

  return false;
}

export function shouldExitNonZeroForBlueprintCliError(
  error,
  hasFileWritingOutput,
) {
  if (!hasFileWritingOutput) {
    return true;
  }

  return !isNonFatalFileWritingError(error);
}

async function runWithConcurrencyLimit(items, concurrency, worker) {
  if (items.length === 0) return [];

  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(concurrency, items.length));

  async function runLane() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(items[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      await runLane();
    }),
  );

  return results;
}

function resolveOutputPath(options, job) {
  if (options.output) return options.output;
  if (options.outputFile) {
    return buildGeneratedOutputPath(
      options.outputFile,
      job.model,
      job.briefFile,
    );
  }
  return "";
}

export async function runBlueprintGenerationCli(options, dependencies = {}) {
  const readFile = dependencies.readFile ?? fs.readFile;
  const writeFile = dependencies.writeFile ?? fs.writeFile;
  const mkdir = dependencies.mkdir ?? fs.mkdir;
  const generateBlueprintImpl =
    dependencies.generateBlueprintImpl ?? generateBlueprint;
  const verifyBlueprintImpl =
    dependencies.verifyBlueprintImpl ?? verifyGeneratedBlueprint;
  const logger = dependencies.logger ?? createCliLogger();

  const jobs = options.briefFiles.flatMap((briefFile) =>
    options.models.map((model) => ({ briefFile, model })),
  );
  const concurrency = Math.max(
    1,
    Math.min(
      Number.isFinite(options.parallelism) ? options.parallelism : jobs.length,
      jobs.length,
    ),
  );

  logger.info(
    `[generate-blueprint] queued ${jobs.length} job(s) across ${options.briefFiles.length} brief file(s) and ${options.models.length} model(s); concurrency=${concurrency}`,
  );

  const settled = await runWithConcurrencyLimit(
    jobs,
    concurrency,
    async (job, index) => {
      logger.info(
        `[generate-blueprint] [${index + 1}/${jobs.length}] starting ${formatGenerationJob(job)}`,
      );

      try {
        const storyBrief = JSON.parse(await readFile(job.briefFile, "utf-8"));
        const blueprint = await generateBlueprintImpl({
          storyBrief,
          model: job.model,
          openRouterApiKey: options.openRouterApiKey,
          timeoutMs: options.timeoutMs,
        });
        const outputText = `${JSON.stringify(blueprint, null, 2)}\n`;
        const outputPath = resolveOutputPath(options, job);

        if (outputPath) {
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, outputText, "utf-8");
          logger.info(
            `[generate-blueprint] [${index + 1}/${jobs.length}] wrote ${outputPath}`,
          );

          logger.info(
            `[generate-blueprint] [${index + 1}/${jobs.length}] verifying ${outputPath}`,
          );

          const verificationFile = buildVerificationOutputPath(outputPath);
          let verification = null;
          let verificationStatus = "passed";
          let verificationError;

          try {
            verification = await verifyBlueprintImpl({
              storyBrief,
              blueprint,
              model: options.verificationModel,
              openRouterApiKey: options.openRouterApiKey,
              timeoutMs: options.timeoutMs,
            });
            if (!verification.overall_pass) {
              verificationStatus = "failed";
            }
          } catch (error) {
            verificationStatus = "error";
            verificationError = error;
          }

          const verificationRecord = buildVerificationRecord({
            status: verificationStatus,
            job,
            outputPath,
            verification,
            verificationModel: options.verificationModel,
            error: verificationError,
          });
          await writeFile(
            verificationFile,
            `${JSON.stringify(verificationRecord, null, 2)}\n`,
            "utf-8",
          );
          logger.info(
            `[generate-blueprint] [${index + 1}/${jobs.length}] wrote verification ${verificationFile} (${verificationStatus})`,
          );

          if (verificationError) {
            throw new BlueprintVerificationError(
              "Blueprint verification errored after the blueprint file was written",
              {
                model: job.model,
                verificationModel: options.verificationModel,
                outputPath,
                verificationFile,
              },
              verificationError,
            );
          }
          if (verification && !verification.overall_pass) {
            const failedDimensions = Object.entries(verification.dimensions)
              .filter(([, result]) => result?.yes === false)
              .map(([dimension]) => dimension);

            throw new BlueprintVerificationError(
              "Generated blueprint did not pass verification",
              {
                model: job.model,
                verificationModel: options.verificationModel,
                outputPath,
                verificationFile,
                failedDimensions,
              },
            );
          }
        } else {
          logger.info(
            `[generate-blueprint] [${index + 1}/${jobs.length}] completed ${formatGenerationJob(job)}`,
          );
        }

        return {
          status: "fulfilled",
          summary: buildSummaryEntry({
            status: "fulfilled",
            briefFile: job.briefFile,
            model: job.model,
            verificationModel: options.verificationModel,
            outputPath,
            verificationFile: outputPath
              ? buildVerificationOutputPath(outputPath)
              : "",
            verificationStatus: outputPath ? "passed" : null,
            overallPass: outputPath ? true : null,
          }),
          value: {
            blueprint,
            briefFile: job.briefFile,
            model: job.model,
            verificationModel: options.verificationModel,
            outputPath,
            verificationFile: outputPath
              ? buildVerificationOutputPath(outputPath)
              : "",
            outputText,
          },
        };
      } catch (error) {
        let outputPath =
          error instanceof BlueprintVerificationError
            ? (error.details.outputPath ?? "")
            : "";
        let verificationFile =
          error instanceof BlueprintVerificationError
            ? (error.details.verificationFile ?? "")
            : "";
        let verificationStatus =
          error instanceof BlueprintVerificationError
            ? error.details.failedDimensions
              ? "failed"
              : "error"
            : null;

        if (
          !outputPath &&
          error instanceof BlueprintGenerationError &&
          error.code === "SCHEMA_VALIDATION_FAILED"
        ) {
          outputPath = resolveOutputPath(options, job);
          verificationFile = outputPath
            ? buildVerificationOutputPath(outputPath)
            : "";
          verificationStatus = "error";

          if (outputPath) {
            const invalidOutputText = getValidationFailureOutputText(error);
            await mkdir(path.dirname(outputPath), { recursive: true });
            await writeFile(outputPath, invalidOutputText, "utf-8");

            const verificationRecord = buildVerificationRecord({
              status: verificationStatus,
              job,
              outputPath,
              verification: null,
              verificationModel: options.verificationModel,
              error,
            });
            await writeFile(
              verificationFile,
              `${JSON.stringify(verificationRecord, null, 2)}\n`,
              "utf-8",
            );

            error.details.outputPath = outputPath;
            error.details.verificationFile = verificationFile;

            logger.info(
              `[generate-blueprint] [${index + 1}/${jobs.length}] wrote invalid blueprint output ${outputPath}`,
            );
            logger.info(
              `[generate-blueprint] [${index + 1}/${jobs.length}] wrote verification ${verificationFile} (${verificationStatus})`,
            );
          }
        }

        const shouldLogVerboseFailure = !(
          (options.output || options.outputFile) &&
          !shouldExitNonZeroForBlueprintCliError(error, true)
        );

        if (shouldLogVerboseFailure) {
          logger.error(
            `[generate-blueprint] [${index + 1}/${jobs.length}] failed ${formatGenerationJob(job)}`,
          );
          logger.error(formatBlueprintGenerationError(error));
        }

        return {
          status: "rejected",
          error,
          job,
          summary: buildSummaryEntry({
            status: "rejected",
            briefFile: job.briefFile,
            model: job.model,
            verificationModel: options.verificationModel,
            outputPath,
            verificationFile,
            verificationStatus,
            overallPass: verificationStatus === "failed" ? false : null,
          }),
        };
      }
    },
  );

  const failures = settled.filter((entry) => entry.status === "rejected");
  if (failures.length > 0) {
    if (failures.length === 1 && jobs.length === 1) {
      failures[0].error.results = settled;
      throw failures[0].error;
    }

    throw new BlueprintBatchGenerationError(
      `Blueprint generation failed for ${failures.length} of ${jobs.length} job(s)`,
      failures,
      settled,
    );
  }

  const outputs = settled.map((entry) => entry.value);
  const singleOutput = outputs[0] ?? null;

  return {
    blueprint: singleOutput?.blueprint ?? null,
    outputText:
      outputs.length === 1 && !singleOutput?.outputPath
        ? singleOutput.outputText
        : "",
    outputs,
    results: settled,
  };
}

async function main() {
  try {
    const env = await loadBlueprintGenerationEnv();
    const options = parseGenerateBlueprintArgs(process.argv.slice(2), env);
    const result = await runBlueprintGenerationCli(options);

    if (options.output || options.outputFile) {
      process.stdout.write(buildBlueprintGenerationSummary(result));
    } else {
      process.stdout.write(result.outputText);
    }
  } catch (error) {
    const isFileWritingRun =
      process.argv.includes("--output") ||
      process.argv.includes("--output-file");

    if (
      isFileWritingRun &&
      (error instanceof BlueprintBatchGenerationError ||
        error instanceof BlueprintVerificationError ||
        error instanceof BlueprintGenerationError)
    ) {
      process.stdout.write(buildBlueprintGenerationSummary(error));

      if (!shouldExitNonZeroForBlueprintCliError(error, isFileWritingRun)) {
        return;
      }
    }
    process.stderr.write(`${formatBlueprintGenerationError(error)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
