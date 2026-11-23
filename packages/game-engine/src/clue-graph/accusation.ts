// The accusation on a clue-graph case (`docs/clue-graph.md`, "Accusation").
// The engine decides it from the graph and the clues held; the narrator only
// reports who the investigator named and which of their clues they cited, then
// words what the engine decided. Before the case is resolved the narrator is
// given only what the investigator holds; the closing scene gets the truth.

import { ruleMet } from "../../../shared/src/clue-graph-reach.ts";
import { relevantClues } from "../../../shared/src/clue-graph-route.ts";
import type { ClueGraphCase, ClueGraphRule } from "../../../shared/src/clue-graph-schema.ts";
import { isLastAccusation } from "../accusations.ts";
import { currentLeads, notebook, type NotebookEntry } from "./leads.ts";
import { isLive, searchKey, sourceCharacter, supportedConclusions, type ClueGraphPlay } from "./play.ts";

/** What the narrator reports of one accusation: who was named, and which held clues were cited. */
export interface AccusationReport {
  accused: string | null;
  cited: string[];
}

/**
 * What the engine decided: `win`; `not_yet`, a failure that spends one
 * accusation; `lose`, a failure on the last one.
 */
export type AccusationVerdict = "win" | "not_yet" | "lose";

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

/**
 * The rule. The true culprit named wins when the player holds the confession,
 * or a culprit conclusion holds and they cited one of its clues. Anything else,
 * a right name without support included, is a failure, which loses on the last
 * accusation.
 */
