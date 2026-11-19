// A character's recorded state in conversation, derived from the session's events.
//
// Each `ask` event records which of the character's gate clues the player used
// that turn (`used_clue_ids`, with the player's words in `used_quote`) and any
// new denial or claim the character made (`new_commitments`). Everything here is
// rebuilt from those events, across every visit, so it only grows: a part once
// earned stays earned, and its reaction stays in the character's story.

import type { ClueRequires } from "./clue-discovery.ts";

/** How many commitments a character keeps; the oldest is dropped first. */
export const COMMITMENT_CAP = 5;

/** Separate visits with questions after which the repeated-asking fallback opens. */
export const FALLBACK_VISITS = 3;

interface StatePart {
  clue_ids: string[];
  reaction: string;
  concedes_steps?: number[];
}

interface StateAgenda {
  type: string;
  yields_to_clue_ids?: string[];
  parts?: StatePart[];
  confession?: string;
  hides_steps?: number[];
}

/** The character fields the state reads. */
export interface StateCharacter {
  id: string;
  stated_alibi: string | null;
  clues: Array<{ id: string; requires?: ClueRequires | null }>;
  agendas?: StateAgenda[];
}

export interface StateHistoryRow {
  sequence?: number;
  event_type: string;
  payload?: Record<string, unknown> | null;
}

/** A self-protect part the player has earned, in the order it was earned. */
export interface EarnedPart {
  agenda_index: number;
  part_index: number;
  reaction: string;
}

export interface CharacterState {
  /** Gate clues the player has used on this character, in first-use order. */
  used_clue_ids: string[];
  earned_parts: EarnedPart[];
  /** The stated alibi, then each earned reaction in the order it was earned. */
  current_story: string[];
  /** The character's own denials and claims, newest last, capped. */
  commitments: string[];
  /** Separate visits in which the player asked this character anything. */
  visits_with_questions: number;
}

