/**
 * The truth set as the labelling page sees it: every stored game, its label
 * file, and each of its three passes.
 *
 * - `pass-1`: every turn, no judge finding.
 * - `reported`: pass 1 limited to the turns a failing verdict's finding points
 *   at (`reportedTurns`), still no finding. Its labels record pass 1.
 * - `pass-2`: only the turns where a judge and the label disagree, with those
 *   verdicts (`disagreements.ts`).
 *
 * A pass-1 view keeps no verdict, so nothing it renders can carry one; the
 * stored results reach it only to pick the reported turns.
 */

import path from "node:path";

import { InputError } from "../core/errors.ts";
import { GAME_LABELS, loadTruthSet } from "../lib/truth/loader.ts";
import type { TruthGame, TruthTurnVariant } from "../lib/truth/loader.ts";
import type { StoredVerdict } from "../lib/truth/schemas.ts";
import { latestLabel } from "../lib/truth/truth.ts";
import { disagreementsAt, judgesGame, judgesGameOrVariant, reportedTurns } from "./disagreements.ts";
import type { Disagreement } from "./disagreements.ts";
import { GameLabels } from "./store.ts";
import { playedTurns } from "./turns.ts";

export const PHASES = ["pass-1", "reported", "pass-2"] as const;
export type Phase = (typeof PHASES)[number];

export function isPhase(value: string): value is Phase {
  return (PHASES as readonly string[]).includes(value);
}

export function passOf(phase: Phase): 1 | 2 {
  return phase === "pass-2" ? 2 : 1;
}

export const PHASE_NAMES: Record<Phase, string> = { "pass-1": "pass 1", reported: "pass 1, reported turns", "pass-2": "pass 2" };

/** Where a pass of a game lives on the page. */
export function phasePath(game: string, phase: Phase): string {
  return `/g/${encodeURIComponent(game)}/${phase}`;
}

/** One pass of one game: its turns, which are done, and the verdicts it may show. */
export class PhaseView {
  readonly game: TruthGame;
  readonly phase: Phase;
  readonly store: GameLabels;
  private readonly verdicts: readonly StoredVerdict[];
  private readonly only: ReadonlySet<number> | null;

  constructor(game: TruthGame, phase: Phase, store: GameLabels, verdicts: readonly StoredVerdict[], only: ReadonlySet<number> | null) {
    this.game = game;
    this.phase = phase;
    this.store = store;
    this.verdicts = verdicts;
    this.only = only;
  }

  get pass(): 1 | 2 {
    return passOf(this.phase);
  }

  get base(): string {
    return phasePath(this.game.id, this.phase);
  }

  /** The turns of this pass, in order. */
  turns(): number[] {
    const sequences = playedTurns(this.game.trace).map((event) => event.sequence);
    const only = this.only;
    if (this.pass === 1) return only === null ? sequences : sequences.filter((sequence) => only.has(sequence));
    return sequences.filter((sequence) => this.disagreements(sequence).length > 0);
  }

  disagreements(sequence: number): Disagreement[] {
    return this.pass === 2 ? disagreementsAt(this.game.id, this.store.labels, this.verdicts, sequence) : [];
  }

  /** Whether this pass has looked at a turn: it has a label at all (pass one), or one given in pass two. */
  done(sequence: number): boolean {
    const label = latestLabel(this.store.labels, sequence);
    return label !== null && (this.pass === 1 || label.pass === 2);
  }

  firstOpen(): number | null {
    return this.turns().find((sequence) => !this.done(sequence)) ?? null;
  }

  /** Where to go after `sequence`: the next turn of this pass, else the end. */
  after(sequence: number): string {
    const next = this.turns().find((candidate) => candidate > sequence);
    return next === undefined ? `${this.base}/done` : `${this.base}/turn/${next}`;
  }

  summary(): string {
    const turns = this.turns();
    if (turns.length === 0) {
      return this.pass === 1 ? "No turn to label: no finding of a failing verdict points at a turn of this game." : "No turn needs a second look: no judge and label disagree.";
    }
    return `${turns.filter((sequence) => this.done(sequence)).length} of ${turns.length} turns done in pass ${this.pass}.`;
  }
}

/** Where a game stands, for the list of games. */
export type Stage = "not-started" | "pass-1" | "no-results" | "pass-2" | "done";

