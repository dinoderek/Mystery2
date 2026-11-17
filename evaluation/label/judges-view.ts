/**
 * Pass 2's question on one turn: which faults are true here. The candidates
 * are every kind the turn's latest label names or some judge run flagged at the
 * turn, each with who named it. Scoring reads a turn's label per kind
 * (`evaluation/truth/README.md`), so a candidate is a kind, and keeping it
 * keeps that kind as a fault. A kind in `LABEL_STANDS_WHEN_CLEAN` that the
 * label calls clean is not offered: the labeller's reading stands.
 */

import { catches, findingsRow } from "../lib/truth/findings.ts";
import type { TurnUnit } from "../lib/truth/findings.ts";
import { GAME_KINDS } from "../lib/truth/kinds.ts";
import type { GameKind, Severity } from "../lib/truth/kinds.ts";
import type { Label, StoredFinding, StoredVerdict } from "../lib/truth/schemas.ts";
import { latestLabel } from "../lib/truth/truth.ts";
import { judgedTurn, LABEL_STANDS_WHEN_CLEAN } from "./disagreements.ts";

/** A fault as the form holds it. */
export interface KeepFault {
  kind: GameKind;
  severity: Severity;
  note: string;
}

/** One judge on one model, on one kind at this turn: how many of its judging runs flagged it, and one reason. */
export interface JudgeSource {
  judge: string;
  model: string;
  judged: number;
  flagged: number;
  /** The severity most of its flagging runs gave it (a tie is major); null when none flagged it. */
  severity: Severity | null;
  /** One flagging run's reason; null when none flagged it or none gave one. */
  why: string | null;
}

/** A kind to keep or not: the label's own fault of it, and every judge that covers it here. */
export interface KeepCandidate {
  kind: GameKind;
  /** The latest label's fault of this kind, ticked to start with; null when the label calls it clean. */
  yours: KeepFault | null;
  judges: JudgeSource[];
  /** What keeping it adds to the form: the label's own fault, else the judges' severity and a reason. */
  fault: KeepFault;
}

export interface TurnComparison {
  /** Which pass gave the latest label. */
  pass: 1 | 2;
  /** In the order of the kinds. */
  candidates: KeepCandidate[];
}

/** A run's finding of `kind` at `sequence` that weighs most: its first major, else its first. */
function weightiest(verdict: StoredVerdict, kind: GameKind, sequence: number): StoredFinding | null {
  const own = verdict.findings.filter((finding) => finding.sequence === sequence && finding.kinds.includes(kind));
  return own.find((finding) => finding.severity === "major") ?? own[0] ?? null;
}

/** The severity most of `severities` are, a tie major; null for none. */
function mostSevere(severities: readonly (Severity | null)[]): Severity | null {
  if (severities.length === 0) return null;
  return severities.filter((severity) => severity === "major").length * 2 >= severities.length ? "major" : "minor";
}

function judgeSources(game: string, verdicts: readonly StoredVerdict[], sequence: number, kind: GameKind): JudgeSource[] {
  const unit: TurnUnit = { side: "game", game, variant: null, sequence, kind };
  const byMember = new Map<string, StoredVerdict[]>();
  for (const verdict of verdicts) {
    if (!judgedTurn(verdict, game, sequence) || !findingsRow(verdict.judge).kinds.includes(kind)) continue;
    const key = JSON.stringify([verdict.judge, verdict.model]);
    byMember.set(key, [...(byMember.get(key) ?? []), verdict]);
  }
  return [...byMember.values()].map((runs) => {
    const found = runs
      .filter((verdict) => catches(verdict, unit))
      .sort((a, b) => a.sample - b.sample)
      .map((verdict) => weightiest(verdict, kind, sequence))
      .filter((finding): finding is StoredFinding => finding !== null);
    const severity = mostSevere(found.map((finding) => finding.severity));
    const why = (found.find((finding) => finding.severity === severity && finding.why) ?? found.find((finding) => finding.why))?.why ?? null;
    return { judge: runs[0].judge, model: runs[0].model, judged: runs.length, flagged: found.length, severity, why };
  });
}

/** What keeping a kind no label names adds: the severity most flagging judges give it, and the first reason. */
function judgesFault(kind: GameKind, judges: readonly JudgeSource[]): KeepFault {
  const flagging = judges.filter((source) => source.flagged > 0);
  const severity = mostSevere(flagging.map((source) => source.severity)) ?? "minor";
  const reason = flagging.find((source) => source.why !== null);
  return { kind, severity, note: reason?.why ?? `${flagging[0]?.judge ?? "a judge"} flagged ${kind.replace(/_/g, " ")} here` };
}

/** The question on one turn; null when the turn has no label yet. */
export function compareTurn(game: string, labels: readonly Label[], verdicts: readonly StoredVerdict[], sequence: number): TurnComparison | null {
  const label = latestLabel(labels, sequence);
  if (label === null) return null;
  const candidates: KeepCandidate[] = [];
  for (const kind of GAME_KINDS) {
    const own = label.faults.find((fault) => fault.kind === kind);
    const yours = own ? { kind, severity: own.severity, note: own.note } : null;
    if (yours === null && LABEL_STANDS_WHEN_CLEAN.includes(kind)) continue;
    const judges = judgeSources(game, verdicts, sequence, kind);
    if (yours === null && !judges.some((source) => source.flagged > 0)) continue;
    candidates.push({ kind, yours, judges, fault: yours ?? judgesFault(kind, judges) });
  }
  return { pass: label.pass, candidates };
}
