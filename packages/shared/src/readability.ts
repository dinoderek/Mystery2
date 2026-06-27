/**
 * Deterministic readability scorer for age-appropriate text.
 *
 * Built entirely on the Flesch–Kincaid family of formulas (sentence length and
 * syllables per word) — mathematical readability formulas, with no third-party
 * text, word list, or copyrightable material embedded here.
 *
 *   Flesch–Kincaid grade = 0.39·(words/sentence) + 11.8·(syllables/word) − 15.59
 *   Flesch reading ease  = 206.835 − 1.015·(words/sentence) − 84.6·(syllables/word)
 *
 * Two dials, matching `age-profile.ts`:
 *   - COMPLEXITY (age): the Flesch–Kincaid grade band is the firm signal —
 *     above the age's soft-max grade is a `fail` (genuinely too hard to read).
 *     Sentence-length and vocabulary are advisory `warn`s.
 *   - LENGTH (interaction × age): advisory only. Over the interaction's soft-max
 *     is a `warn`, never a fail — length is guidance the narrator may exceed.
 *
 * The vocabulary axis is pluggable: callers may pass a Set of "known" words
 * (from their own external data file). Nothing is bundled.
 */

import {
  effectiveLength,
  getAgeProfile,
  type AgeProfile,
  type InteractionId,
} from "./age-profile.ts";

/** Raw, age-independent measurements of a piece of text. */
export interface ReadabilityMetrics {
  words: number;
  sentences: number;
  syllables: number;
  avgSentenceWords: number;
  maxSentenceWords: number;
  avgSyllablesPerWord: number;
  /** Flesch–Kincaid US grade level. ~age − 5 for our purposes. */
  fleschKincaidGrade: number;
  /** Flesch reading ease (0–100+, higher is easier). */
  fleschReadingEase: number;
  /** The longest sentence, for surfacing the worst offender. */
  longestSentence: string;
}

/** A single flagged expectation, with a human-readable explanation. */
export interface AgeFlag {
  axis: "length" | "sentence_length" | "complexity" | "vocabulary";
  severity: "warn" | "fail";
  message: string;
}

/** Result of scoring text against a specific target age (and optional interaction). */
export interface AgeScore {
  age: number;
  profile: AgeProfile;
  interaction: InteractionId | null;
  metrics: ReadabilityMetrics;
  /** Words not found in the supplied known-word set (or heuristic stretch words). */
  stretchWords: string[];
  flags: AgeFlag[];
  /** True when no `fail`-severity flag was raised. */
  withinTarget: boolean;
}

export interface ScoreOptions {
  /**
   * Which interaction the text is for. Determines the (advisory) length budget.
   * Omit to skip the length check entirely (e.g. when length is not meaningful).
   */
  interaction?: InteractionId;
  /**
   * Optional set of lower-cased "known" words for the target age, supplied by
   * the caller from their own data file. When present, vocabulary grading is
   * exact; when absent, a syllable-based heuristic is used and flagged as a warn.
   */
  knownWords?: ReadonlySet<string>;
}

const WORD_RE = /[A-Za-z]+(?:'[A-Za-z]+)?/g;

/** Split text into sentences on terminal punctuation; keep only ones with words. */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => /[A-Za-z]/.test(s));
}

function words(text: string): string[] {
  return text.match(WORD_RE) ?? [];
}

/**
 * Estimate the syllable count of a single word using the standard vowel-group
 * heuristic. Approximate by design — good enough for aggregate readability.
 */
export function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length === 0) return 0;
  if (w.length <= 3) return 1;
  const trimmed = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "");
  const groups = trimmed.match(/[aeiouy]{1,2}/g);
  return groups ? groups.length : 1;
}

