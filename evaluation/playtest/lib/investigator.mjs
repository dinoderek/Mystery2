// Who chooses the next input: a model playing a persona, or a fixed script.
//
// Both answer `next(view, { checkpoint })` with { input, plan } or null when
// they have nothing more to say; a script can also answer { divergence }, and
// says through `finish(checkpoint)` whether a game that ended has diverged.
// The model investigator is one isolated `claude` call per turn (the same
// `runClaudeCli` the narrator provider uses), given the whole view each time,
// so it keeps no hidden memory and any step can be replayed from the run's
// files.
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
import { compareCheckpoints } from "./replay.mjs";

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

/**
 * Plays a fixed list of inputs in order, then stops.
 *
 * Given `checkpoints` (from a recorded script.json, one per input) and `end`,
 * it checks each against the live game before typing the input, and `end`
 * once the inputs are used up, and answers { divergence } instead when the
 * game has moved on (./replay.mjs). The first difference in found clues alone
 * is kept in `clueDrift` and does not stop it.
 */
export function scriptedInvestigator(inputs, { checkpoints = null, end = null } = {}) {
  let index = 0;
  const expectedAt = (position) => position < inputs.length ? checkpoints?.[position] : end;
  const divergenceAt = (differences) => ({
    step: index + 1,
    input: index < inputs.length ? inputs[index] : null,
    differences,
  });

  const investigator = {
    kind: "script",
    totals: { calls: 0, cost_usd: 0, input_tokens: 0, output_tokens: 0 },
    clueDrift: null,
    async next(_view, { checkpoint } = {}) {
      const expected = expectedAt(index);
      if (expected && checkpoint) {
        const difference = compareCheckpoints(expected, checkpoint);
        if (difference.blocking) return { divergence: divergenceAt(difference.blocking) };
        if (difference.clues && !investigator.clueDrift && index < inputs.length) {
          investigator.clueDrift = { step: index + 1, input: inputs[index], ...difference.clues };
        }
      }
      if (index >= inputs.length) return null;
      const input = inputs[index];
      index += 1;
      return { input, plan: "", model: null, cost_usd: null, attempts: 1 };
    },
    /** The game has ended: a divergence if the recording had more to type. */
    finish(checkpoint) {
      const expected = expectedAt(index);
      if (index >= inputs.length || !expected) return null;
      const blocking = compareCheckpoints(expected, checkpoint).blocking;
      return divergenceAt(blocking ?? { mode: { expected: expected.mode, actual: checkpoint.mode } });
    },
  };
  return investigator;
}
