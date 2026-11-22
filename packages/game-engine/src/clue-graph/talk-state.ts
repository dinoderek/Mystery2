// What the narrator is given to play a clue-graph character for one line:
// derived from the graph and the play, never authored.

import type {
  ClueGraphCase,
  ClueGraphGate,
  Stance,
} from "../../../shared/src/clue-graph-schema.ts";
import {
  askable,
  availableGates,
  cluesOf,
  gateOf,
  holds,
  lineOf,
  nextFirstWords,
  ridersOf,
  subjectTells,
  type ClueGraphPlay,
} from "./play.ts";

/** A tell that comes out with a statement: its ID, for the notebook, and what is seen. */
export interface Rider {
  id: string;
  does: string;
  names_spot?: NamedSpot;
}

/** The hidden spot a pointer clue shows: the narrator names it when it words the clue. */
export interface NamedSpot {
  spot: string;
  location: string;
}

/** What opens an available gate. */
export interface GateOpener {
  /** Clues the player can show: `any` one of them, or `all`. */
  show?: {
    match: "any" | "all";
    clues: Array<{ id: string; text: string; held: boolean }>;
  };
  /** The line of questioning, in words. */
  line?: string;
  /** A gate with only `after`: it opens when asked plainly what happened. */
  asked_plainly?: true;
}

export interface TalkGate {
  id: string;
  opens_with: GateOpener;
  /** A believable bluff opens it, even without the clues held. */
  bluffable: boolean;
  says: string;
  names_spot?: NamedSpot;
  /** Tells shown with it. */
  with: Rider[];
  /** Earlier statements it takes back. */
  takes_back: string[];
}

export interface ClueGraphTalkState {
  character: string;
  stance: Stance;
  demeanor: string;
  /** First words not yet said: this line's share. */
  says_first: Array<{ id: string; says: string; names_spot?: NamedSpot; with: Rider[] }>;
  answers_if_asked: Array<{ id: string; about: string; says: string; names_spot?: NamedSpot; with: Rider[] }>;
  gates: TalkGate[];
  /** Tells shown when a subject comes up. */
  shows_when: Array<{ id: string; subject: string; does: string; names_spot?: NamedSpot }>;
  /** The character's statements so far, in the order said, as their notebook lines read. */
  story_so_far: Array<{ says: string; taken_back: boolean }>;
  /** What the character's tells have already shown. */
  established: string[];
  /** Standing statements a gate not yet open would take back: hold to them. */
  keeps_back: string[];
}

/** A missing demeanor line falls back from the stance towards `open`, then wraps around. */
const STANCE_FALLBACK: Stance[] = ["cleared", "cornered", "shaken", "guarded", "open"];

/**
 * Open with no lies; cleared once every lie is taken back; cornered when only
 * a plain question stands between them and the truth; shaken once one lie is
 * taken back; guarded otherwise. A lie counts once said, or when it is one of
 * their first words.
 */
export function stanceOf(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): Stance {
  const lies = cluesOf(graph, character).filter((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "statement" &&
      !clue.truth &&
      (play.held.includes(id) || clue.reached.by === "first_meeting")
    );
  });
  const standing = lies.filter((id) => !play.retracted.includes(id));
  const lastStep = availableGates(graph, play, character).some((gate) => {
    const found = gateOf(graph.clues[gate.id])!;
    return !found.use && !found.line;
  });
  if (lies.length === 0) return "open";
  if (standing.length === 0) return "cleared";
  if (lastStep) return "cornered";
  if (standing.length < lies.length) return "shaken";
  return "guarded";
}

function demeanorFor(graph: ClueGraphCase, character: string, stance: Stance): string {
  const lines = graph.characters[character].demeanor;
  const from = STANCE_FALLBACK.indexOf(stance);
  const order = [...STANCE_FALLBACK.slice(from), ...STANCE_FALLBACK];
  // The schema requires at least one line, so the fallback always finds one.
  const found = order.find((entry) => lines[entry] !== undefined)!;
  return lines[found]!;
}

/**
 * How the narrator is handed a clue: a held one as its saved notebook line, so
 * wording does not drift; one not yet out as its fact, to word.
 */
function text(graph: ClueGraphCase, play: ClueGraphPlay, id: string): string {
  return lineOf(graph, play, id);
}