function readStrings(payload: Record<string, unknown> | null | undefined, key: string): string[] {
  const value = payload?.[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function payloadCharacter(row: StateHistoryRow): string | null {
  const value = row.payload?.character_id;
  return typeof value === "string" ? value : null;
}

/**
 * The clues a player can use on this character: what earns a self-protect
 * part, what opens a confronted-with-evidence reveal, and the prerequisites of
 * the character's gated clues. Only these are recorded as used.
 */
export function gateClueIds(character: StateCharacter): Set<string> {
  const ids = new Set<string>();
  for (const agenda of character.agendas ?? []) {
    for (const part of agenda.parts ?? []) for (const id of part.clue_ids) ids.add(id);
    if (agenda.type === "conditional_reveal") for (const id of agenda.yields_to_clue_ids ?? []) ids.add(id);
  }
  for (const clue of character.clues) for (const id of clue.requires?.clue_ids ?? []) ids.add(id);
  return ids;
}

function normalizeWords(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Whether the narrator's quote is the player's own words, ignoring case and
 * punctuation. A single word is never a quote that backs a use: saying a word
 * is not using a clue.
 */
export function quoteIsPlayerWords(quote: string | null, playerInput: string): boolean {
  if (!quote) return false;
  const words = normalizeWords(quote);
  return words.split(" ").length >= 2 && ` ${normalizeWords(playerInput)} `.includes(` ${words} `);
}

export type UsedClueDropReason = "not_a_gate_clue" | "not_held_and_no_quote";

export interface UsedClueSelection {
  used_clue_ids: string[];
  used_quote: string | null;
  dropped: Array<{ clue_id: string; reason: UsedClueDropReason }>;
}

/**
 * Narrows the narrator's reported uses to what the engine records: the
 * character's gate clues that the player holds, or, for one they do not hold, a
 * bluff the narrator backs with a quote of the player's own words.
 */
export function selectUsedClues(
  output: { used_clue_ids: string[]; used_quote: string | null },
  character: StateCharacter,
  discovered: ReadonlySet<string>,
  playerInput: string,
): UsedClueSelection {
  const gates = gateClueIds(character);
  const quoted = quoteIsPlayerWords(output.used_quote, playerInput);
  const kept: string[] = [];
  const dropped: UsedClueSelection["dropped"] = [];
  for (const id of new Set(output.used_clue_ids)) {
    if (!gates.has(id)) dropped.push({ clue_id: id, reason: "not_a_gate_clue" });
    else if (discovered.has(id) || quoted) kept.push(id);
    else dropped.push({ clue_id: id, reason: "not_held_and_no_quote" });
  }
  // Only the player's own words are recorded as their quote.
  return { used_clue_ids: kept, used_quote: kept.length > 0 && quoted ? output.used_quote : null, dropped };
}

/**
 * The character's state from the session's events, every visit included. A
 * part is earned once any of its clues is used, and stays earned. `asking_now`
 * counts the visit of a question not yet recorded.
 */
export function buildCharacterState(
  character: StateCharacter,
  history: readonly StateHistoryRow[],
  options: { asking_now?: boolean } = {},
): CharacterState {
  const used: string[] = [];
  const commitments: string[] = [];
  const earned: EarnedPart[] = [];
  const earnedKeys = new Set<string>();
  // Each `talk` event opens a visit; a visit counts once the player asks in it.
  let visit = 0;
  const questionedVisits = new Set<number>();

  const agendas = character.agendas ?? [];
  const earnNewParts = () => {
    const usedSet = new Set(used);
    agendas.forEach((agenda, agendaIndex) => {
      if (agenda.type !== "self_protect") return;
      (agenda.parts ?? []).forEach((part, partIndex) => {
        const key = `${agendaIndex}:${partIndex}`;
        if (earnedKeys.has(key) || !part.clue_ids.some((id) => usedSet.has(id))) return;
        earnedKeys.add(key);
        earned.push({ agenda_index: agendaIndex, part_index: partIndex, reaction: part.reaction });
      });
    });
  };

  for (const row of history) {
    if (payloadCharacter(row) !== character.id) continue;
    if (row.event_type === "talk") visit += 1;
    if (row.event_type !== "ask") continue;
    questionedVisits.add(visit);
    for (const id of readStrings(row.payload, "used_clue_ids")) if (!used.includes(id)) used.push(id);
    for (const commitment of readStrings(row.payload, "new_commitments")) {
      const text = commitment.trim();
      const same = commitments.findIndex((entry) => entry.toLowerCase() === text.toLowerCase());
      if (same >= 0) commitments.splice(same, 1);
      commitments.push(text);
    }
    earnNewParts();
  }
  // The question being answered now counts for the visit it is asked in.
  if (options.asking_now) questionedVisits.add(visit);

  return {
    used_clue_ids: used,
    earned_parts: earned,
    // A reaction two agendas share (one clue in two evidence sets) is told once.
    current_story: [
      ...new Set([...(character.stated_alibi ? [character.stated_alibi] : []), ...earned.map((part) => part.reaction)]),
    ],
    commitments: commitments.slice(-COMMITMENT_CAP),
    visits_with_questions: questionedVisits.size,
  };
}

/** Whether every part of this agenda has been earned, so its confession may be given. */
export function isAgendaFullyEarned(state: CharacterState, agendaIndex: number, partCount: number): boolean {
  if (partCount === 0) return false;
  return state.earned_parts.filter((part) => part.agenda_index === agendaIndex).length === partCount;
}

/**
 * The character's steps that are safe to say: every step no self-protect cover
 * hides, plus those a cover has given up, by an earned part's `concedes_steps`
 * or by the agenda being fully earned (its confession). A step two covers hide
 * is safe once either gives it up. The rest of the truth never reaches the
 * speaker, so it cannot leak what the investigator has not earned.
 */
export function safeSteps<T extends { sequence: number }>(
  character: StateCharacter,
  state: CharacterState,
  actions: readonly T[],
): T[] {
  const hidden = new Set<number>();
  const conceded = new Set<number>();
  (character.agendas ?? []).forEach((agenda, agendaIndex) => {
    if (agenda.type !== "self_protect") return;
    const hides = agenda.hides_steps ?? [];
    for (const step of hides) hidden.add(step);
    if (isAgendaFullyEarned(state, agendaIndex, agenda.parts?.length ?? 0)) {
      for (const step of hides) conceded.add(step);
    }
    for (const earned of state.earned_parts) {
      if (earned.agenda_index !== agendaIndex) continue;
      for (const step of agenda.parts?.[earned.part_index]?.concedes_steps ?? []) conceded.add(step);
    }
  });
  return actions.filter((action) => !hidden.has(action.sequence) || conceded.has(action.sequence));
}
