/** Why the game input is being offered focus. */
export type FocusTrigger = 'ready' | 'sent';

/** True where the primary pointer is a finger: a media query, never the user agent. */
export function isCoarsePointer(matchMedia: (query: string) => { matches: boolean }): boolean {
  return matchMedia('(pointer: coarse)').matches;
}

/**
 * Whether the game input takes focus now. A fine pointer keeps today's
 * autofocus. A coarse pointer would raise the on-screen keyboard before the
 * player wants it, so there the input is focused only after a line is sent; a
 * tap on it focuses it natively.
 */
export function shouldFocusInput(coarsePointer: boolean, trigger: FocusTrigger): boolean {
  return !coarsePointer || trigger === 'sent';
}
