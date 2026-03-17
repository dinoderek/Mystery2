import process from "node:process";

import { judgeBlueprintPath } from "./lib/blueprints/judge-blueprint.mjs";

function parseArgs(argv, env = process.env) {
  const options = {
    blueprintPath: "",
    model: env.OPENROUTER_MODEL || "openai/gpt-4.1-mini",
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  judgeBlueprintPath({
    ...options,
    apiKey: process.env.OPENROUTER_API_KEY,
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
