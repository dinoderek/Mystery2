/**
 * Age-appropriate text — the single source of truth for ages 6–11.
 *
 * The model has TWO independent dials:
 *
 *   1. COMPLEXITY (depends on age only) — how hard the words and sentences are.
 *      Anchored on the Flesch–Kincaid grade formula
 *      (`0.39·(words/sentence) + 11.8·(syllables/word) − 15.59`), whose US grade
 *      maps to a UK year as `grade + 1` and a reading age as ~`grade + 5`, so the
 *      target grade for an age is about `age − 5`. Plus soft sentence-length and
 *      vocabulary guidance. This does NOT change with the kind of interaction.
 *
 *   2. LENGTH (depends on interaction × age) — how much text to write. Each
 *      interaction has ONE target/soft-max in words, calibrated for a fluent
 *      reader. There is NO minimum. For younger readers — who lose interest in
 *      long passages — the target is trimmed DOWN by a per-age brevity bias
 *      (never padded up for older readers). All length values are GUIDANCE: the
 *      narrator may exceed the soft-max when the character or content genuinely
 *      needs it.
 *
 * The "expected at age" framing is informed by the UK National Curriculum
 * English programmes of study (KS1/KS2), © Crown copyright, reused under the
 * Open Government Licence v3.0. The numbers below are our own engineering
 * interpretation to calibrate against samples — not reproduced third-party data.
 */

/** Inclusive numeric guidance band. */
export interface GuidanceBand {
  /** What to aim for. */
  target: number;
  /** Soft ceiling — exceed only when the content/character demands it. */
  softMax: number;
}

/** Complexity + brevity profile for a single age. */
export interface AgeProfile {
  /** Target age of the investigator (6–11). */
  age: number;
  /** Approximate UK school year for context, e.g. "Year 3". */
  ukYear: string;
  /** Target Flesch–Kincaid grade band (≈ age − 5). Above softMax reads as too hard. */
  fkGrade: GuidanceBand;
  /** Soft guidance for the longest sentence, in words. Not a hard cap. */
  softSentenceWords: number;
  /**
   * How many unfamiliar / "stretch" words a passage may introduce at this age.
   * Exact only when a known-word list is supplied to the scorer; advisory
   * otherwise. Younger ages tolerate fewer new words.
   */
  newWordAllowance: number;
  /** Plain-language vocabulary guidance, safe to drop into a prompt. */
  vocabGuidance: string;
  /**
   * One-way brevity bias in [0, 1] applied to interaction length targets.
   * 1.0 = use the interaction's full length; below 1.0 trims it for younger
   * readers. Plateaus at 1.0 for older ages — we never lengthen for age.
   */
  brevityBias: number;
}

export const MIN_TARGET_AGE = 6;
export const MAX_TARGET_AGE = 11;

const PROFILES: Record<number, AgeProfile> = {
  6: {
    age: 6,
    ukYear: "Year 1–2",
    fkGrade: { target: 1, softMax: 1.5 },
    softSentenceWords: 8,
    newWordAllowance: 0,
    vocabGuidance:
      "Use only the most common, everyday words. Almost every word should be one or two syllables. Do not introduce new or unusual words.",
    brevityBias: 0.55,
  },
  7: {
    age: 7,
    ukYear: "Year 2–3",
    fkGrade: { target: 1.5, softMax: 2 },
    softSentenceWords: 10,
    newWordAllowance: 1,
    vocabGuidance:
      "Use common, everyday words. Introduce at most one less familiar word, and only when its meaning is obvious from the sentence around it.",
    brevityBias: 0.7,
  },
  8: {
    age: 8,
    ukYear: "Year 3",
    fkGrade: { target: 2.5, softMax: 3 },
    softSentenceWords: 12,
    newWordAllowance: 1,
    vocabGuidance:
      "Use familiar words. You may introduce one new word per passage if the surrounding text makes its meaning clear.",
    brevityBias: 0.85,
  },
  9: {
    age: 9,
    ukYear: "Year 4",
    fkGrade: { target: 3.5, softMax: 4 },
    softSentenceWords: 14,
    newWordAllowance: 2,
    vocabGuidance:
      "Everyday vocabulary plus one or two richer words, each clear from context. Keep ideas concrete.",
    brevityBias: 0.95,
  },
  10: {
    age: 10,
    ukYear: "Year 5",
    fkGrade: { target: 4.5, softMax: 5 },
    softSentenceWords: 16,
    newWordAllowance: 3,
    vocabGuidance:
      "A broader vocabulary is fine, including unfamiliar words a reader can work out from context. Stay concrete and clear.",
    brevityBias: 1.0,
  },
  11: {
    age: 11,
    ukYear: "Year 6",
    fkGrade: { target: 5, softMax: 6 },
    softSentenceWords: 18,
    newWordAllowance: 4,
    vocabGuidance:
      "Richer language and the occasional figurative turn of phrase are welcome, as long as the meaning stays clear and the writing stays vivid.",
    brevityBias: 1.0,
  },
};

