#!/usr/bin/env node

/**
 * Probe free OpenRouter models for reliability and feature support.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... node scripts/probe-free-models.mjs
 *   OPENROUTER_API_KEY=sk-... node scripts/probe-free-models.mjs --models "model/a:free,model/b:free"
 *
 * Tests each model for:
 *   1. Basic chat completion (does it respond?)
 *   2. json_object response format (game endpoints need this)
 *   3. json_schema structured outputs (blueprint generator needs this)
 *   4. Latency measurement across attempts
 */

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const DEFAULT_MODELS = [
  "stepfun/step-3.5-flash:free",
  "nvidia/nemotron-3-super-120b-a12b:free",
  "arcee-ai/trinity-large-preview:free",
];

const TIMEOUT_MS = 180_000;

const apiKey = process.env.OPENROUTER_API_KEY;
if (!apiKey) {
  console.error("ERROR: Set OPENROUTER_API_KEY environment variable.");
  process.exit(1);
}

const modelsArg = process.argv.find((a) => a.startsWith("--models="))
  ?? process.argv[process.argv.indexOf("--models") + 1];
const models = modelsArg
  ? modelsArg.replace(/^--models=/, "").split(",").map((m) => m.trim()).filter(Boolean)
  : DEFAULT_MODELS;

// ── Test definitions ────────────────────────────────────────────────────

async function callOpenRouter(model, body) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const start = Date.now();
  try {
    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model, ...body }),
      signal: controller.signal,
    });
    const latencyMs = Date.now() - start;
    const text = await res.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
    return { ok: res.ok, status: res.status, latencyMs, payload, text };
  } catch (error) {
    const latencyMs = Date.now() - start;
    if (error.name === "AbortError") {
      return { ok: false, status: 0, latencyMs, payload: null, text: "", error: "TIMEOUT" };
    }
    return { ok: false, status: 0, latencyMs, payload: null, text: "", error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function extractContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("");
  }
  return null;
}

async function testBasicChat(model) {
  const result = await callOpenRouter(model, {
    messages: [
      { role: "user", content: "Reply with exactly: HELLO" },
    ],
    max_tokens: 50,
  });
  const content = result.ok ? extractContent(result.payload) : null;
  return {
    name: "basic_chat",
    pass: result.ok && typeof content === "string" && content.length > 0,
    latencyMs: result.latencyMs,
    status: result.status,
    error: result.error ?? null,
    content: content?.slice(0, 100) ?? null,
  };
}

async function testJsonObject(model) {
  const result = await callOpenRouter(model, {
    messages: [
      { role: "system", content: "You are a helpful assistant. Respond with valid JSON only." },
      { role: "user", content: 'Return a JSON object with keys "color" (string) and "count" (number).' },
    ],
    response_format: { type: "json_object" },
    max_tokens: 200,
  });
  const content = result.ok ? extractContent(result.payload) : null;
  let jsonValid = false;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      jsonValid = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    } catch { /* not valid json */ }
  }
  return {
    name: "json_object",
    pass: result.ok && jsonValid,
    latencyMs: result.latencyMs,
    status: result.status,
    error: result.error ?? null,
    content: content?.slice(0, 200) ?? null,
  };
}

async function testJsonSchema(model) {
  const schema = {
    type: "object",
    properties: {
      title: { type: "string" },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            value: { type: "number" },
          },
          required: ["name", "value"],
          additionalProperties: false,
        },
      },
    },
    required: ["title", "items"],
    additionalProperties: false,
  };

  const result = await callOpenRouter(model, {
    messages: [
      { role: "system", content: "You are a helpful assistant." },
      {
        role: "user",
        content: 'Return a JSON object with a "title" string and an "items" array of 2 objects each with "name" (string) and "value" (number).',
      },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: "TestSchema", strict: true, schema },
    },
    provider: { require_parameters: true },
    max_tokens: 300,
  });

  const content = result.ok ? extractContent(result.payload) : null;
  let schemaValid = false;
  if (content) {
    try {
      const parsed = JSON.parse(content);
      schemaValid =
        typeof parsed.title === "string" &&
        Array.isArray(parsed.items) &&
        parsed.items.length > 0 &&
        typeof parsed.items[0].name === "string" &&
        typeof parsed.items[0].value === "number";
    } catch { /* not valid */ }
  }

  // Check if the failure is specifically about structured output support
  let unsupported = false;
  if (!result.ok && result.text) {
    const lower = result.text.toLowerCase();
    unsupported =
      lower.includes("json_schema") ||
      lower.includes("response_format") ||
      lower.includes("structured") ||
      lower.includes("require_parameters");
  }

  return {
    name: "json_schema",
    pass: result.ok && schemaValid,
    latencyMs: result.latencyMs,
    status: result.status,
    error: result.error ?? null,
    unsupported,
    content: content?.slice(0, 300) ?? null,
    rawError: !result.ok ? result.text?.slice(0, 300) : null,
  };
}

