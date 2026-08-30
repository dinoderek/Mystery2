/**
 * The game server, started for a test run.
 *
 * Build the app, run it, wait for it to answer, stop it afterwards. No
 * containers, no port table, no seeding.
 *
 * The server runs against a **temporary config root**, so its database is
 * created fresh and thrown away. It must never be the developer's `game.db` —
 * the suites create sessions and players by the hundred.
 *
 * The production build is used rather than the dev server, deliberately: it is
 * the artefact `npm run build` produces, and running it here is the only thing
 * that would catch a bundling failure before someone deploys one.
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { npmBin } from "./process.mjs";
import { TEST_DATABASE } from "../../lib/database-target.mjs";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;
const PORT_PROBE_TIMEOUT_MS = 1_000;

/** A disposable config root: the run's database lives here and nowhere else. */
export function createTestConfigRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-test-"));
  fs.mkdirSync(path.join(root, "blueprint-images"), { recursive: true });
  return root;
}

function buildWebApp(repoRoot) {
  const result = spawnSync(npmBin, ["-w", "web", "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Failed to build the web app for the test run");
  }
}

/** Resolves true if anything accepts a connection on the port right now. */
function isPortInUse(host, port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const settle = (inUse) => {
      socket.destroy();
      resolve(inUse);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/**
 * Refuses to start when the port is taken.
 *
 * This has to be a check of its own, before the server is spawned, because it
 * cannot be inferred afterwards: the process already holding the port answers
 * the readiness poll immediately, while our child takes a moment to die of
 * EADDRINUSE. The readiness loop wins that race, and the suite then runs
 * against a stale server whose config root has usually already been deleted —
 * failing in a scatter of 404s and missing-database errors that look like
 * product bugs. Asking the port directly is deterministic.
 */
export async function assertPortIsFree(host, port) {
  if (await isPortInUse(host, port)) {
    throw new Error(
      `Something is already listening on ${host}:${port}. That is usually another ` +
        `test run or a dev server in this worktree — stop it and try again. Test ` +
        `suites within a checkout share one port and must not run concurrently.`,
    );
  }
}

async function waitForReady(url, hasExited) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // A genuine startup crash: the port was free when we probed it, so nothing
    // else can answer the poll, and waiting out the timeout would only delay
    // the failure. (A port already taken is caught before spawning — see
    // `assertPortIsFree`; it cannot be detected here, because the process
    // holding the port answers the poll long before our child dies of
    // EADDRINUSE.)
    if (hasExited()) {
      throw new Error(
        "Test server exited during startup. See its output above.",
      );
    }

    try {
      const response = await fetch(`${url}/api/players`);
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, READY_POLL_MS));
  }

  throw new Error(`Test server did not become ready at ${url}`);
}

/**
 * Builds and starts the server. Returns its URL, the config root its database
 * lives in, and a `stop()` that shuts it down and removes the root.
 */
export async function startTestServer({ repoRoot, port, env = {} }) {
  buildWebApp(repoRoot);

  const host = "127.0.0.1";
  await assertPortIsFree(host, port);

  const configRoot = createTestConfigRoot();
  const url = `http://${host}:${port}`;

  const child = spawn("node", ["build/index.js"], {
    cwd: path.join(repoRoot, "web"),
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: host,
      MYSTERY_CONFIG_ROOT: configRoot,
      MYSTERY_REPO_ROOT: repoRoot,
      // Pinned rather than left to the worktree-derived default, so the
      // testkit can find the file without repeating the derivation.
      MYSTERY_DATABASE: TEST_DATABASE,
    },
  });

  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  const stop = () => {
    fs.rmSync(configRoot, { recursive: true, force: true });
    if (!exited) child.kill("SIGTERM");
  };

  try {
    await waitForReady(url, () => exited);
  } catch (error) {
    stop();
    throw error;
  }

  return { url, configRoot, stop };
}
