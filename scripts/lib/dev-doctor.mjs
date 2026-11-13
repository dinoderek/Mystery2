/**
 * `./dev doctor`: checks this host and fixes what it can. Each check is a
 * function of its inputs, so the tests hand it a version, a lock file or a held
 * port rather than depending on the machine they run on.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";

import { npmBin } from "./process.mjs";
import { resolveWorktreePorts } from "../../lib/worktree-ports.mjs";

/**
 * Compares the running Node to what `.nvmrc` asks for. A bare major (`24`)
 * accepts any 24.x; a fuller version (`v24.1.0`) is matched on the parts it
 * gives. Anything else (an alias such as `lts/*`) cannot be checked, and is
 * reported as such rather than passed.
 *
 * @param {string} nvmrc contents of `.nvmrc`
 * @param {string} actual `process.versions.node`
 * @returns {{ ok: boolean, message: string }}
 */
export function checkNodeVersion(nvmrc, actual) {
  const wanted = nvmrc.trim().replace(/^v/, "");
  if (!/^\d+(\.\d+){0,2}$/.test(wanted)) {
    return { ok: false, message: `.nvmrc says "${wanted}", which this check cannot compare; Node is ${actual}` };
  }
  const want = wanted.split(".");
  const have = actual.split(".");
  const ok = want.every((part, index) => part === have[index]);
  return ok
    ? { ok, message: `Node ${actual} (.nvmrc: ${wanted})` }
    : { ok, message: `Node ${actual}, but .nvmrc asks for ${wanted}: switch with nvm or fnm` };
}

/**
 * Whether the installed dependencies need `npm ci`: none installed, or the
 * lock file is newer than the install npm last recorded (a checkout with no
 * lock file has nothing to be stale against). npm rewrites
 * `node_modules/.package-lock.json` on every install, so its age is the age of
 * the install.
 *
 * @param {string} root
 */
export function dependenciesStale(root) {
  let installed;
  try {
    installed = fs.statSync(path.join(root, "node_modules", ".package-lock.json"));
  } catch {
    return true;
  }
  try {
    return fs.statSync(path.join(root, "package-lock.json")).mtimeMs > installed.mtimeMs;
  } catch {
    // Nothing to compare with: an install exists, so it stands.
    return false;
  }
}

/**
 * Runs `npm ci` in a worktree. Returns its exit status.
 *
 * @param {string} root
 */
export function installDependencies(root) {
  const result = spawnSync(npmBin, ["ci"], { cwd: root, stdio: "inherit" });
  return result.status ?? 1;
}

/**
 * Whether anything is listening on a port of this machine.
 *
 * @param {number} port
 * @returns {Promise<boolean>} true when the port is free
 */
export function isPortFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/** The chromium Playwright would launch, if it is installed. @param {string} root */
async function chromiumInstalled(root) {
  try {
    const resolved = createRequire(path.join(root, "web", "package.json")).resolve("@playwright/test");
    // Playwright is CommonJS, so its exports may arrive under `default`.
    const playwright = await import(resolved);
    const chromium = playwright.chromium ?? playwright.default?.chromium;
    return fs.existsSync(chromium.executablePath());
  } catch {
    return false;
  }
}

/**
 * Runs every check, installing what is missing, and prints one line each.
 * Returns the exit status: non-zero when something is wrong that doctor could
 * not fix. A busy port is reported, not failed: it may be this worktree's own
 * game, already running.
 *
 * @param {string} root
 * @param {{ log?: (line: string) => void, install?: (root: string) => number }} [options]
 */
export async function runDoctor(root, { log = console.log, install = installDependencies } = {}) {
  let failed = false;

  const nvmrcPath = path.join(root, ".nvmrc");
  if (fs.existsSync(nvmrcPath)) {
    const node = checkNodeVersion(fs.readFileSync(nvmrcPath, "utf8"), process.versions.node);
    log(`${node.ok ? "ok  " : "FAIL"} ${node.message}`);
    failed ||= !node.ok;
  } else {
    log(`FAIL no .nvmrc in ${root}`);
    failed = true;
  }

  if (!dependenciesStale(root)) {
    log("ok   dependencies are installed and match package-lock.json");
  } else {
    log("...  dependencies are missing or older than package-lock.json: running npm ci");
    const status = install(root);
    log(status === 0 ? "ok   dependencies installed" : "FAIL npm ci failed");
    failed ||= status !== 0;
  }

  if (await chromiumInstalled(root)) {
    log("ok   Playwright chromium is installed");
  } else {
    log("...  Playwright chromium is missing: installing it");
    const result = spawnSync(npmBin, ["-w", "web", "exec", "--", "playwright", "install", "chromium"], {
      cwd: root,
      stdio: "inherit",
    });
    log(result.status === 0 ? "ok   Playwright chromium installed" : "FAIL Playwright chromium install failed");
    failed ||= result.status !== 0;
  }

  const { ports, worktreeName } = resolveWorktreePorts(root);
  const free = await isPortFree(ports.web);
  log(
    free
      ? `ok   port ${ports.web} is free (${worktreeName ?? "main checkout"})`
      : `warn port ${ports.web} is in use (${worktreeName ?? "main checkout"}): a game or a gate may already be running here`,
  );

  return failed ? 1 : 0;
}
