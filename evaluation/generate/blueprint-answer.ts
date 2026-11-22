/** Reading a generator's answer: a Blueprint V2, or a clue-graph case, for a generation and for a repair alike. */

import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

/** Parses an answer, and keeps the last JSON it refused, so a subject that never passed is still stored and fails its check. */
export interface AnswerParser {
  parse: (answer: string) => unknown;
  lastRejected: () => unknown;
}

function json(answer: string): unknown {
  try {
    return JSON.parse(answer);
  } catch (error) {
    throw new Error(`the answer is not valid JSON (${(error as Error).message}). First 200 chars: ${answer.slice(0, 200)}`, { cause: error });
  }
}

/**
 * Takes the model's answer as the blueprint: it must be JSON and match the
 * schema, or the attempt is retried. The last JSON that failed the schema is
 * kept, so a blueprint that never passed is still stored and fails its check.
 */
export function blueprintParser(): AnswerParser {
  let rejected: unknown;
  return {
    parse(answer) {
      const parsed = json(answer);
      const checked = BlueprintV2Schema.safeParse(parsed);
      if (checked.success) return parsed;
      rejected = parsed;
      const issues = checked.error.issues.slice(0, 5).map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
      const more = checked.error.issues.length > 5 ? ` (+${checked.error.issues.length - 5} more)` : "";
      throw new Error(`the blueprint failed BlueprintV2Schema: ${issues.join("; ")}${more}`);
    },
    lastRejected: () => rejected,
  };
}

/**
 * Takes the model's answer as a clue-graph case: it must be a JSON object, or
 * the attempt is retried. Its shape is left to the case's mechanical check, so
 * a fault in it is a named fault for a repair round, not another generation.
 */
export function caseParser(): AnswerParser {
  let rejected: unknown;
  return {
    parse(answer) {
      const parsed = json(answer);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
      rejected = parsed;
      throw new Error(`the answer is JSON but not an object: ${answer.slice(0, 200)}`);
    },
    lastRejected: () => rejected,
  };
}
