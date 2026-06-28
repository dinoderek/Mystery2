/**
 * Age-appropriate text — the single source of truth for ages 6–11.
 *
 * The model has TWO independent dials:
 *
 *   1. COMPLEXITY (depends on age only) — how hard the words and sentences are:
 *      soft sentence-length guidance, vocabulary guidance, and how many
 *      unfamiliar words a passage may introduce. This does NOT change with the
 *      kind of interaction.
 *
 *   2. LENGTH (depends on interaction × age) — how many words to write. Each
 *      (interaction, age) pair has ONE explicit target word budget (see
 *      WORD_BUDGET). There is NO minimum and the budget is GUIDANCE: the
 *      narrator may go a little over when the character or moment needs it.
 *      Budgets are listed explicitly per age rather than derived from a
 *      multiplier, so the actual target at each age is legible at a glance.
 *
 * The per-age levels are informed by UK National Curriculum English (KS1/KS2),
 * © Crown copyright, reused under the Open Government Licence v3.0, and by the
 * usual reading-age framing (a Flesch–Kincaid grade of about `age − 5`). Those
 * are the basis for the targets below; the numbers are our own engineering
 * interpretation to calibrate against samples, not reproduced third-party data.
 */

/** Complexity profile for a single age. */
export interface AgeProfile {
  /** Target age of the investigator (6–11). */
  age: number;
  /** Approximate UK school year for context, e.g. "Year 3". */
  ukYear: string;
  /** Soft guidance for the longest sentence, in words. Not a hard cap. */
  softSentenceWords: number;
  /**
   * How many unfamiliar / "stretch" words a passage may introduce at this age.
   * Younger ages tolerate fewer new words.
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
    softSentenceWords: 8,
    newWordAllowance: 0,
    vocabGuidance:
      "Use only the most common, everyday words. Almost every word should be one or two syllables.",
  },
  7: {
    age: 7,
    ukYear: "Year 2–3",
    softSentenceWords: 10,
    newWordAllowance: 1,
    vocabGuidance: "Use common, everyday words.",
  },
  8: {
    age: 8,
    ukYear: "Year 3",
    softSentenceWords: 12,
    newWordAllowance: 1,
    vocabGuidance: "Use familiar words.",
  },
  9: {
    age: 9,
    ukYear: "Year 4",
    softSentenceWords: 14,
    newWordAllowance: 2,
    vocabGuidance: "Everyday vocabulary, kept concrete.",
  },
  10: {
    age: 10,
    ukYear: "Year 5",
    softSentenceWords: 16,
    newWordAllowance: 3,
    vocabGuidance:
      "A broader vocabulary is fine, including unfamiliar words a reader can work out from context.",
  },
  11: {
    age: 11,
    ukYear: "Year 6",
    softSentenceWords: 18,
    newWordAllowance: 4,
    vocabGuidance:
      "Richer language and the occasional figurative turn of phrase are welcome, as long as the meaning stays clear and vivid.",
  },
};

/**
 * The kinds of player-facing interaction, one per runtime narrator role.
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
}

const INTERACTIONS: Record<InteractionId, Interaction> = {
  intro: { id: "intro", label: "Opening narration", role: "buildGameStartPrompt" },
  ambience: { id: "ambience", label: "Ambience / movement", role: "buildGameMovePrompt" },
  search_empty: { id: "search_empty", label: "Search — nothing found", role: "search_bare" },
  search_find: { id: "search_find", label: "Search — clue found", role: "search_targeted" },
  talk_greeting: { id: "talk_greeting", label: "Conversation — greeting", role: "talk_start" },
  talk_round: { id: "talk_round", label: "Conversation — interrogation round", role: "talk_conversation" },
  talk_farewell: { id: "talk_farewell", label: "Conversation — farewell", role: "talk_end" },
  accusation_open: { id: "accusation_open", label: "Accusation — opening", role: "accusation_start" },
  accusation_verdict: { id: "accusation_verdict", label: "Accusation — verdict / payoff", role: "accusation_judge" },
};

/**
 * Explicit target word budget per (interaction, age). Read directly — no
 * multiplier. Budgets rise with age and with how much the moment needs to say;
 * the verdict (the payoff) is the most generous, the farewell the leanest.
 * All values are soft targets, biased short, with no minimum.
 */
const WORD_BUDGET: Record<InteractionId, Record<number, number>> = {
  //                     age:  6    7    8    9   10   11
  intro: { 6: 25, 7: 30, 8: 35, 9: 40, 10: 45, 11: 50 },
  ambience: { 6: 15, 7: 18, 8: 22, 9: 26, 10: 30, 11: 35 },
  search_empty: { 6: 10, 7: 12, 8: 15, 9: 18, 10: 20, 11: 25 },
  search_find: { 6: 15, 7: 20, 8: 25, 9: 30, 10: 35, 11: 40 },
  talk_greeting: { 6: 10, 7: 12, 8: 14, 9: 16, 10: 18, 11: 20 },
  talk_round: { 6: 20, 7: 25, 8: 30, 9: 35, 10: 40, 11: 45 },
  talk_farewell: { 6: 8, 7: 10, 8: 12, 9: 14, 10: 16, 11: 18 },
  accusation_open: { 6: 18, 7: 22, 8: 26, 9: 30, 10: 35, 11: 40 },
  accusation_verdict: { 6: 30, 7: 35, 8: 40, 9: 45, 10: 50, 11: 60 },
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

/** The explicit target word budget for an interaction at a given age. */
export function wordBudget(id: InteractionId, age: number): number {
  return WORD_BUDGET[id][clampTargetAge(age)];
}

/**
 * Age-only complexity guidance, prompt-ready. Same for every interaction.
 * Plain text, no third-party content.
 */
export function renderComplexityGuidance(age: number): string {
  const p = getAgeProfile(age);
  const newWords =
    p.newWordAllowance === 0
      ? `Do not introduce any words a ${p.age}-year-old would not already know.`
      : `Introduce at most ${p.newWordAllowance} word${p.newWordAllowance > 1 ? "s" : ""} a ${p.age}-year-old would not already know, and only when the meaning is clear from the surrounding text.`;
  return [
    `The reader is ${p.age} years old (about UK ${p.ukYear}). Match this reading level:`,
    `- Sentences: keep them short and clear. Most sentences should stay under about ${p.softSentenceWords} words.`,
    `- Words: ${p.vocabGuidance}`,
    `- New words: ${newWords}`,
    `- The writing should be comfortable for a ${p.age}-year-old to read unaided.`,
  ].join("\n");
}

/**
 * Length guidance for a specific interaction at an age: one explicit word
 * budget, framed as soft guidance biased short — never a hard cap.
 */
export function renderLengthGuidance(id: InteractionId, age: number): string {
  const target = wordBudget(id, age);
  return [
    `Length (guidance, not a hard limit): aim for about ${target} words. Prefer shorter; never write a wall of text.`,
    `Go a little over only if the character or the moment truly needs it.`,
  ].join("\n");
}

/** Combined complexity + length guidance for an interaction at an age. */
export function renderGuidance(id: InteractionId, age: number): string {
  return `${renderComplexityGuidance(age)}\n${renderLengthGuidance(id, age)}`;
}

/**
 * Generation-time guidance for the blueprint generator: the age's complexity
 * rules plus a reminder to keep authored player-facing text brief. Generation
 * produces many fields rather than one interaction, so this uses complexity
 * (age-only) plus a general brevity note rather than a single length budget.
 */
export function renderGenerationGuidance(age: number): string {
  const p = getAgeProfile(age);
  return [
    "## Age-appropriate writing",
    renderComplexityGuidance(age),
    `Keep every player-facing string (title, one-liner, premise, location descriptions, clue text) short — a sentence or two each. Bias toward brevity to hold a ${p.age}-year-old's attention; never write a wall of text.`,
  ].join("\n");
}
