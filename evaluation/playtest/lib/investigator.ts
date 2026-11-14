// Who chooses the next input: a model playing a persona, or a fixed script.
//
// Both answer `next(view, { checkpoint })` with { input, plan } or null when
// they have nothing more to say; a script can also answer { divergence }, and
// says through `finish(checkpoint)` whether a game that ended has diverged.
// The model investigator is one isolated Claude call per turn through the
// core's model runner and the `investigator` binding, given the whole view each
// time, so it keeps no hidden memory and any step can be replayed from the run's
// files. The binding's wrapper (wrappers/claude-investigator.sh) owns the CLI's
// flags and the reply schema; this file reads the reply.
//
// The reply field is `plan`, a note for the log, and not `thinking`: asking
// for the model's reasoning as output reads to the API's safeguards as
// reasoning extraction, and they refused about three turns in eight, on Sonnet
// and Opus alike, until it was renamed.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ResolvedBinding } from "../../core/config.ts";
import type { ModelCall } from "../../core/result.ts";
import { runModel } from "../../core/runner.ts";
import { compareCheckpoints } from "./replay.ts";
import type { Checkpoint, FieldDifference } from "./replay.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PERSONA_DIR = path.join(HERE, "..", "personas");
const PROMPT_FILE = path.join(HERE, "..", "prompts", "investigator.md");

/** The binding every investigator call goes through (`evaluation/config.example.json`). */
export const INVESTIGATOR_BINDING = "investigator";

/** The input the investigator chose, and what choosing it took. */
export interface Decision {
  input: string;
  plan: string;
  model: string | null;
  cost_usd: number | null;
  attempts: number;
}

/** Where a replay stopped matching its recording. */
export interface Divergence {
  step: number;
  input: string | null;
  differences: Record<string, FieldDifference>;
}

export interface Investigator {
  /** `model`, or `script` for a fixed list of inputs. */
  kind: "model" | "script";
  /** Every model call made so far, failed ones included. */
  calls: readonly ModelCall[];
  next(view: string, context?: { checkpoint?: Checkpoint }): Promise<Decision | { divergence: Divergence } | null>;
  /** The game has ended: a divergence if the recording had more to type. */
  finish?(checkpoint: Checkpoint): Divergence | null;
}

export interface ScriptedInvestigator extends Investigator {
  finish(checkpoint: Checkpoint): Divergence | null;
  /** The first difference in found clues, which does not stop a replay. */
  clueDrift: { step: number; input: string; expected: string[]; actual: string[] } | null;
}

export function listPersonas(): string[] {
  return fs
    .readdirSync(PERSONA_DIR)
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -3))
    .sort();
}

export function investigatorSystemPrompt(persona: string): string {
  const file = path.join(PERSONA_DIR, `${persona}.md`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown persona "${persona}". Known: ${listPersonas().join(", ")}`);
  }
  const personaText = fs.readFileSync(file, "utf8").trim();
  return fs.readFileSync(PROMPT_FILE, "utf8").replace("{{persona}}", personaText).trim();
}

/** The fields of the Claude CLI's `--output-format json` envelope this file reads. */
interface Envelope {
  is_error?: boolean;
  result?: unknown;
  structured_output?: { input?: unknown; plan?: unknown } | null;
  modelUsage?: Record<string, { outputTokens?: number }>;
}

interface Reply {
  input: string;
  plan: string;
  model: string | null;
}

/** The model that wrote most of the reply, as the CLI names it. */
function respondingModel(envelope: Envelope): string | null {
  const models = Object.entries(envelope.modelUsage ?? {});
  models.sort(([, a], [, b]) => (b.outputTokens ?? 0) - (a.outputTokens ?? 0));
  return models[0]?.[0] ?? null;
}

/** The investigator's choice from the wrapper's output; throwing rejects it, and the runner retries. */
export function parseReply(answer: string): Reply {
  const envelope = JSON.parse(answer) as Envelope;
  if (envelope.is_error) {
    const reason = typeof envelope.result === "string" ? envelope.result : "unknown error";
    throw new Error(`claude CLI reported an error: ${reason}`);
  }
  const output = envelope.structured_output;
  const input = typeof output?.input === "string" ? output.input.trim() : "";
  if (!input) throw new Error("investigator returned no input");
  return { input, plan: typeof output?.plan === "string" ? output.plan.trim() : "", model: respondingModel(envelope) };
}

export function modelInvestigator({
  persona,
  binding,
  logDir,
}: {
  persona: string;
  binding: ResolvedBinding;
  /** Where each call's prompts and per-attempt logs go. */
  logDir: string;
}): Investigator & { persona: string; model: string | null } {
  const system = investigatorSystemPrompt(persona);
  const calls: ModelCall[] = [];

  return {
    kind: "model",
    persona,
    model: binding.model,
    calls,
    async next(view) {
      const outcome = await runModel({
        binding,
        step: `investigator-${calls.length + 1}`,
        systemPrompt: system,
        userMessage: view,
        logDir,
        parse: parseReply,
      });
      calls.push(outcome.call);
      if (!outcome.ok) throw new Error(outcome.error);
      const { input, plan, model } = outcome.value;
      return { input, plan, model, cost_usd: outcome.call.cost_usd, attempts: outcome.call.attempts.length };
    },
  };
}

/**
 * Plays a fixed list of inputs in order, then stops.
 *
 * Given `checkpoints` (from a recorded script.json, one per input) and `end`,
 * it checks each against the live game before typing the input, and `end`
 * once the inputs are used up, and answers { divergence } instead when the
 * game has moved on (./replay.ts). The first difference in found clues alone
 * is kept in `clueDrift` and does not stop it.
 */
export function scriptedInvestigator(
  inputs: readonly string[],
  { checkpoints = null, end = null }: { checkpoints?: readonly Checkpoint[] | null; end?: Checkpoint | null } = {},
): ScriptedInvestigator {
  let index = 0;
  const expectedAt = (position: number): Checkpoint | null | undefined =>
    position < inputs.length ? checkpoints?.[position] : end;
  const divergenceAt = (differences: Divergence["differences"]): Divergence => ({
    step: index + 1,
    input: index < inputs.length ? inputs[index] : null,
    differences,
  });

  const investigator: ScriptedInvestigator = {
    kind: "script",
    calls: [],
    clueDrift: null,
    async next(_view, context) {
      const checkpoint = context?.checkpoint;
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
    finish(checkpoint) {
      const expected = expectedAt(index);
      if (index >= inputs.length || !expected) return null;
      const blocking = compareCheckpoints(expected, checkpoint).blocking;
      return divergenceAt(blocking ?? { mode: { expected: expected.mode, actual: checkpoint.mode } });
    },
  };
  return investigator;
}