// ── Runner ──────────────────────────────────────────────────────────────

async function probeModel(model) {
  console.log(`\n${"=".repeat(70)}`);
  console.log(`MODEL: ${model}`);
  console.log("=".repeat(70));

  const tests = [testBasicChat, testJsonObject, testJsonSchema];
  const results = [];

  for (const testFn of tests) {
    const result = await testFn(model);
    results.push(result);

    const icon = result.pass ? "PASS" : "FAIL";
    const extras = [];
    extras.push(`${result.latencyMs}ms`);
    if (result.status) extras.push(`status=${result.status}`);
    if (result.error) extras.push(`error=${result.error}`);
    if (result.unsupported) extras.push("(unsupported)");
    console.log(`  [${icon}] ${result.name}: ${extras.join(" | ")}`);
    if (result.content) {
      console.log(`         response: ${result.content.slice(0, 120)}`);
    }
    if (result.rawError) {
      console.log(`         raw error: ${result.rawError.slice(0, 200)}`);
    }
  }

  return { model, results };
}

async function main() {
  console.log("Free Model Probe");
  console.log(`Models: ${models.join(", ")}`);
  console.log(`Timeout per request: ${TIMEOUT_MS}ms`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  const allResults = [];
  for (const model of models) {
    const result = await probeModel(model);
    allResults.push(result);
  }

  // ── Summary table ───────────────────────────────────────────────────
  console.log(`\n${"=".repeat(70)}`);
  console.log("SUMMARY");
  console.log("=".repeat(70));

  const header = ["Model", "Chat", "JSON Obj", "JSON Schema", "Avg Latency"];
  const rows = allResults.map(({ model, results }) => {
    const chat = results.find((r) => r.name === "basic_chat");
    const jsonObj = results.find((r) => r.name === "json_object");
    const jsonSchema = results.find((r) => r.name === "json_schema");
    const avgLatency = Math.round(
      results.reduce((sum, r) => sum + r.latencyMs, 0) / results.length,
    );
    return [
      model,
      chat?.pass ? "PASS" : "FAIL",
      jsonObj?.pass ? "PASS" : "FAIL",
      jsonSchema?.pass ? "PASS" : jsonSchema?.unsupported ? "N/A" : "FAIL",
      `${avgLatency}ms`,
    ];
  });

  // Calculate column widths
  const allRows = [header, ...rows];
  const colWidths = header.map((_, i) =>
    Math.max(...allRows.map((row) => row[i].length))
  );
  const formatRow = (row) =>
    row.map((cell, i) => cell.padEnd(colWidths[i])).join(" | ");

  console.log(formatRow(header));
  console.log(colWidths.map((w) => "-".repeat(w)).join("-+-"));
  for (const row of rows) {
    console.log(formatRow(row));
  }

  // ── Recommendation ──────────────────────────────────────────────────
  console.log(`\nRECOMMENDATION:`);

  // Prefer models that pass all 3 tests; fall back to json_object support
  const fullSupport = allResults.filter(({ results }) =>
    results.every((r) => r.pass)
  );
  const jsonObjSupport = allResults.filter(({ results }) =>
    results.find((r) => r.name === "json_object")?.pass
  );

  if (fullSupport.length > 0) {
    const best = fullSupport.sort((a, b) => {
      const avgA = a.results.reduce((s, r) => s + r.latencyMs, 0) / a.results.length;
      const avgB = b.results.reduce((s, r) => s + r.latencyMs, 0) / b.results.length;
      return avgA - avgB;
    })[0];
    console.log(`  Full support (chat + json_object + json_schema): ${best.model}`);
    console.log(`  Use for both game endpoints and blueprint generation.`);
  } else if (jsonObjSupport.length > 0) {
    const best = jsonObjSupport.sort((a, b) => {
      const avgA = a.results.reduce((s, r) => s + r.latencyMs, 0) / a.results.length;
      const avgB = b.results.reduce((s, r) => s + r.latencyMs, 0) / b.results.length;
      return avgA - avgB;
    })[0];
    console.log(`  Partial support (chat + json_object only): ${best.model}`);
    console.log(`  Can use for game endpoints but NOT blueprint generation.`);
    console.log(`  Blueprint tests will need a paid model or a different free model.`);
  } else {
    console.log(`  No models passed even basic tests. Check API key and model availability.`);
  }
}

main().catch((err) => {
  console.error("Probe failed:", err);
  process.exit(1);
});
