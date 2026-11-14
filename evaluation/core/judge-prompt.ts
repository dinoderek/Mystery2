/**
 * The composer: what a judge is sent. A judge's system prompt is its
 * preamble, its brief, the authoritative JSON Schema of its answer and, when
 * it has one, its context. Its user message is the dimension id, the context
 * and whatever the subject adds. One function builds each, so a judge reads
 * the same whichever harness runs it.
 *
 * The turn-level age judge is the exception that stays in code: its prompt
 * is rendered from the age profile, so the narrator and its judge share one
 * source of truth per age.
 */

import { zodToJsonSchema } from "zod-to-json-schema";

import { renderComplexityGuidance } from "../../packages/shared/src/age-profile.ts";
import type { JudgeDefinition } from "./judge-loader.ts";

export const TURN_AGE_FINDING_KINDS = [
  "vocabulary",
  "sentence_length",
  "figurative_language",
  "clarity",
] as const;

const TURN_AGE_OUTPUT_CONTRACT = `{
  "estimated_reading_age": <integer — the youngest age that could comfortably read this text unaided>,
  "findings": [
    {
      "quote": "<short verbatim quote of the offending phrase>",
      "kind": "vocabulary" | "sentence_length" | "figurative_language" | "clarity",
      "why": "<why a target-age reader stumbles here>",
      "suggestion": "<optional age-appropriate rewording>"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "<one short paragraph>"
}`;

/** What the context section of a prompt is called: a blueprint's is per spec, any other subject's per dimension. */
function contextHeading(definition: JudgeDefinition): string {
  return definition.entry.subjects.includes("blueprint") ? "Per-spec context" : "Dimension context";
}

/** The system prompt of a judge whose prompt is a brief, a schema and a preamble. */
export function composeJudgeSystemPrompt(
  definition: JudgeDefinition,
  context: Record<string, unknown> | null = null,
): string {
  if (definition.preamble === null) {
    throw new Error(`Judge "${definition.id}" builds its prompt in code; it has no preamble to compose.`);
  }
  let composed = `${definition.preamble}\n\n---\n\n${definition.text}`;
  if (definition.schema) {
    const jsonSchema = zodToJsonSchema(definition.schema, { target: "jsonSchema7" });
    composed +=
      `\n\n---\n\n## Output JSON Schema (authoritative)\n\n` +
      `Your response MUST be a single JSON object matching this schema. ` +
      `If the prose contract above and this schema disagree, the schema wins.\n\n` +
      `\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\n`;
  }
  if (context && typeof context === "object") {
    composed += `\n\n---\n\n## ${contextHeading(definition)}\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
  }
  return composed;
}

/**
 * The user message of a judge: its id, its context, then the subject's parts
 * in the order given (a blueprint judge's are `story_brief` and `blueprint`; a
 * game-master judge's are `blueprint` and `subject`).
 */
export function composeJudgeUserMessage(
  id: string,
  context: Record<string, unknown> | null,
  parts: Record<string, unknown>,
): string {
  return JSON.stringify({ dimension_id: id, context, ...parts });
}

/** The system prompt of the turn-level age judge, for a target age. */
export function composeTurnAgeSystemPrompt(targetAge: number): string {
  return [
    `You are an expert in children's reading levels. You are judging ONE piece of narration from a detective game played by a ${targetAge}-year-old child.`,
    ``,
    `The narration was generated under these writing instructions:`,
    ``,
    renderComplexityGuidance(targetAge),
    ``,
    `Judge whether the narration actually follows them. Look for what a readability formula cannot see:`,
    `- vocabulary: words a ${targetAge}-year-old would not know and cannot work out from context`,
    `- sentence_length: sentences that stack clauses well past the guidance`,
    `- figurative_language: idioms, metaphors, or irony a child this age would misread`,
    `- clarity: phrasing where the child cannot tell what they are being told`,
    ``,
    `Verdict "pass" iff the narration as a whole is comfortable for a ${targetAge}-year-old to read unaided. Stretch words within the stated new-word allowance are fine; a pattern of overshooting is not. Judge language complexity only — tone and content suitability are out of scope.`,
    ``,
    `Respond with ONLY a single JSON object (no prose, no code fences) matching:`,
    ``,
    TURN_AGE_OUTPUT_CONTRACT,
  ].join("\n");
}
