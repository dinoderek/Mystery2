import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { findOpenRouterKey, loadAIConfig } from "../../../../packages/game-engine/src/ai-config.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const { sources } = loadAIConfig({ repoRoot: root, env: process.env });
const key = findOpenRouterKey({ backend: "openrouter", model: process.env.EVAL_MODEL ?? "" }, sources)?.key;
if (!key || !process.env.EVAL_MODEL) throw new Error("OpenRouter binding needs a key and EVAL_MODEL");
const system = fs.readFileSync(process.argv[2], "utf8");
const user = fs.readFileSync(process.argv[3], "utf8");
const outputLimit = process.env.EVAL_MAX_OUTPUT_TOKENS ? Number(process.env.EVAL_MAX_OUTPUT_TOKENS) : null;
if (outputLimit !== null && (!Number.isSafeInteger(outputLimit) || outputLimit < 1)) throw new Error("Invalid EVAL_MAX_OUTPUT_TOKENS");
const response = await fetch(process.env.OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    model: process.env.EVAL_MODEL,
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    ...(outputLimit === null ? {} : { max_completion_tokens: outputLimit }),
    ...(process.env.EVAL_OUTPUT_FORMAT === "text" ? {} : { response_format: { type: "json_object" } }),
  }),
  signal: AbortSignal.timeout(Number(process.env.AI_OPENROUTER_TIMEOUT_MS ?? 90000)),
});
const raw = await response.json();
if (!response.ok) throw new Error(`OpenRouter HTTP ${response.status}: ${JSON.stringify(raw)}`);
const result = raw.choices?.[0]?.message?.content;
if (typeof result !== "string") throw new Error("OpenRouter returned no assistant content");
let structured;
try { structured = JSON.parse(result); } catch { /* Plain narration keeps its prose. */ }
// The existing investigator reads this envelope; narrator/judge bindings extract result.
console.log(JSON.stringify({ result, structured_output: structured, total_cost_usd: raw.usage?.cost ?? null,
  modelUsage: { [raw.model]: { outputTokens: raw.usage?.completion_tokens ?? 0 } }, raw_response: raw }));
