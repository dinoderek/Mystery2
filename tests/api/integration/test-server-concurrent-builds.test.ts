// Two test servers built from one checkout at the same time, by separate
// processes, as two `./dev eval play` runs start them. Each builds into a
// folder of its own, so neither build breaks the other, nor the suite's
// server, which is running from its own build meanwhile.

import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const TEST_SERVER = path.join(REPO_ROOT, "scripts/lib/test-server.mjs");
const MARKER = "STARTED ";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** What a child saw: its build folder and the status of a page and an endpoint. */
interface Started {
  buildDir: string;
  page: number;
  api: number;
}

// Builds and starts a server in a child process, asks it for a page and an
// endpoint, stops it, and reports back on a marked line of stdout (the build
// writes there too).
const CHILD = `
const { startTestServer } = await import(process.env.TEST_SERVER);
const server = await startTestServer({ repoRoot: process.env.REPO_ROOT, port: Number(process.env.PORT) });
const page = (await fetch(server.url + "/")).status;
const api = (await fetch(server.url + "/api/players")).status;
await server.stop();
console.log(${JSON.stringify(MARKER)} + JSON.stringify({ buildDir: server.buildDir, page, api }));
`;

// A child still running when its test ends (a timeout) is killed, so it leaves
// no server or build behind.
const children = new Set<ChildProcess>();
afterEach(() => {
  for (const child of children) child.kill("SIGKILL");
  children.clear();
});

async function startInChild(): Promise<Started> {
  const port = await freePort();
  const child = spawn(process.execPath, ["--input-type=module", "-e", CHILD], {
    env: { ...process.env, TEST_SERVER, REPO_ROOT, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  children.add(child);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const code = await new Promise<number | null>((resolve) => child.on("exit", resolve));
  children.delete(child);
  const line = output.split("\n").find((l) => l.startsWith(MARKER));
  if (code !== 0 || !line) throw new Error(`Test server child exited ${code}:\n${output}`);
  return JSON.parse(line.slice(MARKER.length)) as Started;
}

describe("test servers started at once from one checkout", () => {
  it("each builds into a folder of its own, serves, and removes it on stop", async () => {
    const [first, second] = await Promise.all([startInChild(), startInChild()]);

    for (const started of [first, second]) {
      expect(started).toMatchObject({ page: 200, api: 200 });
      expect(fs.existsSync(started.buildDir)).toBe(false);
    }
    expect(first.buildDir).not.toBe(second.buildDir);
  }, 180_000);
});