/**
 * The kinds of player-facing interaction, one per runtime narrator role. Each
 * has its own natural length. Length values are calibrated for a fluent reader
 * (no brevity bias) and trimmed per age by `effectiveLength`.
 */
export type InteractionId =
  | "intro" // game-start: opening narration
  | "ambience" // game-move: arriving at / describing a place
  | "search_empty" // game-search (bare): a dead-end search
  | "search_find" // game-search (targeted): a clue reveal
  | "talk_greeting" // game-talk: begin a conversation
  | "talk_round" // game-ask: an interrogation round
  | "talk_farewell" // game-end-talk: end a conversation
  | "accusation_open" // game-accuse: raise the stakes
  | "accusation_verdict"; // game-accuse: the final payoff

export interface Interaction {
  id: InteractionId;
  label: string;
  /** The runtime role / prompt this maps to. */
  role: string;
  /** Natural length for a fluent reader, in words. No minimum. */
  length: GuidanceBand;
}

const INTERACTIONS: Record<InteractionId, Interaction> = {
  intro: {
    id: "intro",
    label: "Opening narration",
    role: "buildGameStartPrompt",
    length: { target: 45, softMax: 70 },
  },
  ambience: {
    id: "ambience",
    label: "Ambience / movement",
    role: "buildGameMovePrompt",
    length: { target: 30, softMax: 50 },
  },
  search_empty: {
    id: "search_empty",
    label: "Search — nothing found",
    role: "search_bare",
    length: { target: 20, softMax: 35 },
  },
  search_find: {
    id: "search_find",
    label: "Search — clue found",
    role: "search_targeted",
    length: { target: 30, softMax: 50 },
  },
  talk_greeting: {
    id: "talk_greeting",
    label: "Conversation — greeting",
    role: "talk_start",
    length: { target: 15, softMax: 30 },
  },
  talk_round: {
    id: "talk_round",
    label: "Conversation — interrogation round",
    role: "talk_conversation",
    length: { target: 35, softMax: 60 },
  },
  talk_farewell: {
    id: "talk_farewell",
    label: "Conversation — farewell",
    role: "talk_end",
    length: { target: 12, softMax: 25 },
  },
  accusation_open: {
    id: "accusation_open",
    label: "Accusation — opening",
    role: "accusation_start",
    length: { target: 30, softMax: 50 },
  },
  accusation_verdict: {
    id: "accusation_verdict",
    label: "Accusation — verdict / payoff",
    role: "accusation_judge",
    length: { target: 50, softMax: 80 },
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

/** Look up an interaction definition. */
export function getInteraction(id: InteractionId): Interaction {
  return INTERACTIONS[id];
}

/** All interactions. */
export function allInteractions(): Interaction[] {
  return Object.values(INTERACTIONS);
}

/**
 * The length guidance for an interaction at a given age: the interaction's
 * natural length trimmed by the age's one-way brevity bias. Never longer than
 * the interaction's base length.
 */
export function effectiveLength(
  id: InteractionId,
  age: number,
): GuidanceBand {
  const base = INTERACTIONS[id].length;
  const bias = getAgeProfile(age).brevityBias;
  return {
    target: Math.round(base.target * bias),
    softMax: Math.round(base.softMax * bias),
  };
}

/**
 * Age-only complexity guidance, prompt-ready. Same for every interaction.
 * Plain text, no third-party content.
 */
export function renderComplexityGuidance(age: number): string {
  const p = getAgeProfile(age);
  return [
    `The reader is ${p.age} years old (about UK ${p.ukYear}). Match this reading level:`,
    `- Sentences: keep them short and clear. Aim to keep most sentences under about ${p.softSentenceWords} words.`,
    `- Words: ${p.vocabGuidance}`,
    `- The writing should be comfortable for a ${p.age}-year-old to read unaided.`,
  ].join("\n");
}

/**
 * Length guidance for a specific interaction at an age. Framed as soft guidance
 * biased short — never a hard cap.
 */
export function renderLengthGuidance(id: InteractionId, age: number): string {
  const len = effectiveLength(id, age);
  return [
    `Length (guidance, not a hard limit): aim for around ${len.target} words; try to stay under about ${len.softMax}.`,
    `Prefer shorter. Cut anything that does not earn its place — never write a wall of text. Go longer only if the character or the moment truly needs it.`,
  ].join("\n");
}

/** Combined complexity + length guidance for an interaction at an age. */
export function renderGuidance(id: InteractionId, age: number): string {
  return `${renderComplexityGuidance(age)}\n${renderLengthGuidance(id, age)}`;
}
