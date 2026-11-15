/**
 * Where a judge and a label disagree, for the labelling page's second pass.
 *
 * Per turn and kind, over every stored sample: a catch on a turn the label
 * calls clean for that kind, or a labelled fault no sample caught. A turn with
 * no label is unknown, and a kind no stored judge covered has nothing to
 * disagree with, so neither counts.
 */

import { catches, findingsRow } from "../lib/truth/findings.ts";
import type { TurnUnit } from "../lib/truth/findings.ts";
import { GAME_KINDS } from "../lib/truth/kinds.ts";
import type { GameKind } from "../lib/truth/kinds.ts";
import type { Label, StoredFinding, StoredVerdict } from "../lib/truth/schemas.ts";
import { latestLabel } from "../lib/truth/truth.ts";

export interface VerdictAtTurn {
  judge: string;
  model: string;
  sample: number;
  status: StoredVerdict["status"];
  /** What it found at this turn; empty when it judged the turn and found nothing. */
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
    if (covering.some((verdict) => catches(verdict, unit)) === labelled) continue;
    found.push({
      kind,
      label: labelled ? "fault" : "clean",
      verdicts: covering.map((verdict) => ({
        judge: verdict.judge,
        model: verdict.model,
        sample: verdict.sample,
        status: verdict.status,
        findings: verdict.findings.filter((finding) => finding.sequence === sequence),
      })),
    });
  }
  return found;
}
