// A server started with an allow-list, as `./dev run --lan` starts one, answers
// IP addresses, `localhost` and the listed names, and refuses any other `Host`.
// `fetch` cannot set `Host`, so these requests go through `node:http`.

import http from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";

let server: OwnServer;

beforeAll(async () => {
  server = await startOwnServer({ env: { MYSTERY_ALLOWED_HOSTS: "mac.local,mac.tail1234.ts.net" } });
});

afterAll(async () => {
  await server?.stop();
});

function statusFor(host: string, pathname = "/api/players"): Promise<number> {
  const url = new URL(`${server.apiUrl}${pathname.replace(/^\/api/, "")}`);
  return new Promise((resolve, reject) => {
    const request = http.get({ host: url.hostname, port: url.port, path: url.pathname, headers: { Host: host } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    request.on("error", reject);
  });
}

describe("a server with an allow-list", () => {
  it("answers an IP address, localhost and each listed name", async () => {
    const { port } = new URL(server.apiUrl);
    for (const host of [`127.0.0.1:${port}`, `192.168.1.20:${port}`, `localhost:${port}`, `mac.local:${port}`, "MAC.TAIL1234.TS.NET"]) {
      expect(await statusFor(host), host).toBe(200);
    }
  });

  it("refuses any other name, on the API and on pages", async () => {
    expect(await statusFor("evil.example")).toBe(403);
    expect(await statusFor("mac.local.evil.example", "/api/blueprints-list")).toBe(403);
    expect(await statusFor("evil.example", "/settings")).toBe(403);
  });
});