export function decideAccusation(
  graph: ClueGraphCase,
  play: ClueGraphPlay,
  history: HistoryRow[],
  report: AccusationReport,
): AccusationVerdict {
  if (report.accused === culpritOf(graph).character) {
    if (confessionClues(graph).some((id) => isLive(play, id))) return "win";
    const support = new Set(supportingClues(graph, play));
    if (report.cited.some((id) => support.has(id))) return "win";
  }
  return isLastAccusation(history) ? "lose" : "not_yet";
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
 * The lead a failed accusation points at: of the notebook's leads, the first whose
 * person or spot holds a clue not yet held on a way to the culprit other than
 * the confession, else the first lead; null when there is none. It names who
 * or where, as every lead does.
 */
export function questionLead(graph: ClueGraphCase, play: ClueGraphPlay, towardClues?: Set<string>, excluded: string[] = []): string | null {
  const { conclusion, character } = culpritOf(graph);
  const blocked = new Set([character, ...excluded].flatMap((id) => [`meet:${id}`, `talk:${id}`]));
  const leads = currentLeads(graph, play).filter((lead) => !blocked.has(lead.key));
  // The confession's way runs through the culprit, so pointing there would say who did it.
  const onTheWay = towardClues ?? relevantClues(graph, graph.conclusions[conclusion].rule, new Set(confessionClues(graph)));
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

/** Only the material needed to explain this failed case, never a correctness flag. */
export type AccusationReply =
  | { kind: "flaw"; cleared_by: NotebookEntry[] }
  | { kind: "flaw"; retracted: Array<{ statement: NotebookEntry; taken_back_by: string }> }
  | { kind: "alternative"; people: AccusablePerson[]; lead: string | null }
  | { kind: "missing"; fact_kind: string; lead: string | null };

/** Choose the closest unfinished non-confession branch, preserving authored order on ties. */
function missingOnRoute(graph: ClueGraphCase, play: ClueGraphPlay, rule: ClueGraphRule): string[] {
  if (typeof rule === "string") {
    if (Object.hasOwn(graph.conclusions, rule)) return missingOnRoute(graph, play, graph.conclusions[rule].rule);
    return isLive(play, rule) ? [] : [rule];
  }
  const branches = ("all" in rule ? rule.all : rule.any).map((part) => missingOnRoute(graph, play, part));
  if ("all" in rule) return [...new Set(branches.flat())];
  const confessions = new Set(confessionClues(graph));
  const ordinary = branches.filter((branch) => !branch.some((id) => confessions.has(id)));
  return (ordinary.length ? ordinary : branches).reduce((best, branch) => branch.length < best.length ? branch : best);
}

function missingReply(graph: ClueGraphCase, play: ClueGraphPlay): AccusationReply {
  const missing = missingOnRoute(graph, play, graph.conclusions[culpritOf(graph).conclusion].rule);
  const kind = missing.length ? graph.clues[missing[0]].kind : null;
  const fact_kind = kind === "evidence" ? "a physical finding that links someone to what happened"
    : kind === "statement" ? "an account of who was where when it happened"
    : kind === "tell" ? "an observed detail that connects someone to what happened"
    : "a link between the clues you hold and the person you accuse";
  return { kind: "missing", fact_kind, lead: questionLead(graph, play) };
}

interface AccusationRoute {
  clues: string[];
  clears: string[];
}

/** Keep clearing conclusions as exclusions: the other clues on that route alone leave those people possible. */
function accusationRoutes(graph: ClueGraphCase, rule: ClueGraphRule): AccusationRoute[] {
  if (typeof rule === "string") {
    const conclusion = graph.conclusions[rule];
    if (!conclusion) return [{ clues: [rule], clears: [] }];
    if (conclusion.clears) return [{ clues: [], clears: [conclusion.clears] }];
    return accusationRoutes(graph, conclusion.rule);
  }
  if ("any" in rule) return rule.any.flatMap((part) => accusationRoutes(graph, part));
  return rule.all.reduce<AccusationRoute[]>((routes, part) => routes.flatMap((route) =>
    accusationRoutes(graph, part).map((more) => ({ clues: [...route.clues, ...more.clues], clears: [...route.clears, ...more.clears] }))),
  [{ clues: [], clears: [] }]);
}

/** Other people the cited route still needs to exclude, never names guessed from prose. */
function alternativePeople(graph: ClueGraphCase, play: ClueGraphPlay, report: AccusationReport): AccusablePerson[] {
  const { conclusion, character } = culpritOf(graph);
  const routes = accusationRoutes(graph, graph.conclusions[conclusion].rule);
  const fits = new Set(routes.filter((route) => route.clues.some((id) => report.cited.includes(id))).flatMap((route) => route.clears));
  const cleared = new Set(supportedConclusions(graph, play).map((id) => graph.conclusions[id].clears));
  return Object.entries(graph.characters)
    .filter(([id]) => fits.has(id) && !cleared.has(id) && id !== report.accused && id !== character)
    .map(([id, person]) => ({ id, name: person.name }));
}

/** Flaws take priority; alternatives follow the graph's elimination routes. */
export function accusationReply(graph: ClueGraphCase, play: ClueGraphPlay, report: AccusationReport): AccusationReply {
  const entries = notebook(graph, play);
  const cited = report.cited.filter((id) => play.held.includes(id));
  const retracted = entries.filter((entry) => entry.taken_back && cited.includes(entry.id))
    .map((statement) => ({ statement, taken_back_by: statement.from }));
  if (retracted.length) return { kind: "flaw", retracted };

  const clearing = new Set<string>();
  for (const conclusion of Object.values(graph.conclusions)) {
    if (conclusion.clears === report.accused && ruleMet(graph, conclusion.rule, (id) => isLive(play, id)))
      supportOf(graph, conclusion.rule, (id) => isLive(play, id), clearing);
  }
  if (clearing.size) return { kind: "flaw", cleared_by: entries.filter((entry) => clearing.has(entry.id)) };

  if (report.accused !== null && report.accused !== culpritOf(graph).character && cited.length) {
    const people = alternativePeople(graph, play, { ...report, cited });
    const toward = new Set(Object.values(graph.conclusions).filter((conclusion) => people.some((person) => person.id === conclusion.clears))
      .flatMap((conclusion) => [...relevantClues(graph, conclusion.rule)]));
    if (people.length) return { kind: "alternative", people, lead: questionLead(graph, play, toward, [report.accused]) };
  }
  return missingReply(graph, play);
}

/** What the narrator reads before the case is resolved: only what the player holds. */
export interface GraphAccusationContext {
  people: AccusablePerson[];
  /** The notebook: every held clue as its saved line. */
  held: NotebookEntry[];
}

/** The closing scene's truth: the whole account. */
export interface GraphEnding {
  outcome: "win" | "lose";
  culprit: string;
  /** What the culprit conclusion says happened. */
  what_happened: string;
  timeline: string[];
  motive: string;
  /** On a win, the held clues that showed it: the confession, or the supporting clues cited. */
  showed_it: string[];
}

/**
 * What the narrator words an accusation from. Before the case is resolved it never
 * says what the engine decided, so a right name and a wrong one read the same:
 * the case is not proven, with only its selected reply material.
 * Once resolved, it carries the ending.
 */
export interface GraphVerdictContext extends GraphAccusationContext {
  /** Before resolution: the reported name and the engine's reply material. Held contains only citations. */
  accused?: string | null;
  reply?: AccusationReply;
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
  report: AccusationReport = { accused: null, cited: [] },
): GraphVerdictContext {
  const { accused, cited } = report;
  const base = accusationContext(graph, play);
  if (!resolves(verdict))
    return {
      people: base.people.filter((person) => person.id === accused),
      held: base.held.filter((entry) => cited.includes(entry.id)),
      accused,
      reply: accusationReply(graph, play, { accused, cited }),
    };
  const { conclusion, character } = culpritOf(graph);
  const confession = confessionClues(graph).filter((id) => isLive(play, id));
  const support = new Set(supportingClues(graph, play));
  const showed = confession.length > 0 ? confession : cited.filter((id) => support.has(id));
  return {
    ...base,
    ending: {
      outcome: verdict,
      culprit: graph.characters[character].name,
      what_happened: graph.conclusions[conclusion].text,
      timeline: graph.truth.timeline,
      motive: graph.truth.motive,
      showed_it: verdict === "win" ? showed : [],
    },
  };
}

/** Whether a verdict ends the case. */
export function resolves(verdict: AccusationVerdict): verdict is "win" | "lose" {
  return verdict === "win" || verdict === "lose";
}