/** The hidden spot a clue points at, when it is a spot's `revealed_by`. */
export function namedSpotOf(graph: ClueGraphCase, id: string): NamedSpot | undefined {
  for (const place of Object.values(graph.locations)) {
    const spot = place.spots.find((entry) => entry.revealed_by === id);
    if (spot) return { spot: spot.name, location: place.name };
  }
  return undefined;
}

/** A pointer's spot, as an entry's optional field. */
function spotField(graph: ClueGraphCase, id: string): { names_spot?: NamedSpot } {
  const named = namedSpotOf(graph, id);
  return named ? { names_spot: named } : {};
}

/** The tells that come out with a statement. */
function riders(graph: ClueGraphCase, play: ClueGraphPlay, id: string): Rider[] {
  return ridersOf(graph, id).map((rider) => ({ id: rider, does: text(graph, play, rider), ...spotField(graph, rider) }));
}

function openerOf(graph: ClueGraphCase, play: ClueGraphPlay, gate: ClueGraphGate): GateOpener {
  const held = holds(play);
  const opener: GateOpener = {};
  if (gate.use) {
    const match = "any" in gate.use ? "any" : "all";
    const ids = "any" in gate.use ? gate.use.any : gate.use.all;
    opener.show = {
      match,
      clues: ids.map((id) => ({ id, text: text(graph, play, id), held: held(id) })),
    };
  }
  if (gate.line) opener.line = gate.line.text;
  if (!gate.use && !gate.line) opener.asked_plainly = true;
  return opener;
}

function takesBack(graph: ClueGraphCase, id: string): string[] {
  const clue = graph.clues[id];
  return clue.kind === "statement" ? (clue.takes_back ?? []) : [];
}

/**
 * The statements a withheld gate would take back that the character has said,
 * or says this line, and still stands by. Only first words and answers count:
 * never the text of a gated clue.
 */
function keepsBack(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
  available: Set<string>,
): string[] {
  const saying = new Set([...play.held, ...nextFirstWords(graph, play, character)]);
  const out = new Set<string>();
  for (const id of cluesOf(graph, character)) {
    if (!gateOf(graph.clues[id]) || available.has(id)) continue;
    if (play.held.includes(id) || play.retracted.includes(id)) continue;
    for (const target of takesBack(graph, id)) {
      const clue = graph.clues[target];
      const plain = clue.kind === "statement" && clue.reached.by !== "gated";
      if (plain && saying.has(target) && !play.retracted.includes(target)) out.add(target);
    }
  }
  return [...out].map((id) => text(graph, play, id));
}

/** The whole talk input for one character on this line, besides personality and reading level. */
export function talkState(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): ClueGraphTalkState {
  const mine = new Set(cluesOf(graph, character));
  const gates = availableGates(graph, play, character);
  const stance = stanceOf(graph, play, character);
  const said = play.held.filter((id) => mine.has(id));
  return {
    character,
    stance,
    demeanor: demeanorFor(graph, character, stance),
    says_first: nextFirstWords(graph, play, character).map((id) => ({
      id,
      says: text(graph, play, id),
      ...spotField(graph, id),
      with: riders(graph, play, id),
    })),
    answers_if_asked: askable(graph, play, character).map((id) => {
      const clue = graph.clues[id];
      const about = clue.kind === "statement" && clue.reached.by === "asked" ? clue.reached.about : "";
      return { id, about, says: clue.fact, ...spotField(graph, id), with: riders(graph, play, id) };
    }),
    gates: gates.map(({ id, bluffable }) => ({
      id,
      opens_with: openerOf(graph, play, gateOf(graph.clues[id])!),
      bluffable,
      says: text(graph, play, id),
      ...spotField(graph, id),
      with: riders(graph, play, id),
      takes_back: takesBack(graph, id).map((target) => text(graph, play, target)),
    })),
    shows_when: subjectTells(graph, play, character).map((id) => {
      const clue = graph.clues[id];
      const subject = clue.kind === "tell" && clue.reached.by === "seen" ? clue.reached.subject : "";
      return { id, subject: subject ?? "", does: clue.fact, ...spotField(graph, id) };
    }),
    story_so_far: said
      .filter((id) => graph.clues[id].kind === "statement")
      .map((id) => ({ says: text(graph, play, id), taken_back: play.retracted.includes(id) })),
    established: said
      .filter((id) => graph.clues[id].kind === "tell")
      .map((id) => text(graph, play, id)),
    keeps_back: keepsBack(graph, play, character, new Set(gates.map((gate) => gate.id))),
  };
}
