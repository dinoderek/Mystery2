/**
 * The addresses another device can reach this machine on: each LAN IPv4, the
 * machine's `.local` name, and its Tailscale address and MagicDNS name when
 * Tailscale is running. `./dev run --lan` prints them and allows the names;
 * `./dev doctor` reports them.
 *
 * Each function takes what it reads (the interfaces, a command runner), so the
 * tests hand it a machine rather than depending on the one they run on. Node
 * builtins only: `./dev doctor` loads this before dependencies are installed.
 */

import { spawnSync } from "node:child_process";
import net from "node:net";
import os from "node:os";

/**
 * The port `./dev run --lan` listens on, in every checkout: a device keeps one
 * bookmark. Below the worktree ports (`lib/worktree-ports.mjs`, 51000 up).
 */
export const LAN_PORT = 50000;

/**
 * Whether something accepts connections on the port on loopback, which a server
 * on every interface does too. It connects rather than listens: listening on
 * every interface would raise the macOS firewall prompt.
 *
 * @param {number} port
 * @returns {Promise<boolean>}
 */
export function isPortAnswering(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const settle = (answering) => {
      socket.destroy();
      resolve(answering);
    };
    socket.setTimeout(1_000);
    socket.once("connect", () => settle(true));
    socket.once("timeout", () => settle(false));
    socket.once("error", () => settle(false));
  });
}

/** @typedef {{ status: number | null, stdout: string, error?: Error }} RunResult */
/** @typedef {(command: string, args: string[]) => RunResult} Run */

/** @type {Run} */
export function runQuietly(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5_000 });
  return { status: result.status, stdout: result.stdout ?? "", error: result.error };
}

/** Tailscale's addresses: 100.64.0.0/10, the carrier-grade NAT range. */
export function isTailscaleIPv4(address) {
  const [first, second] = address.split(".").map(Number);
  return first === 100 && second >= 64 && second <= 127;
}

/** Interfaces of virtual machines and containers, which no other device is on. */
const VIRTUAL_INTERFACE = /^(bridge\d|vmnet|vboxnet|docker|veth|utun)/;

/**
 * Each LAN IPv4 of this machine with its interface. Loopback, link-local
 * (169.254/16, no network gave it), Tailscale's own addresses and virtual
 * machines' networks are left out.
 *
 * @param {NodeJS.Dict<os.NetworkInterfaceInfo[]>} [interfaces]
 * @returns {{ name: string, address: string }[]}
 */
export function lanIPv4s(interfaces = os.networkInterfaces()) {
  const found = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    if (VIRTUAL_INTERFACE.test(name)) continue;
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.") || isTailscaleIPv4(entry.address)) continue;
      found.push({ name, address: entry.address });
    }
  }
  return found;
}

/**
 * The machine's `.local` (Bonjour) name. On macOS it is the Local Hostname in
 * Sharing settings, which `scutil` reads; elsewhere the host name, when it is
 * already a `.local` name. Null when there is none.
 *
 * @param {{ platform?: NodeJS.Platform, hostname?: string, run?: Run }} [machine]
 */
export function localHostName({ platform = process.platform, hostname = os.hostname(), run = runQuietly } = {}) {
  if (platform === "darwin") {
    const result = run("scutil", ["--get", "LocalHostName"]);
    const name = result.status === 0 ? result.stdout.trim() : "";
    if (name) return `${name}.local`.toLowerCase();
  }
  return hostname.toLowerCase().endsWith(".local") ? hostname.toLowerCase() : null;
}

/**
 * @typedef {{ state: "missing" }
 *   | { state: "stopped", detail: string }
 *   | { state: "running", ipv4: string | null, dnsName: string | null }} TailscaleStatus
 */

/** Where the Tailscale CLI may be: the PATH, then inside the macOS app. */
function tailscaleCommands(platform) {
  return platform === "darwin" ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"] : ["tailscale"];
}

/**
 * What `tailscale status --json` says about this machine.
 *
 * @param {string} stdout
 * @returns {TailscaleStatus}
 */
export function parseTailscaleStatus(stdout) {
  let status;
  try {
    status = JSON.parse(stdout);
  } catch {
    return { state: "stopped", detail: "its status could not be read" };
  }
  if (status.BackendState !== "Running") {
    return { state: "stopped", detail: `it is ${status.BackendState ?? "in an unknown state"}` };
  }
  const ipv4 = (status.Self?.TailscaleIPs ?? []).find((ip) => isTailscaleIPv4(ip)) ?? null;
  const dnsName = status.Self?.DNSName ? String(status.Self.DNSName).replace(/\.$/, "").toLowerCase() : null;
  return { state: "running", ipv4, dnsName: dnsName || null };
}

/**
 * Whether Tailscale is installed and running here, and its address and name.
 *
 * @param {{ platform?: NodeJS.Platform, run?: Run }} [machine]
 * @returns {TailscaleStatus}
 */
export function tailscaleStatus({ platform = process.platform, run = runQuietly } = {}) {
  for (const command of tailscaleCommands(platform)) {
    const result = run(command, ["status", "--json"]);
    if (result.error && /** @type {NodeJS.ErrnoException} */ (result.error).code === "ENOENT") continue;
    // A stopped daemon still prints its state as JSON, with a non-zero status.
    if (result.stdout.trim()) return parseTailscaleStatus(result.stdout);
    return { state: "stopped", detail: "the Tailscale daemon did not answer" };
  }
  return { state: "missing" };
}

/**
 * @typedef {{ lan: { name: string, address: string }[], localName: string | null, tailscale: TailscaleStatus }} Network
 */

/** Everything at once, read from this machine. @returns {Network} */
export function discoverNetwork() {
  return { lan: lanIPv4s(), localName: localHostName(), tailscale: tailscaleStatus() };
}

/** The names a device will use, which the server must answer. @param {Network} network */
export function networkHostNames(network) {
  const names = [network.localName];
  if (network.tailscale.state === "running") names.push(network.tailscale.dnsName);
  return names.filter((name) => typeof name === "string" && name.length > 0);
}

/**
 * One line per address to open, then a line on Tailscale when it is not
 * running, and one when no LAN address was found.
 *
 * @param {Network} network
 * @param {number} port
 * @returns {string[]}
 */
export function describeAddresses(network, port) {
  const url = (host) => `http://${host}:${port}`;
  const lines = [`  this machine     ${url("127.0.0.1")}`];
  for (const { name, address } of network.lan) lines.push(`  LAN (${name})`.padEnd(19) + url(address));
  if (network.localName) lines.push(`  LAN name         ${url(network.localName)}`);
  const { tailscale } = network;
  if (tailscale.state === "running") {
    if (tailscale.ipv4) lines.push(`  Tailscale        ${url(tailscale.ipv4)}`);
    if (tailscale.dnsName) lines.push(`  Tailscale name   ${url(tailscale.dnsName)}`);
  }
  if (network.lan.length === 0) lines.push("No LAN address: this machine is on no network another device can share.");
  if (tailscale.state === "missing") lines.push("Tailscale is not installed: only devices on this network can connect.");
  if (tailscale.state === "stopped") lines.push(`Tailscale is not running (${tailscale.detail}): only devices on this network can connect.`);
  return lines;
}
