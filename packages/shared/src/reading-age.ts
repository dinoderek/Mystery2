// The reading age: the age narration is written for. It is the reader's, kept
// on their profile and read on every request (`docs/game.md`).

import { z } from "zod";
import { MAX_READING_AGE, MIN_READING_AGE } from "./age-profile.ts";

/** An age the narrator can write for. */
export const ReadingAgeSchema = z.number().int().min(MIN_READING_AGE).max(MAX_READING_AGE);

/** Every age a profile can choose, youngest first. */
export const READING_AGES: readonly number[] = Array.from(
  { length: MAX_READING_AGE - MIN_READING_AGE + 1 },
  (_, index) => MIN_READING_AGE + index,
);
