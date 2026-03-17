import process from "node:process";
import { pathToFileURL } from "node:url";

import { judgeBlueprintPath } from "./lib/blueprints/judge-blueprint.mjs";
import { loadRootEnv } from "./supabase-utils.mjs";

const DEFAULT_BLUEPRINT_VERIFIER_MODEL = "openai/gpt-4.1-mini";

export function parseJudgeBlueprintArgs(argv, env = process.env) {
  const options = {
    blueprintPath: "",
    model:
      env.OPENROUTER_BLUEPRINT_VERIFIER_MODEL ||
      env.OPENROUTER_MODEL ||
      DEFAULT_BLUEPRINT_VERIFIER_MODEL,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--blueprint-path") {
      options.blueprintPath = String(argv[index + 1] ?? "");
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
  return options;
}

export async function loadBlueprintVerifierEnv(
  rootDir = process.cwd(),
  baseEnv = process.env,
) {
  return loadRootEnv(rootDir, baseEnv);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = await loadBlueprintVerifierEnv();
  const options = parseJudgeBlueprintArgs(process.argv.slice(2), env);
  judgeBlueprintPath({
    ...options,
    apiKey: env.OPENROUTER_API_KEY,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