/** Compute age-independent readability metrics for a passage. */
export function measure(text: string): ReadabilityMetrics {
  const sentences = splitSentences(text);
  const allWords = words(text);
  const wordCount = allWords.length;
  const sentenceCount = Math.max(sentences.length, 1);
  const syllables = allWords.reduce((sum, w) => sum + countSyllables(w), 0);

  let maxSentenceWords = 0;
  let longestSentence = "";
  for (const s of sentences) {
    const n = words(s).length;
    if (n > maxSentenceWords) {
      maxSentenceWords = n;
      longestSentence = s;
    }
  }

  const wordsPerSentence = wordCount / sentenceCount;
  const syllablesPerWord = wordCount > 0 ? syllables / wordCount : 0;

  const fleschKincaidGrade =
    wordCount === 0
      ? 0
      : 0.39 * wordsPerSentence + 11.8 * syllablesPerWord - 15.59;
  const fleschReadingEase =
    wordCount === 0
      ? 100
      : 206.835 - 1.015 * wordsPerSentence - 84.6 * syllablesPerWord;

  return {
    words: wordCount,
    sentences: sentences.length,
    syllables,
    avgSentenceWords: round2(wordsPerSentence),
    maxSentenceWords,
    avgSyllablesPerWord: round2(syllablesPerWord),
    fleschKincaidGrade: round2(fleschKincaidGrade),
    fleschReadingEase: round2(fleschReadingEase),
    longestSentence,
  };
}

/** Score a passage against the profile for a given target age. */
export function scoreForAge(
  text: string,
  age: number,
  options: ScoreOptions = {},
): AgeScore {
  const profile = getAgeProfile(age);
  const metrics = measure(text);
  const flags: AgeFlag[] = [];

  // --- Length (advisory; interaction-aware; biased short, no minimum) ---
  if (options.interaction && metrics.words > 0) {
    const budget = effectiveLength(options.interaction, age);
    if (metrics.words > budget.softMax) {
      flags.push({
        axis: "length",
        severity: "warn",
        message: `Longer than usual for this moment: ${metrics.words} words (aim ~${budget.target}, soft cap ~${budget.softMax}). Trim unless it earns its length.`,
      });
    }
  }

  // --- Sentence length (advisory guidance) ---
  if (metrics.maxSentenceWords > profile.softSentenceWords) {
    flags.push({
      axis: "sentence_length",
      severity: "warn",
      message: `Longest sentence is ${metrics.maxSentenceWords} words (aim under ~${profile.softSentenceWords}). Consider breaking it up: "${metrics.longestSentence}"`,
    });
  }

  // --- Complexity (the firm signal: FK grade above the band is too hard) ---
  if (metrics.fleschKincaidGrade > profile.fkGrade.softMax) {
    flags.push({
      axis: "complexity",
      severity: "fail",
      message: `Reading level grade ${metrics.fleschKincaidGrade} is above the target (up to ${profile.fkGrade.softMax}) for age ${profile.age}. Use shorter sentences and simpler words.`,
    });
  }

  // --- Vocabulary (exact when a known-word set is supplied, else advisory) ---
  const stretchWords = findStretchWords(text, options.knownWords);
  if (stretchWords.length > profile.newWordAllowance) {
    flags.push({
      axis: "vocabulary",
      severity: options.knownWords ? "fail" : "warn",
      message: `${stretchWords.length} less-common word(s) — allowance is ${profile.newWordAllowance} at age ${profile.age}: ${stretchWords.slice(0, 8).join(", ")}${options.knownWords ? "" : " (heuristic — supply a known-word list for exact grading)"}.`,
    });
  }

  return {
    age: profile.age,
    profile,
    interaction: options.interaction ?? null,
    metrics,
    stretchWords,
    flags,
    withinTarget: !flags.some((f) => f.severity === "fail"),
  };
}

/**
 * Identify "stretch" words. With a known-word set, these are simply the words
 * absent from it. Without one, fall back to a syllable heuristic: words of
 * three or more syllables, which correlate with difficulty.
 */
function findStretchWords(
  text: string,
  knownWords?: ReadonlySet<string>,
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words(text)) {
    const lower = w.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const isStretch = knownWords
      ? !knownWords.has(lower)
      : countSyllables(lower) >= 3;
    if (isStretch) result.push(lower);
  }
  return result;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
