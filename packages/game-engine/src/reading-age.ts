// The age a request's narration is written for: the playing profile's, read
// on every request, so a change of age between two turns reaches the next one
// (`docs/game.md`). Every narrator prompt takes it as its own input; nothing
// reads it from the case.

import { clampTargetAge } from "../../shared/src/age-profile.ts";
import type { PlayableCase } from "../../shared/src/playable-case.ts";
import type { ProfileStore } from "./context.ts";

/** The profile's reading age, else (for now) its case's. */
export async function requestReadingAge(profile: ProfileStore, played: PlayableCase): Promise<number> {
  return (await profile.getReadingAge()) ?? caseAgeFallback(played);
}

/**
 * Transitional: a profile with no age reads at its case's
 * `metadata.target_age`, brought into range (a case may name any positive
 * age). The only runtime reader of the case's age; it goes once every profile
 * has an age.
 */
function caseAgeFallback(played: PlayableCase): number {
  return clampTargetAge(played.metadata.target_age);
}
