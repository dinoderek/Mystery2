/**
 * Runs the live-AI suites against a real model.
 *
 * Same shape as `run-mock-tests.mjs`: build the game, start it against a
 * temporary config root, run the suite, stop it. The difference is that the
 * server is started with the mode's AI env, so the sessions the tests play go
 * to OpenRouter instead of the mock provider.
 */

import { getAIEnvPath, getBaseEnvPath } from "./local-config.mjs";
import { loadEnvFile } from "./lib/env-file.mjs";
import { npmBin, runCommand } from "./lib/process.mjs";
import { startTestServer } from "./lib/test-server.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";

const suite = process.argv[2];
const mode = process.argv[3];

if ((suite !== "integration" && suite !== "e2e") || (mode !== "free" && mode !== "paid")) {
  console.error("Usage: node scripts/run-live-ai.mjs <integration|e2e> <free|paid>");
  process.exit(1);
}

const rootDir = process.cwd();

const baseVars = await loadEnvFile(getBaseEnvPath(rootDir, process.env), false);
const modeVars = await loadEnvFile(getAIEnvPath(rootDir, mode, process.env), true);
const env = { ...baseVars, ...modeVars, ...process.env };

// The mode file wins over the ambient environment: pointing at the free model
// must not be silently overridden by an exported AI_MODEL.
const aiEnv = {
  AI_PROVIDER: modeVars.AI_PROVIDER ?? env.AI_PROVIDER,
  AI_MODEL: modeVars.AI_MODEL ?? env.AI_MODEL,
  OPENROUTER_API_KEY: modeVars.OPENROUTER_API_KEY ?? env.OPENROUTER_API_KEY,
};

if (!aiEnv.AI_PROVIDER) throw new Error("Missing AI_PROVIDER in env configuration.");
if (!aiEnv.AI_MODEL) throw new Error("Missing AI_MODEL in env configuration.");
if (aiEnv.AI_PROVIDER === "openrouter" && !aiEnv.OPENROUTER_API_KEY) {
  throw new Error("Missing OPENROUTER_API_KEY for AI_PROVIDER=openrouter in env configuration.");
}

const vitestTarget = suite === "integration"
  ? "tests/api/integration/live-ai"
  : "tests/api/e2e/live-ai-flow.test.ts";
const liveTestTimeout = env.AI_LIVE_TEST_TIMEOUT_MS || "600000";

console.log(`Running ${suite} live AI tests in "${mode}" mode (${aiEnv.AI_MODEL})...`);

const { ports } = resolveWorktreePorts(rootDir);
const server = await startTestServer({
  repoRoot: rootDir,
  port: ports.web,
  env: aiEnv,
}).catch((error) => {
  // Every failure here is operator-facing — the port is taken, the build
  // broke, the server never answered — so print the message, not a stack.
  console.error(`\n${error.message}\n`);
  process.exit(1);
});

try {
  runCommand(
    npmBin,
    ["exec", "--", "vitest", "run", vitestTarget, "--testTimeout", liveTestTimeout],
    {
      ...env,
      ...aiEnv,
      AI_LIVE: "1",
      AI_LIVE_LABEL: mode,
      AI_LIVE_TEST_TIMEOUT_MS: liveTestTimeout,
      MYSTERY_TEST_API_URL: server.url,
      MYSTERY_TEST_CONFIG_ROOT: server.configRoot,
    },
  );
} finally {
  server.stop();
}
