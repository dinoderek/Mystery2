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
import { fileURLToPath } from "node:url";

import { npmBin } from "./process.mjs";
import { TEST_DATABASE, resolveDatabaseFile, resolveDatabasesRoot } from "../../lib/database-target.mjs";

const READY_TIMEOUT_MS = 30_000;
const READY_POLL_MS = 100;
const PORT_PROBE_TIMEOUT_MS = 1_000;
const STOP_GRACE_MS = 5_000;
const STALE_BUILD_MS = 24 * 60 * 60 * 1000;
const BUILD_TOUCH_MS = 60 * 60 * 1000;

const MOCK_CASE_SCENES = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../tests/testkit/src/mock-case-scenes.json");

/**
 * Writes the mock case's procedural scenes into a config root's
 * `blueprint-scenes/`, where the scenes endpoint reads them. The repo's own
 * `blueprint-scenes/` holds no content, so the suites' scenes come from here.
 */
export function installMockCaseScenes(configRoot) {
  const manifest = JSON.parse(fs.readFileSync(MOCK_CASE_SCENES, "utf8"));
  const dir = path.join(configRoot, "blueprint-scenes");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${manifest.blueprint_id}.json`), `${JSON.stringify(manifest, null, 2)}\n`);
}

/** A disposable config root: the run's database lives here and nowhere else. */
export function createTestConfigRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-test-"));
  fs.mkdirSync(path.join(root, "blueprint-images"), { recursive: true });
  installMockCaseScenes(root);
  return root;
}

/**
 * A folder for one server's build, inside `web/` so the server's imports still
 * resolve against the checkout's `node_modules`. Each build gets its own, so
 * two runs building from one checkout at once never write the same files, and
 * a rebuild never replaces the files a running server is serving.
 *
 * `stop()` removes the folder, but an interrupted run never calls it, so
 * folders untouched for STALE_BUILD_MS are removed here first. A running
 * server touches its own folder every BUILD_TOUCH_MS, so it never looks stale.
 * Another run may remove an entry between the listing and the check; such an
 * entry is skipped.
 */
export function createBuildDir(repoRoot) {
  const now = Date.now();
  const parent = path.join(repoRoot, "web", ".test-builds");
  fs.mkdirSync(parent, { recursive: true });
  for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
    const dir = path.join(parent, entry.name);
    const stat = entry.isDirectory() ? fs.statSync(dir, { throwIfNoEntry: false }) : undefined;
    if (stat && now - stat.mtimeMs > STALE_BUILD_MS) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return fs.mkdtempSync(path.join(parent, "build-"));
}

/** The server entry point of the build in `buildDir`. */
export function buildEntry(buildDir) {
  return path.join(buildDir, "build", "index.js");
}

/**
 * Builds the app into `buildDir` with the run's config root as its own, then
 * fails if the build opened a database there. The build prerenders pages
 * through the server hook, so a build that opens the engine would otherwise
 * create or migrate the developer's database (`database/main` in the main
 * checkout) on every run.
 */
export function buildWebApp(repoRoot, configRoot, buildDir, run = spawnSync) {
  // `web/tsconfig.json` extends the sync output in `web/.svelte-kit/`, which a
  // build into a folder of its own does not write, so a checkout that has never
  // synced is synced first. Only then: a sync that rewrote the file while
  // another run's build read it would break that build. (Two runs started
  // together in a never-synced checkout still sync together; `npm ci` syncs
  // through `prepare`, so only a checkout that skipped it can meet that.)
  if (!fs.existsSync(path.join(repoRoot, "web", ".svelte-kit", "tsconfig.json"))) {
    const sync = run(npmBin, ["-w", "web", "exec", "--", "svelte-kit", "sync"], { cwd: repoRoot, stdio: "inherit" });
    if ((sync.status ?? 1) !== 0) {
      throw new Error("Failed to sync the web app (svelte-kit sync) for the test run");
    }
  }
  const result = run(npmBin, ["-w", "web", "run", "build"], {
    cwd: repoRoot,
    stdio: "inherit",
    env: { ...process.env, MYSTERY_CONFIG_ROOT: configRoot, MYSTERY_WEB_BUILD_DIR: buildDir },
  });
  if ((result.status ?? 1) !== 0) {
    throw new Error("Failed to build the web app for the test run");
  }
  const databases = resolveDatabasesRoot(repoRoot, { MYSTERY_CONFIG_ROOT: configRoot });
  if (fs.existsSync(databases)) {
    throw new Error(
      `Building the web app opened a database (${databases}). Building must not ` +
        "open the engine: the server hook skips it while `building` " +
        "(`$app/environment`), and nothing else may open it at import time.",
    );
  }
}

/**
 * The build a `build: false` server runs: the suite's, which the suite runner
 * passes its suites in `MYSTERY_TEST_BUILD_DIR`.
 */
export function suiteBuildDir(env = process.env) {
  const dir = env.MYSTERY_TEST_BUILD_DIR;
  if (!dir || !fs.existsSync(buildEntry(dir))) {
    throw new Error(
      "A server started with `build: false` runs the suite's build, and there is none: " +
        "MYSTERY_TEST_BUILD_DIR must name the build folder of the suite's server " +
        "(scripts/run-mock-tests.mjs sets it).",
    );
  }
  return dir;
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
 * The server's environment. The run override is cleared before the caller's
 * own variables apply, so an `AI_PROFILE` exported in a shell never reaches a
 * suite; a caller that wants one passes it in `env`.
 */
export function testServerEnv(processEnv, env, { port, host, configRoot, repoRoot }) {
  return {
    ...processEnv,
    AI_PROFILE: "",
    ...env,
    PORT: String(port),
    HOST: host,
    MYSTERY_CONFIG_ROOT: configRoot,
    MYSTERY_REPO_ROOT: repoRoot,
    // Pinned rather than left to the worktree-derived default, so the
    // testkit can find the file without repeating the derivation.
    MYSTERY_DATABASE: TEST_DATABASE,
    // The suites start the mock case from the menu, which hides it from players.
    MYSTERY_LIST_FIXTURES: "1",
  };
}

/**
 * Builds and starts the server. Returns its URL, the config root its database
 * lives in, that database's file, the folder of the build it runs, and a
 * `stop()` that shuts it down and removes the root and the build.
 *
 * `build: false` starts the suite's build instead (`suiteBuildDir`), for a
 * caller inside a suite that has a server of its own; it is not removed. `seed` is
 * given the config root before the server starts, for a caller that needs a
 * file there the server reads at start, such as `ai.json`; without one the root
 * has none, and mock is the only AI.
 */
export async function startTestServer({ repoRoot, port, env = {}, build = true, seed }) {
  const configRoot = createTestConfigRoot();
  const host = "127.0.0.1";
  let buildDir = null;
  const removeOwnFiles = () => {
    fs.rmSync(configRoot, { recursive: true, force: true });
    if (build && buildDir) fs.rmSync(buildDir, { recursive: true, force: true });
  };
  try {
    seed?.(configRoot);
    if (build) {
      buildDir = createBuildDir(repoRoot);
      buildWebApp(repoRoot, configRoot, buildDir);
    } else {
      buildDir = suiteBuildDir();
    }
    await assertPortIsFree(host, port);
  } catch (error) {
    removeOwnFiles();
    throw error;
  }

  const url = `http://${host}:${port}`;

  const child = spawn("node", [buildEntry(buildDir)], {
    cwd: path.join(repoRoot, "web"),
    stdio: ["ignore", "inherit", "inherit"],
    env: testServerEnv(process.env, env, { port, host, configRoot, repoRoot }),
  });

  // Marks a build of its own as in use, so no other run prunes it
  // (`createBuildDir`). The suite's build is its own server's to mark.
  const touch = build
    ? setInterval(() => {
        const now = new Date();
        fs.utimesSync(buildDir, now, now);
      }, BUILD_TOUCH_MS)
    : undefined;
  touch?.unref();

  let exited = false;
  const exit = new Promise((resolve) => {
    child.on("exit", () => {
      exited = true;
      resolve();
    });
  });

  // Resolves once the server has gone. On SIGTERM adapter-node stops taking
  // requests but then waits for the event loop to drain, which pending work
  // can hold open for good; a server outliving its runner keeps the port and
  // the test gate's output pipe, and the gate never finishes. So it is killed
  // if it has not gone within STOP_GRACE_MS.
  const stop = async () => {
    clearInterval(touch);
    if (!exited) {
      child.kill("SIGTERM");
      const kill = setTimeout(() => child.kill("SIGKILL"), STOP_GRACE_MS);
      await exit;
      clearTimeout(kill);
    }
    removeOwnFiles();
  };

  try {
    await waitForReady(url, () => exited);
  } catch (error) {
    await stop();
    throw error;
  }

  // The config root stands in for the repo root here, with no environment,
  // which is how the server resolved it.
  const databaseFile = resolveDatabaseFile(TEST_DATABASE, configRoot, {});
  return { url, configRoot, databaseFile, buildDir, stop };
}
