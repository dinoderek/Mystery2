/**
 * The labelling page's keyboard, as pure functions.
 *
 * The browser loads this file as a module (the server serves it with its types
 * removed), so it imports nothing at run time and uses only syntax that
 * disappears when types do. The page script only reads and writes the form; what
 * each key means is decided here, where the unit tests reach it.
 */

import type { GameKind } from "../lib/truth/kinds.ts";

/** The key that sets each kind, in the order the page lists them. */
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

/** One row of the form: a fault being made. Its kind is empty until one is chosen. */
export interface DraftFault {
  kind: GameKind | "";
  severity: KeySeverity;
  note: string;
}

/** A turn's label while it is being made: its rows, and the one the keys act on (-1 when there is none). */
export interface Draft {
  faults: readonly DraftFault[];
  current: number;
}

export type KeyAction =
  | { type: "add-fault" }
  | { type: "remove-fault" }
  | { type: "set-kind"; kind: GameKind }
  | { type: "set-severity"; severity: KeySeverity }
  | { type: "focus-note" }
  | { type: "leave-note" }
  | { type: "save" }
  | { type: "clean" }
  | { type: "previous" }
  | { type: "toggle-truth" }
  | { type: "close" };

export const ADD_KEY = "a";
export const REMOVE_KEY = "x";
export const NOTE_KEY = "t";
export const CLEAN_KEY = "c";
export const PREVIOUS_KEY = "p";
export const TRUTH_KEY = "g";

const PLAIN_KEYS: Record<string, KeyAction> = {
  [ADD_KEY]: { type: "add-fault" },
  [REMOVE_KEY]: { type: "remove-fault" },
  [NOTE_KEY]: { type: "focus-note" },
  [CLEAN_KEY]: { type: "clean" },
  [PREVIOUS_KEY]: { type: "previous" },
  [TRUTH_KEY]: { type: "toggle-truth" },
  Enter: { type: "save" },
  Escape: { type: "close" },
};

/**
 * What a key press means. `typing` is true while a note field has focus:
 * there only Escape means anything, so letters reach the note. Null means the
 * key is not the page's.
 */
export function actionForKey(key: string, typing: boolean): KeyAction | null {
  if (typing) return key === "Escape" ? { type: "leave-note" } : null;
  if (Object.hasOwn(KIND_KEYS, key)) return { type: "set-kind", kind: KIND_KEYS[key as KindKey] };
  if (Object.hasOwn(SEVERITY_KEYS, key)) return { type: "set-severity", severity: SEVERITY_KEYS[key as keyof typeof SEVERITY_KEYS] };
  return Object.hasOwn(PLAIN_KEYS, key) ? PLAIN_KEYS[key] : null;
}

/** The draft with a new empty row at the end, which becomes the current one. */
function added(draft: Draft): Draft {
  const fresh: DraftFault = { kind: "", severity: "minor", note: "" };
  return { faults: [...draft.faults, fresh], current: draft.faults.length };
}

function hasCurrent(draft: Draft): boolean {
  return draft.current >= 0 && draft.current < draft.faults.length;
}

/** The draft with a row to act on: the current one, else a new one. */
function withCurrent(draft: Draft): Draft {
  return hasCurrent(draft) ? draft : added(draft);
}

function changeCurrent(draft: Draft, change: Partial<DraftFault>): Draft {
  const ready = withCurrent(draft);
  return { ...ready, faults: ready.faults.map((fault, index) => (index === ready.current ? { ...fault, ...change } : fault)) };
}

/**
 * The draft after an action. A kind or a severity goes to the current row, and
 * the note key types into it, made first when there is none; adding makes the
 * new row current; removing takes the current row away; clean empties the
 * draft. The others (moving, saving, menus) leave it as it was.
 */
export function applyAction(draft: Draft, action: KeyAction): Draft {
  switch (action.type) {
    case "add-fault":
      return added(draft);
    case "set-kind":
      return changeCurrent(draft, { kind: action.kind });
    case "set-severity":
      return changeCurrent(draft, { severity: action.severity });
    case "focus-note":
      return withCurrent(draft);
    case "remove-fault": {
      if (!hasCurrent(draft)) return draft;
      const faults = draft.faults.filter((_, index) => index !== draft.current);
      return { faults, current: Math.min(draft.current, faults.length - 1) };
    }
    case "clean":
      return { faults: [], current: -1 };
    default:
      return draft;
  }
}
