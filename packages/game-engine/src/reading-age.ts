// The age a request's narration is written for: the playing profile's, read
// on every request, so a change of age between two turns reaches the next one
// (`docs/game.md`). Every narrator prompt takes it as its own input; nothing
// reads it from the case.

import { READING_AGE_REQUIRED } from "../../shared/src/mystery-api-contracts.ts";
import type { ProfileStore } from "./context.ts";
import { RequestRejectedError } from "./errors.ts";

/**
 * The profile's reading age. A profile without one (a local database from
 * before the age was required) is refused with `READING_AGE_REQUIRED`, which
 * the browser answers with the age picker; nothing is narrated or saved.
 */
export async function requestReadingAge(profile: ProfileStore): Promise<number> {
  const age = await profile.getReadingAge();
  if (age === null) {
    throw new RequestRejectedError(
      400,
      "Choose a reading age before playing",
      "reading_age_missing",
      READING_AGE_REQUIRED,
    );
  }
  return age;
}
