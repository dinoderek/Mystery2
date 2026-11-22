// A game's reading age: the age its narration is written for.
//
// A case's `metadata.target_age` is only the default. A profile may set an age
// its new games start at, and the game saves the one it started with, so a
// later change never moves a game already under way (`docs/game.md`).

import { z } from "zod";
import { clampTargetAge, MAX_TARGET_AGE, MIN_TARGET_AGE } from "./age-profile.ts";

/** An age the narrator can write for. */
export const ReadingAgeSchema = z.number().int().min(MIN_TARGET_AGE).max(MAX_TARGET_AGE);

/** Every age a profile can choose, youngest first. */
export const READING_AGES: readonly number[] = Array.from(
  { length: MAX_TARGET_AGE - MIN_TARGET_AGE + 1 },
  (_, index) => MIN_TARGET_AGE + index,
);

/**
 * The age a game reads at: the one chosen for it (the profile's at its start,
 * then the one it saved), else its case's own. A case may name an age outside
 * the range (its schema takes any positive one), so that is brought into range
 * as every prompt already reads it.
 */
export function gameReadingAge(caseAge: number, chosen: number | null): number {
  return chosen ?? clampTargetAge(caseAge);
}

/**
 * The case as one game plays it: its `metadata.target_age` becomes the game's
 * reading age. Every narrator prompt reads the age from there, so this is the
 * one place a game's age replaces the case's. Null keeps the case's own: a game
 * saved before games had an age.
 */
export function atReadingAge<T extends { metadata: { target_age: number } }>(
  blueprint: T,
  readingAge: number | null,
): T {
  if (readingAge === null || readingAge === blueprint.metadata.target_age) return blueprint;
  return { ...blueprint, metadata: { ...blueprint.metadata, target_age: readingAge } };
}
