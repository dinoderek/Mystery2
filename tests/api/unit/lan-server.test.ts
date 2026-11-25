import net from "node:net";

import { describe, expect, it } from "vitest";

import {
  ALLOWED_HOSTS_ENV,
  hostNameOf,
  isHostAllowed,
  parseAllowedHosts,
} from "../../../packages/game-engine/src/allowed-hosts.ts";
import { describeLan } from "../../../scripts/lib/dev-doctor.mjs";
import {
  LAN_PORT,
  describeAddresses,
  isPortAnswering,
  isTailscaleIPv4,
  lanIPv4s,
  localHostName,
  networkHostNames,
  parseTailscaleStatus,
  tailscaleStatus,
} from "../../../scripts/lib/lan-network.mjs";
import { LAN_HOST, lanAllowedHosts, lanServerEnv } from "../../../scripts/lib/lan-server.mjs";

type Run = (command: string, args: string[]) => { status: number | null; stdout: string; error?: Error };

function iface(address: string, internal = false) {
  return { address, family: "IPv4", internal, netmask: "255.255.255.0", mac: "00:00:00:00:00:00", cidr: null };
}

const RUNNING = JSON.stringify({
  BackendState: "Running",
  Self: { DNSName: "Mac.tail1234.ts.net.", TailscaleIPs: ["100.101.2.3", "fd7a:115c:a1e0::1"] },
});

describe("which hosts a LAN server answers", () => {
  it("has no list, and so no check, when the variable is unset or empty", () => {
    expect(parseAllowedHosts(undefined)).toBeNull();
    expect(parseAllowedHosts(" , ")).toBeNull();
    expect(parseAllowedHosts("Mac.local, mac.tail1234.ts.net.")).toEqual(["mac.local", "mac.tail1234.ts.net"]);
  });

  it("reads the host name from a header with a port, or an IPv6 literal", () => {
    expect(hostNameOf("Mac.Local:50000")).toBe("mac.local");
    expect(hostNameOf("mac.local")).toBe("mac.local");
    expect(hostNameOf("[fd7a::1]:50000")).toBe("fd7a::1");
  });

  it("answers IP addresses, localhost and the listed names, and nothing else", () => {
    const allowed = ["mac.local", "mac.tail1234.ts.net"];
    for (const host of ["192.168.1.20:50000", "100.101.2.3", "[::1]:50000", "localhost:50000", "MAC.local:50000", "mac.tail1234.ts.net."]) {
      expect(isHostAllowed(host, allowed), host).toBe(true);
    }
    for (const host of ["evil.example:50000", "mac.local.evil.example", "", null]) {
      expect(isHostAllowed(host, allowed), String(host)).toBe(false);
    }
  });
});

