// Deterministic readability judge.
//
// Scores each narration step with the Flesch–Kincaid Grade Level formula and
// compares it to the reading grade implied by the blueprint's target_age. No
// LLM, no dependencies — fully reproducible from a stored interaction.
//
// Flesch–Kincaid Grade Level:
//   0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
//
// A US grade level maps to age roughly as `grade = age - 5` (grade 5 ≈ age 10).

export const id = "flesch";

const DEFAULT_TOLERANCE = 2; // grade levels of slack above the target

/** Expected reading grade for a target age (kindergarten = age 5 = grade 0). */
export function expectedGradeForAge(age) {
  return Math.max(0, age - 5);
}

function countSentences(text) {
  const matches = text.match(/[.!?]+(?:\s|$)/g);
  // Always at least one "sentence" so we never divide by zero on a fragment.
  return Math.max(1, matches ? matches.length : 1);
}

function splitWords(text) {
  return text.match(/[A-Za-z0-9']+/g) ?? [];
}

/**
 * Heuristic syllable counter — the standard vowel-group approach with common
 * corrections (silent trailing "e" / "es" / "ed", leading "y", min of 1). The
 * silent-e regex deliberately keeps consonant+"le" endings ("candle", "apple")
 * so their final vowel group is still counted, which is the correct syllable.
 */
export function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;

  let trimmed = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "");
  trimmed = trimmed.replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 0);
}

/** Compute the Flesch–Kincaid grade level for a block of text. */
export function fleschKincaidGrade(text) {
  const words = splitWords(text);
  const wordCount = words.length;
  if (wordCount === 0) return null;
  const sentenceCount = countSentences(text);
  const syllableCount = words.reduce((sum, word) => sum + countSyllables(word), 0);

  const grade =
    0.39 * (wordCount / sentenceCount) +
    11.8 * (syllableCount / wordCount) -
    15.59;
  return Math.round(grade * 100) / 100;
}

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
