import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  BlueprintGenerationError,
  generateBlueprint,
} from "../packages/blueprint-generator/src/index.ts";
import { buildBlueprintGenerationMarkdownPacket } from "../packages/blueprint-generator/src/chat-packet.ts";
import { runMechanicalChecks } from "../evaluation/checks/mechanical.mjs";
import {
  getBaseEnvPath,
  getBlueprintsDir,
  getBriefsDir,
  getChatGenPromptsDir,
} from "./local-config.mjs";
import { loadEnvFile } from "./supabase-utils.mjs";

const DEFAULT_OPENROUTER_TIMEOUT_MS = 120_000;

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

function stripMarkdownExtension(filePath) {
  return filePath.endsWith(".md") ? filePath.slice(0, -3) : filePath;
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

function buildChatPacketOutputPath(outputFile, briefFile) {
  const withoutJson = stripJsonExtension(outputFile);
  const baseOutputFile = stripMarkdownExtension(withoutJson);
  const briefSegment = sanitizeFilenameSegment(
    path.parse(briefFile).name,
    "brief",
  );

  return `${baseOutputFile}.${briefSegment}.chat.md`;
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
  outputPath,
  verificationFile,
  verificationStatus = null,
  passed = null,
}) {
  return {
    status,
    brief_file: briefFile,
    model,
    blueprint_file: outputPath || null,
    verification_file: verificationFile || null,
    verification_status: verificationStatus,
    passed,
  };
}

function resolveBriefFile(filePath, env = process.env) {
  const briefsDir = getBriefsDir(undefined, env);
  const candidate = path.join(briefsDir, filePath);
  if (existsSync(candidate)) {
    return candidate;
  }
  return filePath;
}

