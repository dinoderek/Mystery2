import process from "node:process";

import { verifyBlueprintPath } from "./lib/blueprints/verify-blueprint.mjs";

export function parseArgs(argv) {
  const blueprintPathIndex = argv.indexOf("--blueprint-path");
  if (blueprintPathIndex === -1 || !argv[blueprintPathIndex + 1]) {
    throw new Error("Missing required --blueprint-path");
  }
  return { blueprintPath: argv[blueprintPathIndex + 1] };
}

export function formatVerificationCliOutput(result) {
  return `${result.exitCode === 0 ? "PASS" : "FAIL"} ${result.reportPath}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { blueprintPath } = parseArgs(process.argv.slice(2));
  verifyBlueprintPath(blueprintPath)
    .then((result) => {
      console.log(formatVerificationCliOutput(result));
      process.exit(result.exitCode);
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
