import process from "node:process";
import { pathToFileURL } from "node:url";

import { runBlueprintGeneration } from "./lib/blueprints/generate-blueprints.mjs";
import { loadRootEnv } from "./supabase-utils.mjs";

const DEFAULT_BLUEPRINT_GENERATION_MODEL = "openai/gpt-4.1-mini";

export function parseGenerateBlueprintArgs(argv, env = process.env) {
  const options = {
    briefPath: "",
    count: 1,
    model:
      env.OPENROUTER_BLUEPRINT_GENERATION_MODEL ||
      env.OPENROUTER_MODEL ||
      DEFAULT_BLUEPRINT_GENERATION_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--brief") {
      options.briefPath = String(argv[index + 1] ?? "");
      index += 1;
      continue;
    }
    if (token === "--count") {
      options.count = Number.parseInt(String(argv[index + 1] ?? "1"), 10);
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

  if (!options.briefPath) {
    throw new Error("Missing required --brief");
  }
  if (!Number.isInteger(options.count) || options.count <= 0) {
    throw new Error("Invalid --count");
  }
  return options;
}

export async function loadBlueprintGenerationEnv(
  rootDir = process.cwd(),
  baseEnv = process.env,
) {
  return loadRootEnv(rootDir, baseEnv);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = await loadBlueprintGenerationEnv();
  const options = parseGenerateBlueprintArgs(process.argv.slice(2), env);
  runBlueprintGeneration({
    ...options,
    apiKey: env.OPENROUTER_API_KEY,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
