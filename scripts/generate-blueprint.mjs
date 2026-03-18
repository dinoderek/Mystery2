import fs from "node:fs/promises";
import path from "node:path";

import {
  BlueprintGenerationError,
  generateBlueprint,
} from "../packages/blueprint-generator/src/index.ts";
import { loadEnvFile } from "./supabase-utils.mjs";

export function parseGenerateBlueprintArgs(argv, env = process.env) {
  const options = {
    briefFile: "",
    output: "",
    model: env.OPENROUTER_BLUEPRINT_MODEL || env.AI_MODEL || "",
    openRouterApiKey: env.OPENROUTER_API_KEY || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];

    if (token === "--brief-file") {
      options.briefFile = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--output") {
      options.output = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--model") {
      options.model = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--openrouter-api-key") {
      options.openRouterApiKey = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  if (!options.briefFile) {
    throw new Error("Missing required --brief-file");
  }
  if (!options.model) {
    throw new Error(
      "Missing required --model (or OPENROUTER_BLUEPRINT_MODEL / AI_MODEL env)",
    );
  }
  if (!options.openRouterApiKey) {
    throw new Error(
      "Missing required --openrouter-api-key (or OPENROUTER_API_KEY env)",
    );
  }

  return options;
}

export async function loadBlueprintGenerationEnv(
  rootDir = process.cwd(),
  baseEnv = process.env,
) {
  const rootEnv = await loadEnvFile(path.join(rootDir, ".env.local"), false);
  return { ...rootEnv, ...baseEnv };
}

function formatBlueprintGenerationError(error) {
  if (!(error instanceof BlueprintGenerationError)) {
    return error instanceof Error ? error.stack ?? error.message : String(error);
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

export async function runBlueprintGenerationCli(
  options,
  dependencies = {},
) {
  const readFile = dependencies.readFile ?? fs.readFile;
  const writeFile = dependencies.writeFile ?? fs.writeFile;
  const generateBlueprintImpl = dependencies.generateBlueprintImpl ?? generateBlueprint;

  const storyBrief = JSON.parse(await readFile(options.briefFile, "utf-8"));
  const blueprint = await generateBlueprintImpl({
    storyBrief,
    model: options.model,
    openRouterApiKey: options.openRouterApiKey,
  });

  const outputText = `${JSON.stringify(blueprint, null, 2)}\n`;

  if (options.output) {
    await writeFile(options.output, outputText, "utf-8");
  }

  return { blueprint, outputText };
}

async function main() {
  try {
    const env = await loadBlueprintGenerationEnv();
    const options = parseGenerateBlueprintArgs(process.argv.slice(2), env);
    const result = await runBlueprintGenerationCli(options);

    if (!options.output) {
      process.stdout.write(result.outputText);
    }
  } catch (error) {
    process.stderr.write(`${formatBlueprintGenerationError(error)}\n`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
