// What the player is shown of a clue-graph case: the notebook and the leads.
// A lead names who or where, never what to say or which way a clue cuts, and
// the notebook never shows a conclusion.

import { gateOpens } from "../../../shared/src/clue-graph-reach.ts";
import { OPENING_PROMPT, type ClueGraphCase } from "../../../shared/src/clue-graph-schema.ts";
import {
  askable,
  availableGates,
  gateOf,
  holds,
  lineOf,
  nextFirstWords,
  replay,
  searchKey,
  supportedConclusions,
  visibleSpots,
  type ClueGraphEvent,
  type ClueGraphPlay,
} from "./play.ts";

export interface ClueGraphLead {
  /** Stable across turns: what a lead is, apart from its wording. */
  key: string;
  text: string;
  /** True on the turn the lead first appears. */
  new: boolean;
}

export interface NotebookEntry {
  id: string;
  kind: "evidence" | "statement" | "tell";
  text: string;
  /** Who said or did it, or where it was found. */
  from: string;
  taken_back: boolean;
}

function fromLabel(graph: ClueGraphCase, id: string): string {
  const clue = graph.clues[id];
  if (clue.kind !== "evidence") return graph.characters[clue.source.character].name;
  const place = graph.locations[clue.source.location].name;
  return clue.source.spot ? `${place}: ${clue.source.spot}` : place;
}

/** Held clues in the order found, each as its saved line; a statement taken back says so. */
export function notebook(graph: ClueGraphCase, play: ClueGraphPlay): NotebookEntry[] {
  return play.held
    .map((id) => ({
      id,
      kind: graph.clues[id].kind,
      text: lineOf(graph, play, id),
      from: fromLabel(graph, id),
      taken_back: play.retracted.includes(id),
    }));
}

/**
 * Whether a met character has something the player can get now: first words
 * not yet said, a question a held clue prompts, or an available gate that what
 * is held opens (its clues, its hinting tell, or a plain question).
 */
function mayKnowMore(graph: ClueGraphCase, play: ClueGraphPlay, character: string): boolean {
  const held = holds(play);
  if (nextFirstWords(graph, play, character).length > 0) return true;
  const prompted = askable(graph, play, character).some((id) => {
    const clue = graph.clues[id];
    return (
      clue.kind === "statement" &&
      clue.reached.by === "asked" &&
      clue.reached.prompted_by.some((prompt) => prompt !== OPENING_PROMPT && held(prompt))
    );
  });
  if (prompted) return true;
  return availableGates(graph, play, character).some(
    // Availability has settled `after`; what is left is whether what is held opens it.
    ({ id }) => gateOpens({ ...gateOf(graph.clues[id])!, after: undefined }, held) !== null,
  );
}

/** The leads on this play, unmarked. */
export function currentLeads(graph: ClueGraphCase, play: ClueGraphPlay): Omit<ClueGraphLead, "new">[] {
  const leads: Omit<ClueGraphLead, "new">[] = [];
  for (const [id, character] of Object.entries(graph.characters)) {
    if (!play.met.includes(id))
      leads.push({ key: `meet:${id}`, text: `You have not talked to ${character.name} yet.` });
    else if (mayKnowMore(graph, play, id))
      leads.push({ key: `talk:${id}`, text: `${character.name} may know more.` });
  }
  for (const [id, location] of Object.entries(graph.locations)) {
    const visible = visibleSpots(graph, play, id);
    for (const spot of location.spots) {
      if (spot.revealed_by === undefined || !visible.includes(spot.name)) continue;
      if (play.searched.includes(searchKey(id, spot.name))) continue;
      leads.push({
        key: `spot:${searchKey(id, spot.name)}`,
        text: `Something new to search at ${location.name}: ${spot.name}.`,
      });
    }
  }
  return leads;
}

/** Everything the engine derives from a clue-graph case and its events. */
export interface ClueGraphDerived {
  play: ClueGraphPlay;
  notebook: NotebookEntry[];
  /** Marked new against the play before the last event. */
  leads: ClueGraphLead[];
  /** Never shown to the player. */
  conclusions: string[];
}

export function deriveClueGraph(graph: ClueGraphCase, events: ClueGraphEvent[]): ClueGraphDerived {
  const play = replay(graph, events);
  const before =
    events.length === 0
      ? new Set<string>()
      : new Set(currentLeads(graph, replay(graph, events.slice(0, -1))).map((lead) => lead.key));
  return {
    play,
    notebook: notebook(graph, play),
    leads: currentLeads(graph, play).map((lead) => ({ ...lead, new: !before.has(lead.key) })),
    conclusions: supportedConclusions(graph, play),
  };
}
