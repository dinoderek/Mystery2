/**
 * The player's view of a clue-graph case, for the judge that reads each step
 * with only what the player would hold at that point (`cg_step_sense`).
 *
 * The case is played in waves. Wave 0 is every clue reachable from the
 * opening alone; wave n, every clue reachable once waves 0 to n-1 are held,
 * never by a bluff (`reachReason` in `packages/shared/src/clue-graph-reach.ts`).
 * A clue's wave is the earliest point it can be had, so the clues before it
 * are the most the player can hold when they take it.
 *
 * A step is a clue the player must do something to get beyond being there:
 * ask about its subject, open its gate, or search a hidden spot. Each lists
 * its leads, the held clues that point the way, with their facts; a tell seen
 * with a held statement is in hand with it. First words, tells seen on the
 * spot and searches of a visible spot are free, and are not steps.
 */

import { MIN_READING_AGE } from "../../packages/shared/src/age-profile.ts";
import { has, reachReason } from "../../packages/shared/src/clue-graph-reach.ts";
import { ClueGraphCaseSchema, OPENING_PROMPT, type ClueGraphCase } from "../../packages/shared/src/clue-graph-schema.ts";

/** What a lead does for its step: prompts an ask, is shown, hints at a line, must be out first, or points at a hidden spot. */
export type LeadRole = "prompt" | "show" | "hint" | "after" | "pointer";

export interface Lead {
  /** A clue id, or `opening` for the opening's facts. */
  id: string;
  role: LeadRole;
  fact: string;
}

export interface Step {
  /** The clue the step gives. */
  clue_id: string;
  wave: number;
  /** `ask`: ask the character about `about`; `gate`: open the character's gate; `hidden_spot`: search a spot hidden until its pointer is held. */
  way: "ask" | "gate" | "hidden_spot";
  /** Whose clue it is, or where it is found. */
  from: { character: string } | { location: string; spot: string };
  about?: string;
  /** A gate's line of questioning. */
  line?: string;
  /** A gate that cannot be bluffed. */
  physical?: true;
  leads: Lead[];
}

export interface PlayerView {
  /** The youngest reader the game supports: a case has no age of its own, so every case is judged for them. */
  reading_age: number;
  /** Clue ids by wave: what the player can hold, in order. */
  waves: string[][];
  steps: Step[];
}

/** Every clue's wave, from the opening; a clue never reached has none. */
export function clueWaves(graph: ClueGraphCase): string[][] {
  const held = new Set<string>();
  const waves: string[][] = [];
  for (;;) {
    const before = new Set(held);
    const holds = (id: string) => before.has(id);
    const wave = Object.entries(graph.clues)
      .filter(([id, clue]) => !before.has(id) && reachReason(graph, clue, holds) !== null)
      .map(([id]) => id);
    if (wave.length === 0) return waves;
    for (const id of wave) held.add(id);
    waves.push(wave);
  }
}

function hiddenSpot(graph: ClueGraphCase, location: string, spot: string | undefined) {
  if (spot === undefined || !has(graph.locations, location)) return undefined;
  return graph.locations[location].spots.find((entry) => entry.name === spot && entry.revealed_by !== undefined);
}

function leadFact(graph: ClueGraphCase, id: string): string {
  return id === OPENING_PROMPT ? graph.opening.facts.join(" ") : graph.clues[id].fact;
}

/** The step a clue is, with the leads held before its wave, or null for a free clue. */
function stepOf(graph: ClueGraphCase, id: string, wave: number, held: (id: string) => boolean): Step | null {
  const clue = graph.clues[id];
  const lead = (lead: string, role: LeadRole): Lead => ({ id: lead, role, fact: leadFact(graph, lead) });
  if (clue.kind === "evidence") {
    const { location, spot } = clue.source;
    const hidden = hiddenSpot(graph, location, spot);
    if (!hidden?.revealed_by) return null;
    return { clue_id: id, wave, way: "hidden_spot", from: { location, spot: hidden.name }, leads: [lead(hidden.revealed_by, "pointer")] };
  }
  const from = { character: clue.source.character };
  const { reached } = clue;
  if (reached.by === "asked") {
    const prompts = reached.prompted_by.filter((prompt) => prompt === OPENING_PROMPT || held(prompt));
    return { clue_id: id, wave, way: "ask", from, about: reached.about, leads: prompts.map((prompt) => lead(prompt, "prompt")) };
  }
  if (reached.by !== "gated") return null;
  const { gate } = reached;
  const shown = gate.use ? ("any" in gate.use ? gate.use.any : gate.use.all) : [];
  const leads = [
    ...(gate.after ?? []).map((after) => lead(after, "after")),
    ...shown.filter(held).map((use) => lead(use, "show")),
    ...(gate.line?.hinted_by !== undefined && held(gate.line.hinted_by) ? [lead(gate.line.hinted_by, "hint")] : []),
  ];
  return {
    clue_id: id,
    wave,
    way: "gate",
    from,
    ...(gate.line ? { line: gate.line.text } : {}),
    ...(gate.physical ? { physical: true as const } : {}),
    leads,
  };
}

/**
 * Whether a clue is in hand before a wave: held in an earlier one, or a tell
 * seen on the spot, which shows with its statement or whenever its subject
 * comes up, so it counts as soon as that statement is held.
 */
function inHand(graph: ClueGraphCase, before: Set<string>) {
  return (id: string): boolean => {
    if (before.has(id)) return true;
    const clue = has(graph.clues, id) ? graph.clues[id] : undefined;
    if (clue?.kind !== "tell" || clue.reached.by !== "seen") return false;
    return clue.reached.with === undefined || before.has(clue.reached.with);
  };
}

/** The player's view of a case: its waves, and each step with what leads to it. */
export function playerView(graph: ClueGraphCase): PlayerView {
  const waves = clueWaves(graph);
  const steps: Step[] = [];
  const held = new Set<string>();
  waves.forEach((wave, index) => {
    const before = new Set(held);
    for (const id of wave) {
      const step = stepOf(graph, id, index, inHand(graph, before));
      if (step) steps.push(step);
    }
    for (const id of wave) held.add(id);
  });
  return { reading_age: MIN_READING_AGE, waves, steps };
}

/** The step ids of a case as read from its file: none for a file that is not a case. */
export function stepIds(candidate: unknown): Set<string> {
  const parsed = ClueGraphCaseSchema.safeParse(candidate);
  return new Set(parsed.success ? playerView(parsed.data).steps.map((step) => step.clue_id) : []);
}
