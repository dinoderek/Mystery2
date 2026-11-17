/**
 * What the stored results say of a game's turns, for the labelling page: the
 * turns a failing verdict reported on (`--reported` in pass 1), and where a judge and a
 * label disagree (pass 2).
 *
 * Per turn and kind, over every stored sample: a catch on a turn the label
 * calls clean for that kind, or a labelled fault no sample caught. A turn with
 * no label is unknown, and a kind no stored judge covered has nothing to
 * disagree with, so neither counts. A judge's catch of a kind in
 * `LABEL_STANDS_WHEN_CLEAN` on a turn labelled clean is not asked about again:
 * the labeller's reading stands.
 */

import { catches, findingsRow } from "../lib/truth/findings.ts";
import type { TurnUnit } from "../lib/truth/findings.ts";
import { GAME_KINDS } from "../lib/truth/kinds.ts";
import type { GameKind } from "../lib/truth/kinds.ts";
import type { TruthTurnVariant } from "../lib/truth/loader.ts";
import type { Label, StoredFinding, StoredVerdict } from "../lib/truth/schemas.ts";
import { latestLabel } from "../lib/truth/truth.ts";

export interface VerdictAtTurn {
  judge: string;
  model: string;
  sample: number;
  /** What it found of the kind at this turn; empty when it judged the turn and found nothing of it. */
  findings: StoredFinding[];
}

export interface Disagreement {
  kind: GameKind;
  /** What the label says of the kind: a fault, or clean. */
  label: "fault" | "clean";
  /** The verdicts that cover the kind and judged this turn. */
  verdicts: VerdictAtTurn[];
}

/** Whether a verdict judged the turn of the stored game itself, not a planted variant, and gave an answer. */
function judgedTurn(verdict: StoredVerdict, game: string, sequence: number): boolean {
  const subject = verdict.subject;
  if (subject.side !== "game" || subject.game !== game || subject.variant !== null) return false;
  if (subject.sequence !== null && subject.sequence !== sequence) return false;
  return verdict.status === "pass" || verdict.status === "fail";
}

/** Whether any stored verdict judged the game itself: the precondition of a second pass. */
export function judgesGame(verdicts: readonly StoredVerdict[], game: string): boolean {
  return verdicts.some((verdict) => verdict.subject.side === "game" && verdict.subject.game === game && verdict.subject.variant === null);
}

/** Whether any stored verdict judged the game or one of its planted variants: the precondition of `--reported`. */
export function judgesGameOrVariant(verdicts: readonly StoredVerdict[], game: string): boolean {
  return verdicts.some((verdict) => verdict.subject.side === "game" && verdict.subject.game === game);
}

/**
 * The turns of a game some failing verdict's finding points at, on the game
 * itself or on one of its planted variants, a finding of either severity.
 * Findings on a passing or erroring verdict do not count: a judge stores minor
 * findings on most turns it passes. A variant's planted turns do not count
 * either: their faults are known.
 */
export function reportedTurns(verdicts: readonly StoredVerdict[], variants: readonly TruthTurnVariant[], game: string): Set<number> {
  const planted = new Map(variants.map((variant) => [variant.id, new Set(variant.plants.map((plant) => plant.sequence))]));
  const reported = new Set<number>();
  for (const verdict of verdicts) {
    const subject = verdict.subject;
    if (subject.side !== "game" || subject.game !== game || verdict.status !== "fail") continue;
    const known = subject.variant === null ? undefined : planted.get(subject.variant);
    for (const { sequence } of verdict.findings) {
      if (sequence !== null && !known?.has(sequence)) reported.add(sequence);
    }
  }
  return reported;
}

/**
 * The kinds whose judges report on nearly every turn they pass (the age judge
 * notes words and lengths a labeller has already read as fit), so a clean label
 * of them is not put to a second look.
 */
export const LABEL_STANDS_WHEN_CLEAN: readonly GameKind[] = ["not_age_fit"];

/** The disagreements on one turn, in the order of the kinds. */
export function disagreementsAt(game: string, labels: readonly Label[], verdicts: readonly StoredVerdict[], sequence: number): Disagreement[] {
  const label = latestLabel(labels, sequence);
  if (label === null) return [];
  const found: Disagreement[] = [];
  for (const kind of GAME_KINDS) {
    const covering = verdicts.filter((verdict) => judgedTurn(verdict, game, sequence) && findingsRow(verdict.judge).kinds.includes(kind));
    if (covering.length === 0) continue;
    const unit: TurnUnit = { side: "game", game, variant: null, sequence, kind };
    const labelled = label.faults.some((fault) => fault.kind === kind);
    if (!labelled && LABEL_STANDS_WHEN_CLEAN.includes(kind)) continue;
    if (covering.some((verdict) => catches(verdict, unit)) === labelled) continue;
    found.push({
      kind,
      label: labelled ? "fault" : "clean",
      verdicts: covering.map((verdict) => ({
        judge: verdict.judge,
        model: verdict.model,
        sample: verdict.sample,
        findings: verdict.findings.filter((finding) => finding.sequence === sequence && finding.kinds.includes(kind)),
      })),
    });
  }
  return found;
}

/** What the runs of one judge on one model said of a turn, for one kind. */
export interface JudgeTally {
  judge: string;
  model: string;
  /** The runs that judged the turn, by sample. */
  runs: VerdictAtTurn[];
  /** How many of them flagged it, and how many of those at most major or at most minor. */
  flagged: number;
  major: number;
  minor: number;
}

/**
 * A disagreement's runs, per judge and model in the order they first appear:
 * how many judged the turn, how many flagged it, and with what severity. A run
 * counts once, by its most severe finding at the turn; a run that judged the
 * turn and found nothing counts as judged, not flagged. A run's pass or fail
 * describes the whole game, so it is not part of the tally.
 */
export function tallyByJudge(verdicts: readonly VerdictAtTurn[]): JudgeTally[] {
  const tallies = new Map<string, JudgeTally>();
  for (const verdict of verdicts) {
    const key = JSON.stringify([verdict.judge, verdict.model]);
    const tally = tallies.get(key) ?? { judge: verdict.judge, model: verdict.model, runs: [], flagged: 0, major: 0, minor: 0 };
    tallies.set(key, tally);
    tally.runs.push(verdict);
    if (verdict.findings.length === 0) continue;
    tally.flagged += 1;
    if (verdict.findings.some((finding) => finding.severity === "major")) tally.major += 1;
    else tally.minor += 1;
  }
  for (const tally of tallies.values()) tally.runs.sort((a, b) => a.sample - b.sample);
  return [...tallies.values()];
}
