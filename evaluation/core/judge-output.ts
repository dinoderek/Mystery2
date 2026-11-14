/**
 * The output validator: whether what a judge answered is acceptable.
 *
 * Two stages. The shape is the judge's schema (or, for the turn-level age
 * judge, the shape its prompt asks for). The ids are the checks the judge's
 * registry entry declares, which need the blueprint it judged: a model that
 * cites a clue that does not exist has answered in the right shape and still
 * wrongly. A harness retries a model on the shape; the judge workspace tells
 * its agent about both.
 */

import type { z } from "zod";

import { checkAnswerIds } from "./judge-id-checks.ts";
import type { JudgeDefinition } from "./judge-loader.ts";
import { TURN_AGE_FINDING_KINDS } from "./judge-prompt.ts";

export type ShapeResult = { ok: true; data: unknown } | { ok: false; message: string };

/** Check a parsed answer against a judge's schema. Without one, it must at least carry a verdict. */
export function validateJudgeOutput(parsed: unknown, schema: z.ZodType | null): ShapeResult {
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, message: "Judge output is not a JSON object." };
  }
  if (!schema) {
    if (!("verdict" in parsed)) return { ok: false, message: "Judge output missing verdict." };
    return { ok: true, data: parsed };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, message: `Judge output failed schema validation: ${issues}` };
  }
  return { ok: true, data: result.data };
}

/** What the turn-level age judge answers. Throws a message that says what is wrong. */
export function validateTurnAgeAnswer(parsed: unknown): Record<string, unknown> {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("judge output is not a JSON object");
  }
  const answer = parsed as Record<string, unknown>;
  if (answer.verdict !== "pass" && answer.verdict !== "fail") {
    throw new Error(`judge output verdict must be "pass" or "fail", got ${JSON.stringify(answer.verdict)}`);
  }
  if (!Number.isInteger(answer.estimated_reading_age)) {
    throw new Error("judge output estimated_reading_age must be an integer");
  }
  if (!Array.isArray(answer.findings)) throw new Error("judge output findings must be an array");
  for (const finding of answer.findings as Array<Record<string, unknown> | null>) {
    if (typeof finding?.quote !== "string" || typeof finding.why !== "string") {
      throw new Error("each finding needs string quote and why");
    }
    if (!(TURN_AGE_FINDING_KINDS as readonly unknown[]).includes(finding.kind)) {
      throw new Error(
        `finding kind must be one of ${TURN_AGE_FINDING_KINDS.join(", ")}, got ${JSON.stringify(finding.kind)}`,
      );
    }
  }
  if (typeof answer.reasoning !== "string") throw new Error("judge output reasoning must be a string");
  return answer;
}

export type AnswerResult =
  | { ok: true; data: unknown }
  | { ok: false; stage: "shape"; messages: string[] }
  | { ok: false; stage: "ids"; messages: string[] };

/**
 * Both stages, for a judge's answer about a blueprint. `context` is the
 * context the judge was given, which some of its id checks read.
 */
export function validateJudgeAnswer(
  definition: JudgeDefinition,
  answer: unknown,
  blueprint: unknown,
  context: Record<string, unknown> = {},
): AnswerResult {
  const shape = validateJudgeOutput(answer, definition.schema);
  if (!shape.ok) return { ok: false, stage: "shape", messages: [shape.message] };
  const issues = checkAnswerIds(definition.entry.idChecks ?? [], shape.data, blueprint, context);
  if (issues.length > 0) return { ok: false, stage: "ids", messages: issues };
  return { ok: true, data: shape.data };
}
