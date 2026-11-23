import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startBudgetProxy } from "../../../evaluation/core/budget-proxy.ts";

describe("bounded live measurement", () => {
  it("restarts after concurrent reconciled calls without residual floating-point reservations", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    const upstream = http.createServer((_req, res) => res.end('{"model":"test","usage":{"cost":0.01}}'));
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const options = { dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 10, attempts: 10, milliseconds: 60000 }, prices: { test: { input: 0.001, output: 0.001, maxOutputTokens: 100 } } };
    let proxy = await startBudgetProxy(options);
    try {
      await Promise.all(["a", "longer input", "third"].map((input) => fetch(proxy.url, { method: "POST", body: JSON.stringify({ model: "test", input }) })));
      expect(proxy.ledger().reserved).toBe(0);
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
  it.each(["attempts", "unknown cost", "model change"])("stops before another upstream call after %s, retaining the original bytes", async (scenario) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-budget-"));
    let calls = 0;
    let captured = "";
    const upstream = http.createServer(async (req, res) => {
      calls++;
      for await (const chunk of req) captured += chunk.toString();
      res.end(JSON.stringify({ model: scenario === "model change" ? "other" : "test", usage: scenario === "unknown cost" ? {} : { cost: 0.01 } }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const proxy = await startBudgetProxy({ dir, upstream: `http://127.0.0.1:${(upstream.address() as { port: number }).port}`, limits: { dollars: 1, attempts: scenario === "attempts" ? 1 : 2, milliseconds: 60000 }, prices: { test: { input: 0.000001, output: 0.000001, maxOutputTokens: 100 } } });
    const body = '{ "model": "test", "messages": [{"role":"user","content":"case data"}] }';
    try {
      expect((await fetch(proxy.url, { method: "POST", body })).status).toBe(200);
      expect((await fetch(proxy.url, { method: "POST", body })).status).toBe(402);
      expect(calls).toBe(1);
      expect(captured).toBe(body);
      expect(fs.readFileSync(path.join(dir, "00001.request.json"), "utf8")).toBe(body);
      expect(fs.existsSync(path.join(dir, "00001.response.json"))).toBe(true);
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
