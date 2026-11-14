/**
 * Runs the live blueprint-generation suite against a real model.
 *
 * The AI is named from the `ai.json` of the config root in force and must be an
 * `openrouter` one: its model and key go to the generator. No server starts.
 */

import { npmBin, runCommand } from "./lib/process.mjs";
import { planBlueprintRun } from "./lib/live-run.mjs";

try {
  const plan = planBlueprintRun({ repoRoot: process.cwd(), env: process.env, argv: process.argv.slice(2) });
  console.log(`Running live blueprint generation against AI "${plan.name}"...`);
  runCommand(
    npmBin,
    [
      "exec",
      "--",
      "vitest",
      "run",
      "tests/api/integration/live-ai/live-blueprint-generator.test.ts",
      "--testTimeout",
      plan.suiteEnv.AI_LIVE_TEST_TIMEOUT_MS,
    ],
    { ...process.env, ...plan.suiteEnv },
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
