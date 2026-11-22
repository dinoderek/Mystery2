// The accusation on a clue-graph case (`docs/clue-graph.md`, "Accusation").
// The engine decides it from the graph and the clues held; the narrator only
// reports who the investigator named and which of their clues they cited, then
// words what the engine decided. Before the case is resolved the narrator is
// given only what the investigator holds; the closing scene gets the truth.

import { ruleMet } from "../../../shared/src/clue-graph-reach.ts";
import { relevantClues } from "../../../shared/src/clue-graph-route.ts";
import type { ClueGraphCase, ClueGraphRule } from "../../../shared/src/clue-graph-schema.ts";
import { currentLeads, notebook, type NotebookEntry } from "./leads.ts";
import { isLive, searchKey, sourceCharacter, supportedConclusions, type ClueGraphPlay } from "./play.ts";

/** The rounds after which a failing accusation ends the case, as V2's judge counts them. */
export const LAST_ROUND = 3;

/** What the narrator reports of one round: who was named, and which held clues were cited. */
export interface AccusationReport {
  accused: string | null;
  cited: string[];
}

/**
 * What the engine decided: `win`; `question`, the one question a right name
 * without support earns; `not_yet`, any other failing round; `lose`, a
 * failing round at the limit.
 */
export type AccusationVerdict = "win" | "question" | "not_yet" | "lose";

/** What an accusation event saves, beside the player's reasoning. */
export interface SavedAccusation extends AccusationReport {
  verdict: AccusationVerdict;
}

interface HistoryRow {
  event_type: string;
  payload?: Record<string, unknown> | null;
}

export function culpritOf(graph: ClueGraphCase): { conclusion: string; character: string } {
  const [conclusion, { culprit }] = Object.entries(graph.conclusions).find(([, value]) => value.culprit !== undefined)!;
  return { conclusion, character: culprit! };
}

/** The held clues, not taken back, that make a met rule hold: every met branch's. */
function supportOf(graph: ClueGraphCase, rule: ClueGraphRule, live: (id: string) => boolean, out: Set<string>): void {
  if (typeof rule === "string") {
    if (Object.hasOwn(graph.conclusions, rule)) supportOf(graph, graph.conclusions[rule].rule, live, out);
    else if (live(rule)) out.add(rule);
    return;
  }
  for (const part of "all" in rule ? rule.all : rule.any)
    if (ruleMet(graph, part, live)) supportOf(graph, part, live, out);
}

/** The clues the player can cite for the culprit: none unless the culprit conclusion holds. */
export function supportingClues(graph: ClueGraphCase, play: ClueGraphPlay): string[] {
  const { conclusion } = culpritOf(graph);
  if (!supportedConclusions(graph, play).includes(conclusion)) return [];
  const out = new Set<string>();
  supportOf(graph, graph.conclusions[conclusion].rule, (id) => isLive(play, id), out);
  return play.held.filter((id) => out.has(id));
}

/** The leaves a rule names, through the conclusions it names. */
function leaves(graph: ClueGraphCase, rule: ClueGraphRule, out = new Set<string>()): Set<string> {
  if (typeof rule !== "string") ("all" in rule ? rule.all : rule.any).forEach((part) => leaves(graph, part, out));
  else if (Object.hasOwn(graph.conclusions, rule)) leaves(graph, graph.conclusions[rule].rule, out);
  else out.add(rule);
  return out;
}

/** The culprit's confession: their gated true statements the culprit conclusion names. */
export function confessionClues(graph: ClueGraphCase): string[] {
  const { conclusion, character } = culpritOf(graph);
  return [...leaves(graph, graph.conclusions[conclusion].rule)].filter((id) => {
    const clue = graph.clues[id];
    return clue?.kind === "statement" && clue.truth && clue.reached.by === "gated" && clue.source.character === character;
  });
}

/** The rounds so far and whether the one question was already asked. */
function roundsSoFar(history: HistoryRow[]): { round: number; questioned: boolean } {
  const rounds = history.filter((row) => row.event_type === "accuse_round");
  const questioned = rounds.some(
    (row) => (row.payload?.clue_graph_accusation as SavedAccusation | undefined)?.verdict === "question",
  );
  return { round: rounds.length, questioned };
}

