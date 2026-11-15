/**
 * The two kind vocabularies the truth set is labelled and planted in.
 *
 * A kind names what is wrong, not which judge would see it, so one set of
 * labels and plants scores any arrangement of judges. The game side has five,
 * named by what is wrong in the narration. The blueprint side has one per
 * blueprint dimension, spelled as the dimension's id.
 */

import { z } from "zod";

export const GAME_KINDS = ["spoiler", "fabrication", "clue_handling", "out_of_character", "not_age_fit"] as const;
export type GameKind = (typeof GAME_KINDS)[number];
export const GameKindSchema = z.enum(GAME_KINDS);

export const BLUEPRINT_KINDS = [
  "solve_depth",
  "fairness",
  "timeline_coherence",
  "knowledge_coherence",
  "character_grounding",
  "path_payoff",
  "clue_graph",
  "age_appropriate",
] as const;
export type BlueprintKind = (typeof BLUEPRINT_KINDS)[number];
export const BlueprintKindSchema = z.enum(BLUEPRINT_KINDS);

export type Kind = GameKind | BlueprintKind;

/** Which side of the truth set a subject, a unit or a judge belongs to. */
export const SIDES = ["game", "blueprint"] as const;
export type Side = (typeof SIDES)[number];

export const SEVERITIES = ["minor", "major"] as const;
export type Severity = (typeof SEVERITIES)[number];
export const SeveritySchema = z.enum(SEVERITIES);

/** Whether `kind` belongs to the vocabulary of `side`. */
export function isKindOf(side: Side, kind: string): boolean {
  return side === "game" ? (GAME_KINDS as readonly string[]).includes(kind) : (BLUEPRINT_KINDS as readonly string[]).includes(kind);
}
