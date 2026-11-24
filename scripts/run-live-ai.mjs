/**
 * Runs the live-AI suites against a real model.
 *
 * Same shape as `run-mock-tests.mjs`: build the game, start it against a
 * temporary config root, run the suite, stop it. The difference is that the
 * root's `ai.json` holds the one AI the run was asked for, so the sessions the
 * tests play go to that model, named on each request, instead of the mock
 * provider. The AI comes from the `ai.json` of the config root in force.
 */

import { npmBin, runCommand } from "./lib/process.mjs";
import { LiveRunError, planServerRun } from "./lib/live-run.mjs";
import { startTestServer } from "./lib/test-server.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";

const rootDir = process.cwd();

let plan;
try {
  plan = planServerRun({ repoRoot: rootDir, env: process.env, argv: process.argv.slice(2) });
} catch (error) {
  if (!(error instanceof LiveRunError)) throw error;
  console.error(error.message);
  process.exit(1);
}

console.log(`Running ${plan.suite} live AI tests against AI "${plan.name}"...`);

const { ports } = resolveWorktreePorts(rootDir);
const server = await startTestServer({
  repoRoot: rootDir,
  port: ports.web,
  seed: plan.seed,
}).catch((error) => {
  // Every failure here is operator-facing — the port is taken, the build
  // broke, the server never answered — so print the message, not a stack.
  console.error(`\n${error.message}\n`);
  process.exit(1);
});

// A failing suite must still stop the server (see run-mock-tests.mjs).
let status;
try {
  status = runCommand(
    npmBin,
    ["exec", "--", "vitest", "run", plan.vitestTarget, "--testTimeout", plan.suiteEnv.AI_LIVE_TEST_TIMEOUT_MS],
    {
      ...process.env,
      ...plan.suiteEnv,
      MYSTERY_TEST_API_URL: server.url,
      MYSTERY_TEST_CONFIG_ROOT: server.configRoot,
      MYSTERY_TEST_BUILD_DIR: server.buildDir,
    },
    true,
  );
} finally {
  await server.stop();
}
process.exit(status);
