/**
 * The labelling page's keyboard, as pure functions.
 *
 * The browser loads this file as a module (the server serves it with its types
 * removed), so it imports nothing at run time and uses only syntax that
 * disappears when types do. The page script only reads and writes the form; what
 * each key means is decided here, where the unit tests reach it.
 */

import type { GameKind } from "../lib/truth/kinds.ts";

/** The key that toggles each kind, in the order the page lists them. */
export const KIND_KEYS = {
  "1": "spoiler",
  "2": "fabrication",
  "3": "clue_handling",
  "4": "out_of_character",
  "5": "not_age_fit",
} as const satisfies Record<string, GameKind>;

export type KindKey = keyof typeof KIND_KEYS;

/** The kinds in the order the page lists them. */
export const KEYED_KINDS: readonly GameKind[] = Object.values(KIND_KEYS);

export type KeySeverity = "minor" | "major";

/** The key that sets each severity. */
export const SEVERITY_KEYS = { n: "minor", m: "major" } as const satisfies Record<string, KeySeverity>;

/** What a turn's label is while it is being made: the kinds ticked and one severity for them. */
export interface Selection {
  kinds: readonly GameKind[];
  severity: KeySeverity;
}

export type KeyAction =
  | { type: "toggle-kind"; kind: GameKind }
  | { type: "set-severity"; severity: KeySeverity }
  | { type: "focus-note" }
  | { type: "leave-note" }
  | { type: "save" }
  | { type: "clean" }
  | { type: "previous" };

/** The key that moves into the note field, and the one that saves a turn with no fault. */
export const NOTE_KEY = "t";
export const CLEAN_KEY = "c";
export const PREVIOUS_KEY = "p";

/**
 * What a key press means. `typing` is true while the note field has focus:
 * there only Escape means anything, so letters reach the note. Null means the
 * key is not the page's.
 */
export function actionForKey(key: string, typing: boolean): KeyAction | null {
  if (typing) return key === "Escape" ? { type: "leave-note" } : null;
  if (Object.hasOwn(KIND_KEYS, key)) return { type: "toggle-kind", kind: KIND_KEYS[key as KindKey] };
  if (Object.hasOwn(SEVERITY_KEYS, key)) return { type: "set-severity", severity: SEVERITY_KEYS[key as keyof typeof SEVERITY_KEYS] };
  if (key === NOTE_KEY) return { type: "focus-note" };
  if (key === CLEAN_KEY) return { type: "clean" };
  if (key === PREVIOUS_KEY) return { type: "previous" };
  if (key === "Enter") return { type: "save" };
  return null;
}

/**
 * The selection after an action. Only the actions that change it do; the
 * others (moving, saving) leave it as it was. Clean empties the kinds.
 */
export function applyAction(selection: Selection, action: KeyAction): Selection {
  switch (action.type) {
    case "toggle-kind": {
      const ticked = selection.kinds.includes(action.kind);
      const kinds = KEYED_KINDS.filter((kind) => (kind === action.kind ? !ticked : selection.kinds.includes(kind)));
      return { ...selection, kinds };
    }
    case "set-severity":
      return { ...selection, severity: action.severity };
    case "clean":
      return { ...selection, kinds: [] };
    default:
      return selection;
  }
}
