/**
 * Which findings of which judge count as catching which kind, and the catch
 * rule that scores a stored verdict against one unit of the truth set.
 *
 * Every judge in the registry has one row. A row names the side the judge
 * scores on, the kinds its findings count as, and how its answer is read:
 *
 * - `each_finding`: every finding in the answer is one finding, pointing at the
 *   turn its `sequence` names (or, for a judge of one turn, that turn), with
 *   its own severity. A `fail` with no finding counts as one `major` finding.
 * - `fail_only`: the answer has no findings in the kind vocabulary, so its
 *   `fail` counts as one `major` finding on the subject, of the row's kinds.
 */

import { getEntry } from "../../core/registry.ts";
import type { Verdict } from "../../core/result.ts";
import type { BlueprintKind, GameKind, Kind, Severity, Side } from "./kinds.ts";
import type { StoredFinding, StoredVerdict } from "./schemas.ts";

export interface FindingsRow {
  side: Side;
  /** The kinds each of its findings counts as: the judge's own first, then any further. */
  kinds: readonly Kind[];
  read: "each_finding" | "fail_only";
}

function gameRow(kind: GameKind): FindingsRow {
  return { side: "game", kinds: [kind], read: "each_finding" };
}

function blueprintRow(kind: BlueprintKind): FindingsRow {
  return { side: "blueprint", kinds: [kind], read: "fail_only" };
}

/** One row per judge, by judge id. */
export const FINDINGS_TABLE: Readonly<Record<string, FindingsRow>> = {
  solve_depth: blueprintRow("solve_depth"),
  fairness: blueprintRow("fairness"),
  timeline_coherence: blueprintRow("timeline_coherence"),
  knowledge_coherence: blueprintRow("knowledge_coherence"),
  character_grounding: blueprintRow("character_grounding"),
  path_payoff: blueprintRow("path_payoff"),
  clue_graph: blueprintRow("clue_graph"),
  age_appropriate: blueprintRow("age_appropriate"),

  gm_roleplay: gameRow("out_of_character"),
  gm_clue_discipline: gameRow("clue_handling"),
  gm_fabrication: gameRow("fabrication"),
  gm_spoiler: gameRow("spoiler"),
  age_appropriate_turn: gameRow("not_age_fit"),
};

/** The row for a judge; throws, naming it, when the registry has no such judge or the table no row. */
export function findingsRow(judge: string): FindingsRow {
  const entry = getEntry(judge);
  if (entry.type !== "judge") throw new Error(`"${judge}" is a check, not a judge; only judges are scored`);
  const row = FINDINGS_TABLE[judge];
  if (!row) throw new Error(`the findings table has no row for judge "${judge}" (evaluation/lib/truth/findings.ts)`);
  return row;
}

interface AnswerFinding {
  sequence?: unknown;
  severity?: unknown;
  kind?: unknown;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function eachFinding(raw: unknown[], row: FindingsRow, turn: number | null, failed: boolean): StoredFinding[] {
  const findings = raw.filter(isObject).map((item: AnswerFinding): StoredFinding => {
    const ownSequence = Number.isInteger(item.sequence) ? (item.sequence as number) : null;
    // An answer without its own severities (the age judge's) takes its verdict's.
    const fallback: Severity = failed ? "major" : "minor";
    return {
      // A judge of one turn points every finding at that turn.
      sequence: turn ?? ownSequence,
      kinds: [...row.kinds],
      severity: item.severity === "major" || item.severity === "minor" ? item.severity : fallback,
      judge_kind: typeof item.kind === "string" ? item.kind : null,
    };
  });
  if (failed && !findings.some((finding) => finding.severity === "major")) {
    findings.push({ sequence: turn, kinds: [...row.kinds], severity: "major", judge_kind: null });
  }
  return findings;
}

/**
 * The findings of a judge's verdict as `result.json` stores it, with their
 * kinds. Only judges are scored: a check's or an analyzer's verdict throws.
 * `turn` is the turn a judge of one turn judged; null for a judge of a whole
 * game or of a blueprint. A verdict that is not `pass` or `fail` has none.
 */
export function kindedFindings(verdict: Pick<Verdict, "id" | "status" | "findings">, turn: number | null): StoredFinding[] {
  const row = findingsRow(verdict.id);
  if (verdict.status !== "pass" && verdict.status !== "fail") return [];
  const failed = verdict.status === "fail";
  if (row.read === "fail_only") {
    return failed ? [{ sequence: null, kinds: [...row.kinds], severity: "major", judge_kind: null }] : [];
  }
  return eachFinding(verdict.findings ?? [], row, turn, failed);
}

/** One turn of a stored game or of one of its variants, for one kind. */
export interface TurnUnit {
  side: "game";
  game: string;
  variant: string | null;
  sequence: number;
  kind: GameKind;
}

/** A base blueprint or one planted fault on it, for one kind. */
export interface BlueprintUnit {
  side: "blueprint";
  base: string;
  plant: string | null;
  kind: BlueprintKind;
}

export type Unit = TurnUnit | BlueprintUnit;

function sameSubject(verdict: StoredVerdict, unit: Unit): boolean {
  const subject = verdict.subject;
  if (subject.side === "game" && unit.side === "game") {
    return subject.game === unit.game && subject.variant === unit.variant && (subject.sequence ?? unit.sequence) === unit.sequence;
  }
  if (subject.side === "blueprint" && unit.side === "blueprint") {
    return subject.base === unit.base && subject.plant === unit.plant;
  }
  return false;
}

/**
 * The catch rule: a verdict catches a unit when it judged the unit's subject
 * and one of its findings points at the unit's turn (on the game side) with a
 * kind the table maps to the unit's kind.
 */
export function catches(verdict: StoredVerdict, unit: Unit): boolean {
  if (!sameSubject(verdict, unit)) return false;
  return verdict.findings.some(
    (finding) => finding.kinds.includes(unit.kind) && (unit.side === "blueprint" || finding.sequence === unit.sequence),
  );
}
