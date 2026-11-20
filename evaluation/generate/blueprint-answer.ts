/** Reading a generator's answer as a Blueprint V2, for a generation and for a repair alike. */

import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

/**
 * Takes the model's answer as the blueprint: it must be JSON and match the
 * schema, or the attempt is retried. The last JSON that failed the schema is
 * kept, so a blueprint that never passed is still stored and fails its check.
 */
export function blueprintParser(): { parse: (answer: string) => unknown; lastRejected: () => unknown } {
  let rejected: unknown;
  return {
    parse(answer) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(answer);
      } catch (error) {
        throw new Error(`the answer is not valid JSON (${(error as Error).message}). First 200 chars: ${answer.slice(0, 200)}`, { cause: error });
      }
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
