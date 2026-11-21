// A clue-graph case in play: the events folded into what the player holds.
//
// Everything here is a pure function of the graph and the events, rebuilt on
// every call; nothing is stored beside the events. The model is
// `docs/clue-graph.md`.

import { has, ruleMet } from "../../../shared/src/clue-graph-reach.ts";
import {
  FIRST_WORDS_PER_LINE,
  type ClueGraphCase,
  type ClueGraphClue,
  type ClueGraphGate,
} from "../../../shared/src/clue-graph-schema.ts";

/**
 * What the engine records of a turn. `line` is one line said in the
 * conversation `talk` started: the gated clues the narrator says it opened, the
 * asked clues it answered, and the subject tells it showed.
 */
export type ClueGraphEvent =
  | { type: "move"; location: string }
  | { type: "search"; spot?: string }
  | { type: "talk"; character: string }
  | {
      type: "line";
      character: string;
      opened?: string[];
      asked?: string[];
      seen?: string[];
    };

export interface ClueGraphPlay {
  /** Where the player is. */
  at: string;
  /** Turns spent: a move, a search or starting a conversation costs one. */
  turns: number;
  /** Who the player is talking to, until they move, search or talk to another. */
  talking: string | null;
  /** Characters the player has talked to, in meeting order. */
  met: string[];
  /** Every clue the player holds, in the order it came out. */
  held: string[];
  /** Statements taken back, held or not. */
  retracted: string[];
  /** Spots searched, as `searchKey` values, the plain search included. */
  searched: string[];
}

/** A play's outcome for one event. */
export interface ClueGraphStep {
  play: ClueGraphPlay;
  /** Clues the event brought out, riding tells included, in order. */
  revealed: string[];
  /** What the narrator reported that its state did not offer. */
  rejected: string[];
}

/** One available gate: a gated clue whose turn has come. */
export interface AvailableGate {
  id: string;
  /** True when a believable bluff opens it without its `use` clues held. */
  bluffable: boolean;
}

export function startPlay(graph: ClueGraphCase): ClueGraphPlay {
  return {
    at: graph.opening.location,
    turns: 0,
    talking: null,
    met: [],
    held: [],
    retracted: [],
    searched: [],
  };
}

/** The key of a searched spot, or of a location's plain search. */
export function searchKey(location: string, spot?: string): string {
  return JSON.stringify([location, spot ?? null]);
}

export function sourceCharacter(clue: ClueGraphClue): string | null {
  return clue.kind === "evidence" ? null : clue.source.character;
}

/** A character's clues, in file order. */
export function cluesOf(graph: ClueGraphCase, character: string): string[] {
  return Object.keys(graph.clues).filter(
    (id) => sourceCharacter(graph.clues[id]) === character,
  );
}

export function gateOf(clue: ClueGraphClue): ClueGraphGate | null {
  return clue.kind === "statement" && clue.reached.by === "gated"
    ? clue.reached.gate
    : null;
}

/** Tells seen with a statement: they come out with it. */
export function ridersOf(graph: ClueGraphCase, statement: string): string[] {
  return Object.keys(graph.clues).filter((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "tell" &&
      clue.reached.by === "seen" &&
      clue.reached.with === statement
    );
  });
}

export function holds(play: ClueGraphPlay): (id: string) => boolean {
  const held = new Set(play.held);
  return (id) => held.has(id);
}

/** Held and not taken back. */
export function isLive(play: ClueGraphPlay, id: string): boolean {
  return play.held.includes(id) && !play.retracted.includes(id);
}

/** Whether the clues `holds` admits satisfy a gate's `use`. */
export function useHeld(gate: ClueGraphGate, held: (id: string) => boolean): boolean {
  if (!gate.use) return false;
  return "any" in gate.use ? gate.use.any.some(held) : gate.use.all.every(held);
}

/**
 * A character's gated clues whose turn has come: not yet out nor taken back,
 * every `after` clue out (held, or taken back). A physical gate with `use` also needs those clues held; any other
 * gate is available without them, so a bluff can open it.
 */
export function availableGates(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): AvailableGate[] {
  const held = holds(play);
  const out: AvailableGate[] = [];
  for (const id of cluesOf(graph, character)) {
    const gate = gateOf(graph.clues[id]);
    if (!gate || held(id) || play.retracted.includes(id)) continue;
    // A statement taken back before it was said still counts as out.
    if (!(gate.after ?? []).every((earlier) => held(earlier) || play.retracted.includes(earlier)))
      continue;
    if (gate.physical && gate.use && !useHeld(gate, held)) continue;
    out.push({ id, bluffable: !gate.physical && gate.use !== undefined });
  }
  return out;
}

/** A character's asked clues not yet out and not already taken back. */
export function askable(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): string[] {
  return cluesOf(graph, character).filter((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "statement" &&
      clue.reached.by === "asked" &&
      !play.held.includes(id) &&
      !play.retracted.includes(id)
    );
  });
}

/** A character's tells shown when a subject comes up, not yet shown. */
export function subjectTells(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): string[] {
  return cluesOf(graph, character).filter((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "tell" &&
      clue.reached.by === "seen" &&
      clue.reached.subject !== undefined &&
      !play.held.includes(id)
    );
  });
}

