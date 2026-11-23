/** Reading a generator's answer as a clue-graph case, for a generation and for a repair alike. */

/** Parses an answer, and keeps the last JSON it refused, so a subject that never passed is still stored. */
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
