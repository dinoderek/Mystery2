// Deterministic readability check on a turn.
//
// Scores each narration part with the Flesch–Kincaid Grade Level formula and
// compares it to the reading grade implied by the age the turn was narrated at
// (its `reading_age`). No model, no dependencies — fully reproducible from a
// stored turn.
//
// The metric functions live in evaluation/lib/readability.ts and are
// re-exported here so this module remains the check's entry point.

import {
  countSyllables,
  expectedGradeForAge,
  fleschKincaidGrade,
  splitWords,
} from "../../lib/readability.ts";

import type { JudgeOptions } from "./case.ts";
import type { Verdict } from "../../core/result.ts";
import type { StoredTurn } from "./turn.ts";

export { countSyllables, expectedGradeForAge, fleschKincaidGrade };

export const id = "flesch";

const DEFAULT_TOLERANCE = 2; // grade levels of slack above the target

function errorVerdict(reason: string, details: Record<string, unknown> = {}): Verdict {
  return { id, tier: "mechanical", status: "error", reason, details: { score: null, ...details } };
}

interface PartScore {
  grade: number | null;
  pass: boolean;
  words: number;
  speaker: string | null;
  preview: string;
}

function scoreParts(parts: StoredTurn["response"]["narration_parts"], threshold: number): PartScore[] {
  const scored: PartScore[] = [];
  for (const part of parts ?? []) {
    const text = typeof part?.text === "string" ? part.text.trim() : "";
    if (text.length === 0) continue;
    const grade = fleschKincaidGrade(text) as number | null;
    scored.push({
      grade,
      pass: grade !== null && grade <= threshold,
      words: splitWords(text).length,
      speaker: part.speaker?.kind ?? null,
      preview: text.slice(0, 120),
    });
  }
  return scored;
}

/**
 * Checks a turn's narration for age-appropriate reading level. Scores the
 * response's full narration text, and each narration part when an action
 * returns more than one so one offending sentence is visible. `details.score`
 * is the grade of the full text, lower being friendlier.
 */
export function judge(turn: StoredTurn, options: JudgeOptions = {}): Verdict {
  const tolerance = Number.isFinite(options.tolerance) ? (options.tolerance as number) : DEFAULT_TOLERANCE;
  const readingAge = options.readingAge ?? turn.reading_age;
  if (typeof readingAge !== "number" || !Number.isFinite(readingAge)) {
    return errorVerdict("no reading_age on the turn or in its judge options");
  }

  const expectedGrade = expectedGradeForAge(readingAge) as number;
  const threshold = expectedGrade + tolerance;
  const fullText = turn.response?.narration_text ?? "";
  if (fullText.trim().length === 0) {
    return errorVerdict("response has no narration text to score", { reading_age: readingAge });
  }

  const overallGrade = fleschKincaidGrade(fullText) as number | null;
  return {
    id,
    tier: "mechanical",
    status: overallGrade !== null && overallGrade <= threshold ? "pass" : "fail",
    details: {
      score: overallGrade,
      reading_age: readingAge,
      expected_grade: expectedGrade,
      tolerance,
      threshold,
      action: turn.action?.type ?? null,
      words: splitWords(fullText).length,
      preview: fullText.slice(0, 160),
      parts: scoreParts(turn.response.narration_parts, threshold),
    },
  };
}
