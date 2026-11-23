// A local recorder for bounded experiments, in front of the existing wrappers
// and server provider. It forwards the original request bytes unchanged.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";

export interface RunLimits {
  dollars: number;
  attempts: number;
  milliseconds: number;
}
export interface PriceBound {
  input: number;
  output: number;
  maxOutputTokens: number;
}

export async function startBudgetProxy(options: {
  dir: string;
  limits: RunLimits;
  prices: Record<string, PriceBound>;
  upstream?: string;
}) {
  fs.mkdirSync(options.dir, { recursive: true });
  const ledgerFile = path.join(options.dir, "ledger.json");
  const state = fs.existsSync(ledgerFile)
    ? JSON.parse(fs.readFileSync(ledgerFile, "utf8")) as { spent: number; attempts: number; started: number; reserved: number; stopped: string | null }
    : { spent: 0, attempts: 0, started: Date.now(), reserved: 0, stopped: null as string | null };
  // An interrupted request may have been billed. Require reconciliation first.
  if (state.reserved) state.stopped = "Unreconciled requests from an interrupted run";
  const save = () => fs.writeFileSync(ledgerFile, JSON.stringify(state, null, 2) + "\n");
  const pending = new Map<string, number>();
  save();
  const server = http.createServer(async (req, res) => {
    let reservation = 0;
    let stem: string | null = null;
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks);
      const request = JSON.parse(body.toString("utf8"));
      const price = Object.hasOwn(options.prices, request.model) ? options.prices[request.model] : undefined;
      if (!price) throw new Error(`Unfrozen model: ${request.model}`);
      // A byte per input token and twice the published rates bound cache writes
      // and provider variation; reserve the model's full output limit, not an estimate.
      const outputLimit = request.max_completion_tokens ?? request.max_tokens ?? price.maxOutputTokens;
      if (!Number.isSafeInteger(outputLimit) || outputLimit < 1 || outputLimit > price.maxOutputTokens) throw new Error("Invalid output limit");
      const bound = 2 * (body.length * price.input + outputLimit * price.output);
      if (state.stopped || Date.now() - state.started >= options.limits.milliseconds || state.attempts >= options.limits.attempts || state.spent + state.reserved + bound > options.limits.dollars) {
        throw new Error(state.stopped ?? "Experiment usage limit reached");
      }
      reservation = bound;
      state.reserved += reservation;
      state.attempts += 1;
      stem = path.join(options.dir, String(state.attempts).padStart(5, "0"));
      pending.set(stem, reservation);
      fs.writeFileSync(`${stem}.request.json`, body);
      save();
      const started = Date.now();
      const response = await fetch(options.upstream ?? "https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: req.headers.authorization ?? "", "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(180000),
      });
      const raw = await response.text();
      fs.writeFileSync(`${stem}.response.json`, raw);
      const payload = JSON.parse(raw);
      const cost = payload.usage?.cost;
      if (!response.ok || typeof cost !== "number" || !Number.isFinite(cost) || cost < 0 || cost > reservation || payload.model !== request.model) {
        state.stopped = `Reconcile response ${state.attempts}: HTTP ${response.status}, usage or model mismatch`;
      }
      if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0) {
        state.spent += cost;
        pending.delete(stem);
        state.reserved = [...pending.values()].reduce((total, value) => total + value, 0);
        reservation = 0;
      }
      fs.writeFileSync(`${stem}.timing.json`, JSON.stringify({ latency_ms: Date.now() - started, status: response.status, requested_model: request.model, reported_model: payload.model, usage: payload.usage ?? null }, null, 2) + "\n");
      save();
      res.writeHead(response.status, { "Content-Type": "application/json" });
      res.end(raw);
    } catch (error) {
      if (reservation) state.stopped = `Reconcile interrupted request ${stem}: ${String(error)}`;
      save();
      res.writeHead(402, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: { message: String(error) } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/api/v1/chat/completions`, ledger: () => ({ ...state }), close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
