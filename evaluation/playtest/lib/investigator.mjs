// Who chooses the next input: a model playing a persona, or a fixed script.
//
// Both answer `next(view)` with { input, plan } or null when they have
// nothing more to say. The model investigator is one isolated `claude` call
// per turn (the same `runClaudeCli` the narrator provider uses), given the whole
// view each time, so it keeps no hidden memory and any step can be replayed
// from the run's files.
//
// The reply field is `plan`, a note for the log, and not `thinking`: asking
// for the model's reasoning as output reads to the API's safeguards as
// reasoning extraction, and they refused about three turns in eight, on Sonnet
// and Opus alike, until it was renamed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  runClaudeCli,
  summarizeClaudeCliUsage,
} from "../../../packages/game-engine/src/ai-provider-claude-cli.ts";
import { RetriableAIError } from "../../../packages/game-engine/src/errors.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSONA_DIR = path.join(HERE, "..", "personas");
const PROMPT_FILE = path.join(HERE, "..", "prompts", "investigator.md");
const ATTEMPTS = 3;

const REPLY_SCHEMA = {
  type: "object",
  properties: {
    plan: { type: "string" },
    input: { type: "string", minLength: 1 },
  },
  required: ["plan", "input"],
  additionalProperties: false,
};

export function listPersonas() {
  return fs.readdirSync(PERSONA_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

export function investigatorSystemPrompt(persona) {
  const file = path.join(PERSONA_DIR, `${persona}.md`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown persona "${persona}". Known: ${listPersonas().join(", ")}`);
  }
  const personaText = fs.readFileSync(file, "utf8").trim();
  return fs.readFileSync(PROMPT_FILE, "utf8").replace("{{persona}}", personaText).trim();
}

export function modelInvestigator({ persona, model, binary = "claude", timeoutMs = 120_000 }) {
  const system = investigatorSystemPrompt(persona);
  const totals = { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 };

  return {
    kind: "model",
    persona,
    model,
    totals,
    async next(view) {
      let lastError;
      for (let attempt = 1; attempt <= ATTEMPTS; attempt += 1) {
        try {
          const reply = await runClaudeCli({
            binary,
            model,
            system,
            user: view,
            jsonSchema: REPLY_SCHEMA,
            timeoutMs,
          });
          const output = reply.structured_output;
          const input = typeof output?.input === "string" ? output.input.trim() : "";
          if (!input) {
            throw new RetriableAIError("investigator returned no input", {
              code: "INVESTIGATOR_EMPTY",
            });
          }
          const usage = summarizeClaudeCliUsage(reply);
          totals.calls += 1;
          totals.cost_usd += usage.cost_usd ?? 0;
          totals.input_tokens += usage.input_tokens;
          totals.output_tokens += usage.output_tokens;
          return {
            input,
            plan: typeof output.plan === "string" ? output.plan.trim() : "",
            model: usage.model,
            cost_usd: usage.cost_usd,
            attempts: attempt,
          };
        } catch (error) {
          lastError = error;
          if (!(error instanceof RetriableAIError)) throw error;
        }
      }
      throw lastError;
    },
  };
}

/** Plays a fixed list of inputs in order, then stops. */
export function scriptedInvestigator(inputs) {
  let index = 0;
  return {
    kind: "script",
    totals: { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    async next() {
      if (index >= inputs.length) return null;
      const input = inputs[index];
      index += 1;
      return { input, plan: "", model: null, cost_usd: null, attempts: 1 };
    },
  };
}