describe("this machine's addresses", () => {
  it("lists LAN IPv4s, leaving out loopback, link-local, Tailscale, IPv6 and virtual machines' networks", () => {
    const interfaces = {
      lo0: [iface("127.0.0.1", true)],
      en0: [iface("192.168.1.20"), { ...iface("fe80::1"), family: "IPv6" }],
      en7: [iface("169.254.3.4")],
      utun4: [iface("100.101.2.3")],
      bridge100: [iface("192.168.139.3")],
      en1: [iface("10.0.0.5")],
    };
    expect(lanIPv4s(interfaces)).toEqual([
      { name: "en0", address: "192.168.1.20" },
      { name: "en1", address: "10.0.0.5" },
    ]);
  });

  it("knows Tailscale's address range", () => {
    expect(isTailscaleIPv4("100.64.0.1")).toBe(true);
    expect(isTailscaleIPv4("100.127.255.255")).toBe(true);
    expect(isTailscaleIPv4("100.128.0.1")).toBe(false);
    expect(isTailscaleIPv4("192.168.1.20")).toBe(false);
  });

  it("reads the .local name from scutil on macOS, and from the host name elsewhere", () => {
    const scutil: Run = (command, args) => ({ status: 0, stdout: `${command} ${args.join(" ")}` === "scutil --get LocalHostName" ? "Dinos-Mac\n" : "" });
    expect(localHostName({ platform: "darwin", hostname: "x", run: scutil })).toBe("dinos-mac.local");
    const failing: Run = () => ({ status: 1, stdout: "" });
    expect(localHostName({ platform: "darwin", hostname: "Box.local", run: failing })).toBe("box.local");
    expect(localHostName({ platform: "linux", hostname: "box", run: failing })).toBeNull();
  });

  it("reads Tailscale's state, address and MagicDNS name", () => {
    expect(parseTailscaleStatus(RUNNING)).toEqual({ state: "running", ipv4: "100.101.2.3", dnsName: "mac.tail1234.ts.net" });
    expect(parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped" }))).toEqual({ state: "stopped", detail: "it is Stopped" });
    expect(parseTailscaleStatus("not json")).toEqual({ state: "stopped", detail: "its status could not be read" });
  });

  it("says when Tailscale is missing, when its daemon is silent, and tries the macOS app's CLI", () => {
    const missing: Run = () => ({ status: null, stdout: "", error: Object.assign(new Error("nope"), { code: "ENOENT" }) });
    expect(tailscaleStatus({ platform: "linux", run: missing })).toEqual({ state: "missing" });
    expect(tailscaleStatus({ platform: "linux", run: () => ({ status: 1, stdout: "" }) })).toEqual({
      state: "stopped",
      detail: "the Tailscale daemon did not answer",
    });
    const tried: string[] = [];
    const appOnly: Run = (command) => {
      tried.push(command);
      return command === "tailscale" ? missing(command, []) : { status: 0, stdout: RUNNING };
    };
    expect(tailscaleStatus({ platform: "darwin", run: appOnly })).toMatchObject({ state: "running" });
    expect(tried).toEqual(["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]);
  });
});

describe("what ./dev run --lan prints and allows", () => {
  const network = {
    lan: [{ name: "en0", address: "192.168.1.20" }],
    localName: "mac.local",
    tailscale: { state: "running" as const, ipv4: "100.101.2.3", dnsName: "mac.tail1234.ts.net" },
  };

  it("prints every address to open", () => {
    expect(describeAddresses(network, 50000)).toEqual([
      "  this machine     http://127.0.0.1:50000",
      "  LAN (en0)        http://192.168.1.20:50000",
      "  LAN name         http://mac.local:50000",
      "  Tailscale        http://100.101.2.3:50000",
      "  Tailscale name   http://mac.tail1234.ts.net:50000",
    ]);
  });

  it("says plainly when Tailscale is not running or not installed, and when there is no LAN", () => {
    const stopped = { lan: [], localName: null, tailscale: { state: "stopped" as const, detail: "it is Stopped" } };
    expect(describeAddresses(stopped, 1)).toEqual([
      "  this machine     http://127.0.0.1:1",
      "No LAN address: this machine is on no network another device can share.",
      "Tailscale is not running (it is Stopped): only devices on this network can connect.",
    ]);
    expect(describeAddresses({ ...network, tailscale: { state: "missing" as const } }, 1).at(-1)).toBe(
      "Tailscale is not installed: only devices on this network can connect.",
    );
  });

  it("allows the names found, Tailscale's only while it runs, plus any configured", () => {
    expect(networkHostNames(network)).toEqual(["mac.local", "mac.tail1234.ts.net"]);
    expect(networkHostNames({ ...network, tailscale: { state: "missing" } })).toEqual(["mac.local"]);
    expect(lanAllowedHosts(["mac.local"], "Extra.example, mac.local")).toEqual(["localhost", "mac.local", "extra.example"]);
  });

  it("checks hosts even when no name is found or configured", () => {
    const allowedHosts = lanAllowedHosts([], undefined);
    expect(allowedHosts).toEqual(["localhost"]);
    const list = parseAllowedHosts(lanServerEnv({}, { root: "/r", port: LAN_PORT, allowedHosts })[ALLOWED_HOSTS_ENV]);
    expect(list).not.toBeNull();
    expect(isHostAllowed("evil.example", list ?? [])).toBe(false);
  });

  it("binds every interface on the LAN port and hands the server the list", () => {
    const env = lanServerEnv({ KEEP: "1", HOST: "127.0.0.1" }, { root: "/r", port: LAN_PORT, allowedHosts: ["mac.local", "x.ts.net"] });
    expect(env).toMatchObject({ KEEP: "1", HOST: LAN_HOST, PORT: "50000", MYSTERY_REPO_ROOT: "/r", [ALLOWED_HOSTS_ENV]: "mac.local,x.ts.net" });
    expect(LAN_HOST).toBe("0.0.0.0");
  });

  it("finds the port taken when a server on every interface holds it", async () => {
    const held = net.createServer();
    await new Promise<void>((resolve) => held.listen(0, LAN_HOST, resolve));
    const { port } = held.address() as net.AddressInfo;
    try {
      expect(await isPortAnswering(port)).toBe(true);
    } finally {
      await new Promise((resolve) => held.close(resolve));
    }
    expect(await isPortAnswering(port)).toBe(false);
  });

  it("has ./dev doctor report the port and the addresses without failing", () => {
    expect(describeLan(true, network)).toEqual([
      `ok   LAN port ${LAN_PORT} is free for ./dev run --lan, which will answer on:`,
      `      this machine     http://127.0.0.1:${LAN_PORT}`,
      `      LAN (en0)        http://192.168.1.20:${LAN_PORT}`,
      `      LAN name         http://mac.local:${LAN_PORT}`,
      `      Tailscale        http://100.101.2.3:${LAN_PORT}`,
      `      Tailscale name   http://mac.tail1234.ts.net:${LAN_PORT}`,
    ]);
    const lines = describeLan(false, { lan: [], localName: null, tailscale: { state: "missing" } });
    expect(lines[0]).toMatch(/^warn LAN port 50000 is in use/);
    expect(lines.at(-1)).toBe("info Tailscale is not installed: only devices on this network can connect.");
  });
});