/**
 * The rule. The true culprit named wins when the player holds the confession,
 * or a culprit conclusion holds and they cited one of its clues. The first
 * time the right name falls short, it earns the question; anything else keeps
 * V2's rounds: go on, and lose from round `LAST_ROUND`.
 */
export function decideAccusation(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  history: HistoryRow[],
  report: AccusationReport,
): AccusationVerdict {
  const rightName = report.accused === culpritOf(graph).character;
  if (rightName) {
    if (confessionClues(graph).some((id) => isLive(play, id))) return "win";
    const support = new Set(supportingClues(graph, play));
    if (report.cited.some((id) => support.has(id))) return "win";
  }
  const { round, questioned } = roundsSoFar(history);
  if (rightName && !questioned) return "question";
  return round >= LAST_ROUND ? "lose" : "not_yet";
}

/** The clues a lead is about: the character's, or the spot's. */
function leadClues(graph: ClueGraphCase, key: string): string[] {
  const [kind, rest] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
  if (kind === "meet" || kind === "talk")
    return Object.keys(graph.clues).filter((id) => sourceCharacter(graph.clues[id]) === rest);
  return Object.keys(graph.clues).filter((id) => {
    const clue = graph.clues[id];
    return clue.kind === "evidence" && searchKey(clue.source.location, clue.source.spot) === rest;
  });
}

/**
 * The lead the question points at: of the notebook's leads, the first whose
 * person or spot holds a clue not yet held on a way to the culprit other than
 * the confession, else the first lead; null when there is none. It names who
 * or where, as every lead does.
 */
export function questionLead(graph: ClueGraphCase, play: ClueGraphPlay): string | null {
  const leads = currentLeads(graph, play);
  const { conclusion } = culpritOf(graph);
  // The confession's way runs through the culprit, so pointing there would say who did it.
  const onTheWay = relevantClues(graph, graph.conclusions[conclusion].rule, new Set(confessionClues(graph)));
  const toward = leads.find((lead) =>
    leadClues(graph, lead.key).some((id) => onTheWay.has(id) && !play.held.includes(id)),
  );
  return (toward ?? leads[0])?.text ?? null;
}

/** A person the accusation can name, as the player knows them. */
export interface AccusablePerson {
  id: string;
  name: string;
}

/** What the narrator reads before the case is resolved: only what the player holds. */
export interface GraphAccusationContext {
  people: AccusablePerson[];
  /** The notebook: every held clue as its saved line. */
  held: NotebookEntry[];
  /** What the investigator said in this accusation's earlier rounds. */
  earlier_reasoning?: string[];
}

/** The closing scene's truth: the whole account. */
export interface GraphEnding {
  outcome: "win" | "lose";
  culprit: string;
  /** What the culprit conclusion says happened. */
  what_happened: string;
  timeline: string[];
  motive: string;
}

/** What the narrator words a round from: the engine's decision, and the ending once resolved. */
export interface GraphVerdictContext extends GraphAccusationContext {
  verdict: AccusationVerdict;
  /** On `question`: the lead it points at, or null when support is held and it asks for it. */
  lead?: string | null;
  /** Set only once the case is resolved. */
  ending?: GraphEnding;
}

export function accusationContext(graph: ClueGraphCase, play: ClueGraphPlay): GraphAccusationContext {
  return {
    people: Object.entries(graph.characters).map(([id, person]) => ({ id, name: person.name })),
    held: notebook(graph, play),
  };
}

export function verdictContext(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  verdict: AccusationVerdict,
): GraphVerdictContext {
  const base = accusationContext(graph, play);
  // With support held the question asks for it; without, it points at a lead.
  if (verdict === "question")
    return { ...base, verdict, lead: supportingClues(graph, play).length > 0 ? null : questionLead(graph, play) };
  if (verdict === "not_yet") return { ...base, verdict };
  const { conclusion, character } = culpritOf(graph);
  return {
    ...base,
    verdict,
    ending: {
      outcome: verdict,
      culprit: graph.characters[character].name,
      what_happened: graph.conclusions[conclusion].text,
      timeline: graph.truth.timeline,
      motive: graph.truth.motive,
    },
  };
}

/** Whether a verdict ends the case. */
export function resolves(verdict: AccusationVerdict): verdict is "win" | "lose" {
  return verdict === "win" || verdict === "lose";
}
