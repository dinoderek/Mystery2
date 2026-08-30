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

const repoRoot = process.cwd();
const vitestTarget =
  suite === "integration" ? "tests/api/integration" : "tests/api/e2e";

console.log(`Running ${suite} tests in "mock" AI mode...`);

const { ports } = resolveWorktreePorts(repoRoot);
const server = await startTestServer({ repoRoot, port: ports.web }).catch(
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
