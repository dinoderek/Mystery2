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
import os from "node:os";
import path from "node:path";

import { npmBin } from "./process.mjs";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;

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

async function waitForReady(url, hasExited) {
  const deadline = Date.now() + READY_TIMEOUT_MS;

  while (Date.now() < deadline) {
    // Checked first, and this matters: if the server died on startup — most
    // often EADDRINUSE because one was left running — something else is
    // answering on that port, and polling would happily "succeed" against it.
    // The suite would then run against a stale server with a stale database,
    // and fail in ways that look like product bugs.
    if (hasExited()) {
      throw new Error(
        `Test server exited during startup. Is something already listening on ${url}?`,
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

  const configRoot = createTestConfigRoot();
  const url = `http://127.0.0.1:${port}`;

  const child = spawn("node", ["build/index.js"], {
    cwd: path.join(repoRoot, "web"),
    stdio: ["ignore", "inherit", "inherit"],
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      HOST: "127.0.0.1",
      MYSTERY_CONFIG_ROOT: configRoot,
      MYSTERY_REPO_ROOT: repoRoot,
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
