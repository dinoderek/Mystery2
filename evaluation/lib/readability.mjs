// Deterministic readability metrics shared across evaluation harnesses.
//
// Used by the runtime harness's `flesch` judge (scores live narration) and by
// the blueprint pipeline's `age_appropriate` analyzer (scores authored
// player-facing text). No LLM, no dependencies — fully reproducible.
//
// Flesch–Kincaid Grade Level:
//   0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59
//
// A US grade level maps to age roughly as `grade = age - 5` (grade 5 ≈ age 10).

/** Expected reading grade for a target age (kindergarten = age 5 = grade 0). */
export function expectedGradeForAge(age) {
  return Math.max(0, age - 5);
}

export function countSentences(text) {
  const matches = text.match(/[.!?]+(?:\s|$)/g);
  // Always at least one "sentence" so we never divide by zero on a fragment.
  return Math.max(1, matches ? matches.length : 1);
}

export function splitWords(text) {
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
