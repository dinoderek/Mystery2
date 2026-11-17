/**
 * Each game-side judge's own finding categories in plain words, for pass 2 of
 * the labelling page. The categories are the `kind` enums of the judges'
 * answers (`evaluation/judges/gm-*.md`, the age judge's in
 * `evaluation/core/judge-prompt.ts`); `gm_broad` names a truth kind instead.
 */

const TRUTH_KINDS: Readonly<Record<string, string>> = {
  spoiler: "gives away something the player should work out",
  fabrication: "invents or contradicts a blueprint fact",
  clue_handling: "mishandles a clue",
  out_of_character: "a character or the narrator out of character",
  not_age_fit: "hard to read at the target age",
};

const JUDGE_KINDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  gm_roleplay: {
    persona: "speech that does not match the character's personality",
    voice: "a voice that does not fit the character",
    alibi: "the character's alibi or cover not kept",
    agenda: "the character's agenda ignored or overplayed",
    tell: "a tell fired before its trigger, or repeated",
    knowledge: "the character knows what they could not",
    narrator_voice: "the narrator's voice off its standard",
  },
  gm_clue_discipline: {
    unrecorded: "a clue given in the narration but not recorded",
    unsupported: "a clue recorded that the narration does not give",
    distorted: "a clue given wrongly",
    premature: "a clue given before what it requires",
    wrong_source: "a clue given by someone who does not hold it",
    withheld: "an earned clue the character would not give",
  },
  gm_fabrication: {
    person: "a person the blueprint does not have",
    place: "a place the blueprint does not have",
    object: "an object the blueprint does not have",
    event: "a happening the blueprint does not support",
    contradiction: "a claim that contradicts the blueprint",
  },
  gm_spoiler: {
    culprit: "names or points to the culprit",
    motive: "states the motive",
    mechanism: "states how it was done",
    hidden_action: "reveals a hidden action",
    deduction: "does the player's deduction for them",
    confirmation: "confirms the player's guess before it was earned",
  },
  gm_broad: TRUTH_KINDS,
  age_appropriate_turn: {
    vocabulary: "a word too hard for the age",
    sentence_length: "a sentence too long for the age",
    figurative_language: "figurative language too hard for the age",
    clarity: "unclear to a reader of the age",
  },
};

/** A judge's category in plain words, the category itself when it has none, or null when the finding names none. */
export function describeJudgeKind(judge: string, kind: string | null): string | null {
  if (kind === null) return null;
  const words = JUDGE_KINDS[judge]?.[kind];
  return words ? `${kind}: ${words}` : kind;
}