/** The first words a character has not yet said, a line's worth at most. */
export function nextFirstWords(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  character: string,
): string[] {
  return cluesOf(graph, character)
    .filter((id) => {
      const clue = graph.clues[id];
      return (
        clue.kind !== "evidence" &&
        clue.reached.by === "first_meeting" &&
        !play.held.includes(id) &&
        !play.retracted.includes(id)
      );
    })
    .slice(0, FIRST_WORDS_PER_LINE);
}

/** Supported conclusions: those whose rule holds over live clues only. */
export function supportedConclusions(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
): string[] {
  const live = (id: string) => isLive(play, id);
  return Object.keys(graph.conclusions).filter((id) =>
    ruleMet(graph, graph.conclusions[id].rule, live),
  );
}

/** The spots of a location the player can see: plain ones, and hidden ones whose pointer is held. */
export function visibleSpots(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  location: string,
): string[] {
  const held = holds(play);
  return graph.locations[location].spots
    .filter((spot) => spot.revealed_by === undefined || held(spot.revealed_by))
    .map((spot) => spot.name);
}

/** The evidence at a spot, or at the location's plain search. */
function evidenceAt(
  graph: ClueGraphCase,
  location: string,
  spot: string | undefined,
): string[] {
  return Object.keys(graph.clues).filter((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "evidence" &&
      clue.source.location === location &&
      clue.source.spot === spot
    );
  });
}

class Fold {
  readonly play: ClueGraphPlay;
  readonly revealed: string[] = [];
  readonly rejected: string[] = [];

  private readonly graph: ClueGraphCase;

  constructor(graph: ClueGraphCase, play: ClueGraphPlay) {
    this.graph = graph;
    this.play = structuredClone(play);
  }

  give(ids: string[]) {
    for (const id of ids)
      for (const clue of [id, ...ridersOf(this.graph, id)]) {
        if (this.play.held.includes(clue)) continue;
        this.play.held.push(clue);
        this.revealed.push(clue);
        const found = this.graph.clues[clue];
        const takes = found.kind === "statement" ? (found.takes_back ?? []) : [];
        for (const target of takes)
          if (!this.play.retracted.includes(target)) this.play.retracted.push(target);
      }
  }

  /** Keeps the reported IDs found in `offered`, and records the rest as rejected. */
  accept(reported: string[] | undefined, offered: string[]): string[] {
    const kept: string[] = [];
    for (const id of new Set(reported ?? []))
      if (offered.includes(id)) kept.push(id);
      else this.rejected.push(id);
    return kept;
  }

  spend(at = this.play.at) {
    this.play.turns += 1;
    this.play.at = at;
    this.play.talking = null;
  }
}

function applyLine(
  graph: ClueGraphCase,
  fold: Fold,
  event: Extract<ClueGraphEvent, { type: "line" }>,
) {
  const { play } = fold;
  if (play.talking !== event.character)
    throw new Error(`A line to "${event.character}" outside a conversation with them`);
  // What the line may open is what the state offered before it was said.
  const gates = availableGates(graph, play, event.character).map((gate) => gate.id);
  const opened = fold.accept(event.opened, gates);
  const asked = fold.accept(event.asked, askable(graph, play, event.character));
  const seen = fold.accept(event.seen, subjectTells(graph, play, event.character));
  fold.give(nextFirstWords(graph, play, event.character));
  fold.give([...asked, ...opened, ...seen]);
}

/**
 * Applies one event. Narrator reports the state did not offer are dropped and
 * listed in `rejected`; an event the game could never record throws.
 */
export function applyEvent(
  graph: ClueGraphCase,
  before: ClueGraphPlay,
  event: ClueGraphEvent,
): ClueGraphStep {
  const fold = new Fold(graph, before);
  const { play } = fold;
  switch (event.type) {
    case "move":
      if (!has(graph.locations, event.location))
        throw new Error(`No location "${event.location}"`);
      fold.spend(event.location);
      break;
    case "search": {
      fold.spend();
      // An unknown spot, or a hidden one named before its pointer is held,
      // finds nothing and counts as unsearched.
      if (event.spot !== undefined && !visibleSpots(graph, play, play.at).includes(event.spot))
        break;
      const key = searchKey(play.at, event.spot);
      if (!play.searched.includes(key)) play.searched.push(key);
      fold.give(evidenceAt(graph, play.at, event.spot));
      break;
    }
    case "talk": {
      if (!has(graph.characters, event.character))
        throw new Error(`No character "${event.character}"`);
      if (graph.characters[event.character].location !== play.at)
        throw new Error(`"${event.character}" is not at "${play.at}"`);
      fold.spend();
      play.talking = event.character;
      if (!play.met.includes(event.character)) play.met.push(event.character);
      fold.give(nextFirstWords(graph, play, event.character));
      break;
    }
    case "line":
      applyLine(graph, fold, event);
      break;
  }
  return { play, revealed: fold.revealed, rejected: fold.rejected };
}

/** Folds every event from the opening. */
export function replay(graph: ClueGraphCase, events: ClueGraphEvent[]): ClueGraphPlay {
  return events.reduce(
    (play, event) => applyEvent(graph, play, event).play,
    startPlay(graph),
  );
}
