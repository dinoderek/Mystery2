import process from "node:process";

import { verifyBlueprintPath } from "./lib/blueprints/verify-blueprint.mjs";

function parseArgs(argv) {
  const blueprintPathIndex = argv.indexOf("--blueprint-path");
  if (blueprintPathIndex === -1 || !argv[blueprintPathIndex + 1]) {
    throw new Error("Missing required --blueprint-path");
  }
  return { blueprintPath: argv[blueprintPathIndex + 1] };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { blueprintPath } = parseArgs(process.argv.slice(2));
  verifyBlueprintPath(blueprintPath)
    .then((result) => {
      process.exit(result.exitCode);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
