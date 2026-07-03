// Deterministic readability judge.
//
// Scores each narration step with the Flesch–Kincaid Grade Level formula and
// compares it to the reading grade implied by the blueprint's target_age. No
// LLM, no dependencies — fully reproducible from a stored interaction.
//
// The metric functions live in evaluation/lib/readability.mjs (shared with the
// blueprint pipeline's age_appropriate analyzer) and are re-exported here so
// this module remains the judge-facing entry point.

import {
  countSyllables,
  expectedGradeForAge,
  fleschKincaidGrade,
  splitWords,
} from "../../../lib/readability.mjs";

export { countSyllables, expectedGradeForAge, fleschKincaidGrade };

export const id = "flesch";

const DEFAULT_TOLERANCE = 2; // grade levels of slack above the target

/**
 * Judge a single interaction response for age-appropriate reading level. Scores
 * the response's full narration text (and each narration part, when an action
 * returns more than one). Returns { id, status, score, details, parts }.
 */
export function judge(interaction, { config = {} } = {}) {
  const tolerance = Number.isFinite(config.tolerance)
    ? config.tolerance
    : DEFAULT_TOLERANCE;
  const targetAge = config.targetAge ?? interaction.target_age;
  if (!Number.isFinite(targetAge)) {
    return {
      id,
      status: "error",
      score: null,
      details: { reason: "no target_age available on interaction or config" },
      parts: [],
    };
  }

  const expectedGrade = expectedGradeForAge(targetAge);
  const threshold = expectedGrade + tolerance;

  const response = interaction.response ?? {};
  const fullText = response.narration_text ?? "";
  if (fullText.trim().length === 0) {
    return {
      id,
      status: "error",
      score: null,
      details: { reason: "response has no narration text to score", target_age: targetAge },
      parts: [],
    };
  }

  // Per-part breakdown so a single offending sentence is visible.
  const parts = [];
  for (const part of response.narration_parts ?? []) {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    if (text.length === 0) continue;
    const grade = fleschKincaidGrade(text);
    parts.push({
      grade,
      pass: grade !== null && grade <= threshold,
      words: splitWords(text).length,
      speaker: part.speaker?.kind ?? null,
      preview: text.slice(0, 120),
    });
  }

  const overallGrade = fleschKincaidGrade(fullText);
  const status = overallGrade !== null && overallGrade <= threshold ? "pass" : "fail";

  return {
    id,
    status,
    score: overallGrade, // grade of the full response (lower is friendlier)
    details: {
      target_age: targetAge,
      expected_grade: expectedGrade,
      tolerance,
      threshold,
      action: interaction.action?.type ?? null,
      words: splitWords(fullText).length,
      preview: fullText.slice(0, 160),
    },
    parts,
  };
}