export interface GameSummary {
  id: string;
  title: string | null;
  persona: string | null;
  /** When the game was played, as the trace records it. */
  played: string | null;
  turns: number;
  /** Turns with a label of any pass. */
  labelled: number;
  /** The newest label: when, and by whom. */
  last: { at: string; by: string } | null;
  /** Everyone who labelled a turn, in the order they first did. */
  by: string[];
  stage: Stage;
  /** Pass 2's turns not yet looked at; null until pass 1 is complete, so a judge's view never shows before it. */
  open: number | null;
  /** The passes the game offers now. */
  phases: Phase[];
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

export class LabelHub {
  readonly games: readonly TruthGame[];
  readonly truthRoot: string;
  private readonly verdicts: readonly StoredVerdict[];
  private readonly variants: readonly TruthTurnVariant[];
  private readonly stores = new Map<string, GameLabels>();

  private constructor(truthRoot: string, games: readonly TruthGame[], verdicts: readonly StoredVerdict[], variants: readonly TruthTurnVariant[], now: () => Date) {
    this.truthRoot = truthRoot;
    this.games = games;
    this.verdicts = verdicts;
    this.variants = variants;
    for (const game of games) {
      this.stores.set(game.id, new GameLabels(game.labelsFile ?? path.join(truthRoot, "games", game.id, GAME_LABELS), game.labels, now));
    }
  }

  static async load(truthRoot: string, now: () => Date = () => new Date()): Promise<LabelHub> {
    const set = await loadTruthSet(truthRoot);
    return new LabelHub(truthRoot, set.games, set.results.flatMap((results) => results.verdicts), set.turnVariants, now);
  }

  game(id: string): TruthGame | null {
    return this.games.find((game) => game.id === id) ?? null;
  }

  private results(): string {
    return path.join(this.truthRoot, "results");
  }

  /** A pass of a game; throws `InputError` saying why when the game or the pass is not there. */
  phase(id: string, phase: Phase): PhaseView {
    const game = this.game(id);
    if (!game) {
      const known = this.games.map((candidate) => candidate.id).join(", ") || "none";
      throw new InputError(`no stored game "${id}" in ${this.truthRoot} (it holds: ${known})`);
    }
    const store = this.stores.get(id) as GameLabels;
    if (phase === "reported") {
      if (!judgesGameOrVariant(this.verdicts, id)) {
        throw new InputError(
          `reported turns need stored judge results, and none in ${this.results()} judge game "${id}" or its variants; run the judges on it first, or label every turn`,
        );
      }
      return new PhaseView(game, phase, store, [], reportedTurns(this.verdicts, this.variants, id));
    }
    if (phase === "pass-1") return new PhaseView(game, phase, store, [], null);
    if (!judgesGame(this.verdicts, id)) {
      throw new InputError(`pass 2 needs stored judge results, and none in ${this.results()} judge game "${id}"; run the judges on it first, or label in pass 1`);
    }
    return new PhaseView(game, phase, store, this.verdicts, null);
  }

  /** Every game's standing, its labels read afresh from the files. */
  async summaries(): Promise<GameSummary[]> {
    return Promise.all(
      this.games.map(async (game) => {
        const store = this.stores.get(game.id) as GameLabels;
        await store.refresh();
        return this.summaryOf(game, store);
      }),
    );
  }

  private summaryOf(game: TruthGame, store: GameLabels): GameSummary {
    const sequences = playedTurns(game.trace).map((event) => event.sequence);
    const labelled = sequences.filter((sequence) => latestLabel(store.labels, sequence) !== null).length;
    const newest = store.labels.reduce<(typeof store.labels)[number] | null>((found, label) => (found === null || label.at > found.at ? label : found), null);
    const judged = judgesGame(this.verdicts, game.id);
    const complete = sequences.length > 0 && labelled === sequences.length;
    const phases: Phase[] = ["pass-1"];
    if (judgesGameOrVariant(this.verdicts, game.id)) phases.push("reported");
    let open: number | null = null;
    if (complete && judged) {
      phases.push("pass-2");
      const second = new PhaseView(game, "pass-2", store, this.verdicts, null);
      open = second.turns().filter((sequence) => !second.done(sequence)).length;
    }
    const trace = game.trace as unknown as Record<string, unknown>;
    return {
      id: game.id,
      title: text(record(record(trace.blueprint).metadata).title),
      persona: text(record(trace.source).persona),
      played: text(record(trace.session).created_at),
      turns: sequences.length,
      labelled,
      last: newest ? { at: newest.at, by: newest.by } : null,
      by: [...new Set(store.labels.map((label) => label.by))],
      stage: stageOf(labelled, complete, judged, open),
      open,
      phases,
    };
  }
}

function stageOf(labelled: number, complete: boolean, judged: boolean, open: number | null): Stage {
  if (labelled === 0) return "not-started";
  if (!complete) return "pass-1";
  if (!judged) return "no-results";
  return open === 0 ? "done" : "pass-2";
}