export function parseGenerateBlueprintArgs(argv, env = process.env) {
  const options = {
    briefFiles: [],
    chatPacket: false,
    output: "",
    outputFile: "",
    models: parseModelList(
      env.OPENROUTER_BLUEPRINT_MODEL || env.AI_MODEL || "",
    ),
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
    if (token === "--chat-packet") {
      options.chatPacket = true;
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
  options.briefFiles = options.briefFiles.map((f) => resolveBriefFile(f, env));

  if (options.output && options.outputFile) {
    throw new Error("Choose either --output or --output-file, not both");
  }

  if (options.chatPacket) {
    if (!options.output && !options.outputFile) {
      options.outputFile = path.join(
        getChatGenPromptsDir(undefined, env),
        "blueprint-packet",
      );
    }
  } else if (options.models.length === 0) {
    throw new Error(
      "Missing required --model (or OPENROUTER_BLUEPRINT_MODEL / AI_MODEL env)",
    );
  }
  if (!options.chatPacket && !options.openRouterApiKey) {
    throw new Error(
      "Missing required --openrouter-api-key (or OPENROUTER_API_KEY env)",
    );
  }
  if (!options.chatPacket && !options.output && !options.outputFile) {
    const blueprintsDir = getBlueprintsDir();
    options.outputFile = path.join(blueprintsDir, "blueprint");
  }

  const jobCount = options.chatPacket
    ? options.briefFiles.length
    : options.briefFiles.length * options.models.length;
  if (jobCount > 1 && options.output) {
    throw new Error(
      options.chatPacket
        ? "--output can only be used with a single --brief-file in --chat-packet mode"
        : "--output can only be used with a single --brief-file and single --model",
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

// Post-generation verification is a purely structural, offline check: it runs
// the shared deterministic checks (schema validity, culprit/location/character/
// red-herring counts vs. the brief, orphan clues, and a satisfiable clue graph)
// against the just-written blueprint. It makes no network call and needs no
// model — the record is a pass/fail structural report, not an LLM judgement.
export function verifyGeneratedBlueprint({ storyBrief, blueprint }) {
  const checks = runMechanicalChecks({
    brief: storyBrief,
    blueprintCandidate: blueprint,
  });
  const failedChecks = checks
    .filter((check) => check.status !== "pass")
    .map((check) => check.id);

  return {
    passed: failedChecks.length === 0,
    checks,
    failedChecks,
  };
}

function buildVerificationRecord({
  status,
  job,
  outputPath,
  verification,
  error,
}) {
  return {
    status,
    verified_at: new Date().toISOString(),
    model: job.model,
    brief_file: job.briefFile,
    blueprint_file: outputPath,
    passed: verification?.passed ?? null,
    checks: verification?.checks ?? [],
    failed_checks: verification?.failedChecks ?? [],
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

function flattenZodIssues(formatted, prefix = "") {
  const messages = [];
  if (Array.isArray(formatted?._errors)) {
    for (const msg of formatted._errors) {
      messages.push(prefix ? `${prefix}: ${msg}` : msg);
    }
  }
  for (const [key, value] of Object.entries(formatted ?? {})) {
    if (key === "_errors") continue;
    messages.push(...flattenZodIssues(value, prefix ? `${prefix}.${key}` : key));
  }
  return messages;
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
    if (typeof error.details.outputPath === "string") {
      lines.push(`Blueprint file: ${error.details.outputPath}`);
    }
    if (typeof error.details.verificationFile === "string") {
      lines.push(`Verification file: ${error.details.verificationFile}`);
    }
    if (
      Array.isArray(error.details.failedChecks) &&
      error.details.failedChecks.length > 0
    ) {
      lines.push(`Failed checks: ${error.details.failedChecks.join(", ")}`);
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
  if (typeof error.details.model === "string") {
    lines.push(`Model: ${error.details.model}`);
  }

  // For schema validation failures, keep stderr output minimal —
  // the full response and issues are already written to the validation file.
  if (error.code === "SCHEMA_VALIDATION_FAILED") {
    if (typeof error.details.outputPath === "string") {
      lines.push(`Output: ${error.details.outputPath}`);
    }
    return lines.join("\n");
  }

  if (typeof error.details.status === "number") {
    lines.push(`HTTP status: ${error.details.status}`);
  }
  if (typeof error.details.responseBody === "string") {
    lines.push(`Response body (truncated): ${error.details.responseBody.slice(0, 200)}${error.details.responseBody.length > 200 ? "..." : ""}`);
  }
  if (typeof error.details.responseText === "string") {
    lines.push(`Response text length: ${error.details.responseText.length} chars`);
  }
  if (error.details.issues !== undefined) {
    const issuesSummary = flattenZodIssues(error.details.issues);
    lines.push(`Issues (${issuesSummary.length}):\n${issuesSummary.map((msg) => `  - ${msg}`).join("\n")}`);
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

function resolveChatPacketOutputPath(options, job) {
  if (options.output) return options.output;
  if (options.outputFile) {
    return buildChatPacketOutputPath(options.outputFile, job.briefFile);
  }
  return "";
}

function buildChatPacketSummaryEntry({ status, briefFile, outputPath }) {
  return {
    status,
    brief_file: briefFile,
    packet_file: outputPath || null,
  };
}

function formatChatPacketJob(job) {
  return `brief=${job.briefFile}`;
}

async function runBlueprintChatPacketCli(options, dependencies = {}) {
  const readFile = dependencies.readFile ?? fs.readFile;
  const writeFile = dependencies.writeFile ?? fs.writeFile;
  const mkdir = dependencies.mkdir ?? fs.mkdir;
  const logger = dependencies.logger ?? createCliLogger();
  const buildPacketImpl =
    dependencies.buildBlueprintPacketImpl ?? buildBlueprintGenerationMarkdownPacket;

  const jobs = options.briefFiles.map((briefFile) => ({ briefFile }));
  const concurrency = Math.max(
    1,
    Math.min(
      Number.isFinite(options.parallelism) ? options.parallelism : jobs.length,
      jobs.length,
    ),
  );
  logger.info(
    `[generate-blueprint] queued ${jobs.length} chat packet job(s) across ${options.briefFiles.length} brief file(s); concurrency=${concurrency}`,
  );

  const settled = await runWithConcurrencyLimit(
    jobs,
    concurrency,
    async (job, index) => {
      logger.info(
        `[generate-blueprint] [${index + 1}/${jobs.length}] building chat packet ${formatChatPacketJob(job)}`,
      );

      try {
        const storyBrief = JSON.parse(await readFile(job.briefFile, "utf-8"));
        const packet = await buildPacketImpl({
          storyBrief,
        });
        const outputText = packet.outputText;
        const outputPath = resolveChatPacketOutputPath(options, job);

        if (outputPath) {
          await mkdir(path.dirname(outputPath), { recursive: true });
          await writeFile(outputPath, outputText, "utf-8");
          logger.info(
            `[generate-blueprint] [${index + 1}/${jobs.length}] wrote chat packet ${outputPath}`,
          );
        }

        return {
          status: "fulfilled",
          summary: buildChatPacketSummaryEntry({
            status: "fulfilled",
            briefFile: job.briefFile,
            outputPath,
          }),
          value: {
            briefFile: job.briefFile,
            outputPath,
            outputText,
          },
        };
      } catch (error) {
        logger.error(
          `[generate-blueprint] [${index + 1}/${jobs.length}] failed chat packet ${formatChatPacketJob(job)}`,
        );
        logger.error(formatBlueprintGenerationError(error));

        return {
          status: "rejected",
          error,
          job,
          summary: buildChatPacketSummaryEntry({
            status: "rejected",
            briefFile: job.briefFile,
            outputPath: "",
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
      `Blueprint chat packet generation failed for ${failures.length} of ${jobs.length} job(s)`,
      failures,
      settled,
    );
  }

  const outputs = settled.map((entry) => entry.value);
  const singleOutput = outputs[0] ?? null;

  return {
    outputText:
      outputs.length === 1 && !singleOutput?.outputPath
        ? singleOutput.outputText
        : "",
    outputs,
    results: settled,
  };
}

export async function runBlueprintGenerationCli(options, dependencies = {}) {
  if (options.chatPacket) {
    return runBlueprintChatPacketCli(options, dependencies);
  }

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
            });
            if (!verification.passed) {
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
                outputPath,
                verificationFile,
              },
              verificationError,
            );
          }
          if (verification && !verification.passed) {
            throw new BlueprintVerificationError(
              "Generated blueprint did not pass verification",
              {
                model: job.model,
                outputPath,
                verificationFile,
                failedChecks: verification.failedChecks,
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
            outputPath,
            verificationFile: outputPath
              ? buildVerificationOutputPath(outputPath)
              : "",
            verificationStatus: outputPath ? "passed" : null,
            passed: outputPath ? true : null,
          }),
          value: {
            blueprint,
            briefFile: job.briefFile,
            model: job.model,
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
            ? error.details.failedChecks
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
            outputPath,
            verificationFile,
            verificationStatus,
            passed: verificationStatus === "failed" ? false : null,
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
