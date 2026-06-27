/**
 * Age profile — the single source of truth for what "age-appropriate text"
 * means for a child investigator aged 6–11.
 *
 * Two measurable goals drive every value here:
 *   1. Length      — not too long, not too short for the age. Biased SHORT,
 *                    toward engagement and away from walls of text.
 *   2. Complexity  — sentence structure and word difficulty at the level a UK
 *                    child of the target age can comfortably read.
 *
 * Standard anchored on the Flesch–Kincaid grade level (a readability formula —
 * `0.39·(words/sentence) + 11.8·(syllables/word) − 15.59`). Its handy property:
 * the US grade it reports maps to a UK school year as `grade + 1`, and to a
 * reading age as roughly `grade + 5`. So the target grade for a given age is
 * approximately `age − 5`.
 *
 * The "expected at age" framing is informed by the UK National Curriculum
 * English programmes of study (Key Stages 1 and 2), © Crown copyright, reused
 * under the Open Government Licence v3.0. The numeric targets below are our
 * own engineering interpretation, to be calibrated against generated samples —
 * they are NOT reproduced from any third-party scheme.
 */

/** Inclusive numeric range. */
export interface Range {
  min: number;
  max: number;
}

/** Per-age target spec. All values are starting points, to be calibrated. */
export interface AgeProfile {
  /** Target age of the investigator (6–11). */
  age: number;
  /** Approximate UK school year for context, e.g. "Year 3". */
  ukYear: string;
  /** Target Flesch–Kincaid grade band (≈ age − 5). Text above max reads as too complex. */
  fkGradeTarget: Range;
  /** Sentences per narration turn. Biased short. */
  sentencesPerTurn: Range;
  /** Approximate words per narration turn. The hard engagement budget. */
  wordsPerTurn: Range;
  /** Longest single sentence we want at this age, in words. */
  maxSentenceWords: number;
  /**
   * How many unfamiliar / "stretch" words a passage may introduce at this age.
   * Only meaningful when a known-word list is supplied to the scorer; advisory
   * otherwise. Younger ages tolerate fewer new words.
   */
  newWordAllowance: number;
  /** Plain-language vocabulary guidance, safe to drop into a prompt. */
  vocabGuidance: string;
}

export const MIN_TARGET_AGE = 6;
export const MAX_TARGET_AGE = 11;

const PROFILES: Record<number, AgeProfile> = {
  6: {
    age: 6,
    ukYear: "Year 1–2",
    fkGradeTarget: { min: 0.5, max: 1.5 },
    sentencesPerTurn: { min: 1, max: 2 },
    wordsPerTurn: { min: 10, max: 30 },
    maxSentenceWords: 8,
    newWordAllowance: 0,
    vocabGuidance:
      "Use only the most common, everyday words. Almost every word should be one or two syllables. Do not introduce new or unusual words.",
  },
  7: {
    age: 7,
    ukYear: "Year 2–3",
    fkGradeTarget: { min: 1, max: 2 },
    sentencesPerTurn: { min: 1, max: 2 },
    wordsPerTurn: { min: 20, max: 40 },
    maxSentenceWords: 10,
    newWordAllowance: 1,
    vocabGuidance:
      "Use common, everyday words. Introduce at most one less familiar word, and only when its meaning is obvious from the sentence around it.",
  },
  8: {
    age: 8,
    ukYear: "Year 3",
    fkGradeTarget: { min: 2, max: 3 },
    sentencesPerTurn: { min: 2, max: 3 },
    wordsPerTurn: { min: 25, max: 50 },
    maxSentenceWords: 12,
    newWordAllowance: 1,
    vocabGuidance:
      "Use familiar words. You may introduce one new word per passage if the surrounding text makes its meaning clear.",
  },
  9: {
    age: 9,
    ukYear: "Year 4",
    fkGradeTarget: { min: 3, max: 4 },
    sentencesPerTurn: { min: 2, max: 3 },
    wordsPerTurn: { min: 35, max: 55 },
    maxSentenceWords: 14,
    newWordAllowance: 2,
    vocabGuidance:
      "Everyday vocabulary plus one or two richer words, each clear from context. Keep ideas concrete.",
  },
  10: {
    age: 10,
    ukYear: "Year 5",
    fkGradeTarget: { min: 4, max: 5 },
    sentencesPerTurn: { min: 3, max: 4 },
    wordsPerTurn: { min: 40, max: 65 },
    maxSentenceWords: 16,
    newWordAllowance: 3,
    vocabGuidance:
      "A broader vocabulary is fine, including unfamiliar words a reader can work out from context. Stay concrete and clear.",
  },
  11: {
    age: 11,
    ukYear: "Year 6",
    fkGradeTarget: { min: 4.5, max: 6 },
    sentencesPerTurn: { min: 3, max: 4 },
    wordsPerTurn: { min: 45, max: 75 },
    maxSentenceWords: 18,
    newWordAllowance: 4,
    vocabGuidance:
      "Richer language and the occasional figurative turn of phrase are welcome, as long as the meaning stays clear and the writing stays vivid.",
  },
};

/** Clamp an arbitrary number into the supported 6–11 age range. */
export function clampTargetAge(age: number): number {
  if (!Number.isFinite(age)) return MIN_TARGET_AGE;
  const rounded = Math.round(age);
  if (rounded < MIN_TARGET_AGE) return MIN_TARGET_AGE;
  if (rounded > MAX_TARGET_AGE) return MAX_TARGET_AGE;
  return rounded;
}

/** Get the age profile for a target age, clamped to the supported range. */
export function getAgeProfile(age: number): AgeProfile {
  return PROFILES[clampTargetAge(age)];
}

/** All profiles, youngest to oldest. */
export function allAgeProfiles(): AgeProfile[] {
  return Object.values(PROFILES).sort((a, b) => a.age - b.age);
}

/**
 * Render the age profile as a compact, prompt-ready guidance block. Both the
 * blueprint generator and the runtime narrator can inject this so the standard
 * lives in exactly one place. Returns plain text with no third-party content.
 */
export function renderAgeGuidance(age: number): string {
  const p = getAgeProfile(age);
  return [
    `The reader is ${p.age} years old (about UK ${p.ukYear}). Write for that reading level:`,
    `- Length: keep this passage to roughly ${p.wordsPerTurn.min}–${p.wordsPerTurn.max} words across ${p.sentencesPerTurn.min}–${p.sentencesPerTurn.max} sentences. Prefer shorter. Never write a wall of text.`,
    `- Sentences: keep them short and clear. No single sentence should run past about ${p.maxSentenceWords} words.`,
    `- Words: ${p.vocabGuidance}`,
    `- Aim for writing a ${p.age}-year-old can read comfortably and unaided.`,
  ].join("\n");
}
