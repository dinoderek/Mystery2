/**
 * `./dev run --lan`: the game served to other devices, on the home network and
 * over Tailscale, for a playtest.
 *
 * It runs the production build rather than `vite dev`: a phone loads a few
 * bundled files instead of hundreds of modules, and there is no hot-reload
 * socket to reach from another device. The build is the one the suites run, so
 * it is already proven. It binds every IPv4 interface on `LAN_PORT`, answers
 * only the host names `lan-network.mjs` finds (and any in
 * `MYSTERY_ALLOWED_HOSTS`) besides IP addresses, and prints every address.
 *
 * `npm run dev` and the suites stay on loopback.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALLOWED_HOSTS_ENV, parseAllowedHosts } from "../../packages/game-engine/src/allowed-hosts.ts";
import { LAN_PORT, describeAddresses, discoverNetwork, isPortAnswering, networkHostNames } from "./lan-network.mjs";
import { startServer } from "./process.mjs";
import { buildEntry, buildWebApp, waitForReady } from "./test-server.mjs";

/** Every IPv4 interface. */
export const LAN_HOST = "0.0.0.0";

/** Where the build goes: inside `web/`, so its imports resolve against the checkout's `node_modules`. */
export function lanBuildDir(root) {
  return path.join(root, "web", ".lan-build");
}

/**
 * The host names the server answers: `localhost`, those found on this machine,
 * then any the operator listed, without repeats. Never empty, as an empty list
 * would mean no check at all.
 *
 * @param {string[]} discovered
 * @param {string | undefined} configured `MYSTERY_ALLOWED_HOSTS` as given
 */
export function lanAllowedHosts(discovered, configured) {
  return [...new Set(["localhost", ...discovered.map((name) => name.toLowerCase()), ...(parseAllowedHosts(configured) ?? [])])];
}

/**
 * The server's environment: the game's own, bound to every interface on the
 * LAN port, answering the given names.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ root: string, port: number, allowedHosts: string[] }} options
 */
export function lanServerEnv(env, { root, port, allowedHosts }) {
  return {
    ...env,
    HOST: LAN_HOST,
    PORT: String(port),
    MYSTERY_REPO_ROOT: root,
    [ALLOWED_HOSTS_ENV]: allowedHosts.join(","),
  };
}

/**
 * Builds the app afresh into `lanBuildDir`. It builds against an empty config
 * root of its own, which `buildWebApp` then checks was left without a database,
 * so building never touches the one the playtest plays on.
 */
function buildForLan(root) {
  const buildDir = lanBuildDir(root);
  fs.rmSync(buildDir, { recursive: true, force: true });
  fs.mkdirSync(buildDir, { recursive: true });
  const configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-lan-build-"));
  try {
    buildWebApp(root, configRoot, buildDir);
  } finally {
    fs.rmSync(configRoot, { recursive: true, force: true });
  }
  return buildDir;
}

/**
 * Builds, starts and announces the server, then waits for it to stop.
 * Resolves to its exit status. With `serverLog`, the server's output is also
 * appended there (`startServer`).
 *
 * @param {{ root: string, env: Record<string, string | undefined>, log?: (line: string) => void, serverLog?: string | null }} options
 * @returns {Promise<number>}
 */
export async function runLanServer({ root, env, log = console.log, serverLog = null }) {
  const port = LAN_PORT;
  if (await isPortAnswering(port)) {
    log(`Port ${port} is in use: a LAN game is probably already running. Stop it and try again.`);
    return 1;
  }

  const buildDir = buildForLan(root);
  const network = discoverNetwork();
  const allowedHosts = lanAllowedHosts(networkHostNames(network), env[ALLOWED_HOSTS_ENV]);

  // Ctrl-C reaches the server too, as one process group; this process waits
  // for it to stop rather than leaving it behind.
  const { child, exited, exit } = startServer({
    command: process.execPath,
    args: [buildEntry(buildDir)],
    cwd: path.join(root, "web"),
    stdin: "ignore",
    env: lanServerEnv(env, { root, port, allowedHosts }),
    serverLog,
  });

  try {
    await waitForReady(`http://127.0.0.1:${port}`, exited);
  } catch (error) {
    log(error.message);
    if (!exited()) child.kill("SIGTERM");
    await exit;
    return 1;
  }

  log(`\nThe game is up for other devices. Open one of these:`);
  for (const line of describeAddresses(network, port)) log(line);
  log("Home WiFi and a private tailnet only: there are no passwords (docs/local-infrastructure.md). Ctrl-C stops it.\n");
  return exit;
}
