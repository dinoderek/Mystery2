import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startBudgetProxy } from "../../../evaluation/core/budget-proxy.ts";

describe("bounded live measurement", () => {
  it("waits for an already-forwarded cancelled request's charge before closing", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    let started!: () => void;
    let finish!: () => void;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const finishFirst = new Promise<void>((resolve) => { finish = resolve; });
    const upstream = http.createServer(async (_req, res) => {
      started();
      await finishFirst;
      res.end('{"model":"test","usage":{"cost":0.02}}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startBudgetProxy({ dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 10, attempts: 10, milliseconds: 60000 }, prices: { test: { input: 0.001, output: 0.001, maxOutputTokens: 100 } } });
    const client = http.request(proxy.url, { method: "POST", agent: false });
    client.on("error", () => {}); // Destroying the client intentionally resets its socket.
    const clientClosed = new Promise<void>((resolve) => client.once("close", resolve));
    client.end('{"model":"test"}');
    try {
      await firstStarted;
      client.destroy();
      await clientClosed;
      let closed = false;
      const closing = proxy.close().then(() => { closed = true; });
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(closed).toBe(false);
      finish();
      await closing;
      expect(proxy.ledger()).toMatchObject({ spent: 0.02, reserved: 0 });
      expect(JSON.parse(fs.readFileSync(path.join(dir, "ledger.json"), "utf8")).spent).toBe(0.02);
    } finally {
      finish();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);
  it("does not forward a queued request after its client cancels", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    let started!: () => void;
    let finish!: () => void;
    const firstStarted = new Promise<void>((resolve) => { started = resolve; });
    const finishFirst = new Promise<void>((resolve) => { finish = resolve; });
    let calls = 0;
    const upstream = http.createServer(async (_req, res) => {
      calls++;
      started();
      await finishFirst;
      res.end('{"model":"test","usage":{"cost":0.01}}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startBudgetProxy({ dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 10, attempts: 10, milliseconds: 60000 }, prices: { test: { input: 0.001, output: 0.001, maxOutputTokens: 100 } } });
    const controller = new AbortController();
    let closed = false;
    try {
      const first = fetch(proxy.url, { method: "POST", body: '{"model":"test"}' });
      await firstStarted;
      const second = fetch(proxy.url, { method: "POST", body: '{"model":"test"}', signal: controller.signal }).catch((error) => error);
      await new Promise((resolve) => setTimeout(resolve, 20));
      controller.abort();
      expect((await second).name).toBe("AbortError");
      // Let the local socket close reach the proxy before releasing the first call.
      await new Promise((resolve) => setTimeout(resolve, 20));
      finish();
      expect((await first).status).toBe(200);
      await proxy.close();
      closed = true;
      expect(calls).toBe(1);
      expect(proxy.ledger()).toMatchObject({ attempts: 1, spent: 0.01, reserved: 0 });
    } finally {
      finish();
      if (!closed) await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 10000);
  it("restarts after concurrent reconciled calls without residual floating-point reservations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    let active = 0;
    let peak = 0;
    const upstream = http.createServer(async (_req, res) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      res.end('{"model":"test","usage":{"cost":0.01}}');
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const options = { dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 10, attempts: 10, milliseconds: 60000 }, prices: { test: { input: 0.001, output: 0.001, maxOutputTokens: 100 } } };
    let proxy = await startBudgetProxy(options);
    try {
      await Promise.all(["a", "longer input", "third"].map((input) => fetch(proxy.url, { method: "POST", body: JSON.stringify({ model: "test", input }) })));
      expect(proxy.ledger().reserved).toBe(0);
      expect(peak).toBe(1);
      await proxy.close();
      proxy = await startBudgetProxy(options);
      expect(proxy.ledger().stopped).toBeNull();
      expect((await fetch(proxy.url, { method: "POST", body: '{"model":"test"}' })).status).toBe(200);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it.each(["attempts", "unknown cost", "model change", "provider budget", "charged rejection"])("stops before another upstream call after %s, retaining the original bytes", async (scenario) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    let calls = 0;
    let captured = "";
    const upstream = http.createServer(async (req, res) => {
      calls++;
      for await (const chunk of req) captured += chunk.toString();
      if (scenario === "provider budget" || scenario === "charged rejection") {
        res.statusCode = 402;
        res.end(JSON.stringify({ error: { metadata: { reason: "in_flight_budget_exhausted", limit_source: "openrouter_in_flight_budget" } }, ...(scenario === "charged rejection" ? { usage: { cost: 0.02 } } : {}) }));
        return;
      }
      res.end(JSON.stringify({ model: scenario === "model change" ? "other" : "test", usage: scenario === "unknown cost" ? {} : { cost: 0.01 } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startBudgetProxy({ dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 1, attempts: scenario === "attempts" ? 1 : 2, milliseconds: 60000 }, prices: { test: { input: 0.000001, output: 0.000001, maxOutputTokens: 100 } } });
    const body = '{ "model": "test", "messages": [{"role":"user","content":"case data"}] }';
    try {
      expect((await fetch(proxy.url, { method: "POST", body })).status).toBe(["provider budget", "charged rejection"].includes(scenario) ? 402 : 200);
      expect((await fetch(proxy.url, { method: "POST", body })).status).toBe(402);
      expect(calls).toBe(1);
      expect(captured).toBe(body);
      expect(fs.readFileSync(path.join(dir, "00001.request.json"), "utf8")).toBe(body);
      expect(fs.existsSync(path.join(dir, "00001.response.json"))).toBe(true);
      if (scenario === "provider budget") expect(proxy.ledger()).toMatchObject({ spent: 0, reserved: 0 });
      if (scenario === "charged rejection") expect(proxy.ledger()).toMatchObject({ spent: 0.02, reserved: 0, stopped: "Reconcile contradictory provider rejection and reported usage" });
    } finally {
      await proxy.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reserves the worst-case charge before calling, and refuses unreconciled restarts", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    const options = { dir, limits: { dollars: 0.01, attempts: 10, milliseconds: 60000 }, prices: { test: { input: 1, output: 1, maxOutputTokens: 100 } } };
    let proxy = await startBudgetProxy(options);
    try {
      expect((await fetch(proxy.url, { method: "POST", body: '{"model":"test"}' })).status).toBe(402);
      expect(proxy.ledger().attempts).toBe(0);
      await proxy.close();
      fs.writeFileSync(path.join(dir, "ledger.json"), JSON.stringify({ spent: 0, attempts: 1, started: Date.now(), reserved: 0.005, stopped: null }));
      proxy = await startBudgetProxy(options);
      expect((await fetch(proxy.url, { method: "POST", body: '{"model":"test"}' })).status).toBe(402);
      expect(proxy.ledger().stopped).toContain("Unreconciled");
    } finally { await proxy.close(); fs.rmSync(dir, { recursive: true, force: true }); }
  });
});
