/**
 * Runs the integration or API E2E suite against a freshly built game server.
 *
 * The server writes to a temporary config root that is removed afterwards, so
 * a test run can never touch the database you have been playing on.
 */

import { npmBin, runCommand } from "./lib/process.mjs";
import { startTestServer } from "./lib/test-server.mjs";
import { resolveWorktreePorts } from "../lib/worktree-ports.mjs";

const suite = process.argv[2];
if (suite !== "integration" && suite !== "e2e") {
  console.error("Usage: node scripts/run-mock-tests.mjs <integration|e2e>");
  process.exit(1);
}

/**
 * A mock-mode suite must not be able to reach OpenRouter.
 *
 * Mock is chosen by absence — a temporary config root with no `.env.ai.*` in it
 * — which is a property of the *configuration*, and configuration is now
 * something a test can change: the settings row is per-installation, so a test
 * that switches the server to live narration switches it for every other test
 * sharing that server. When that happened, the calls went to the real
 * openrouter.ai with a throwaway key, and the suite failed a third of a second
 * later with a 401 nobody could see the cause of. On a slower network they hung
 * instead, and the CI job was killed at its fifteen-minute cap.
 *
 * Pointing the base URL at a closed port turns that from a timeout into an
 * immediate connection error: the suite still fails, but it fails locally, in
 * milliseconds, and without spending anyone's credits. It is a backstop, not
 * the rule — the rule is that no shared-server suite switches the mode at all,
 * and `tests/api/integration/ai-settings.test.ts` says why.
 *
 * Live-AI runs use `run-live-ai.mjs`, which passes its own env and is not
 * affected.
 */
const MOCK_ONLY_ENV = { OPENROUTER_URL: "http://127.0.0.1:9/unreachable" };

const repoRoot = process.cwd();
const vitestTarget =
  suite === "integration" ? "tests/api/integration" : "tests/api/e2e";

console.log(`Running ${suite} tests in "mock" AI mode...`);

const { ports } = resolveWorktreePorts(repoRoot);
const server = await startTestServer({ repoRoot, port: ports.web, env: MOCK_ONLY_ENV }).catch(
  (error) => {
    // Every failure here is operator-facing — the port is taken, the build
    // broke, the server never answered — so print the message, not a stack.
    console.error(`\n${error.message}\n`);
    process.exit(1);
  },
);

try {
  runCommand(npmBin, ["exec", "--", "vitest", "run", vitestTarget], {
    ...process.env,
    MYSTERY_TEST_API_URL: server.url,
    MYSTERY_TEST_CONFIG_ROOT: server.configRoot,
  });
} finally {
  server.stop();
}
