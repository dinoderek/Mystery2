/**
 * Compares two stored runs over the same subjects, with no model call.
 *
 * A **member** is one judge, paired by name across the runs, whatever model
 * each run holds it on; a judge that either run holds on more than one model
 * is one member per model, `<judge>@<model>`, so a member is compared with
 * itself. `onModel` keeps one model's verdicts of a run before pairing, so two
 * models in one file, or a model in each, compare by name. For each member and
 * kind, the units both runs judged are **paired**. A unit one run alone judged
 * is listed and never compared. Each run's call on
 * a unit is the score's: it catches when most of its judging samples do, and a
 * tie is not a catch (`score.ts`).
 *
 * The rules, each a decision `--help` repeats:
 *
 * - **A difference** is a paired unit one run catches and the other does not.
 * - **Variation.** A difference is **firm** only when each run's own samples
 *   are unanimous on that unit; when either run's samples disagree on it, the
 *   difference is no larger than what the run varies by, and is **within
 *   variation**. A unit on which either run has a single judging sample has no
 *   measure of its own variation: its difference is **unmeasured**.
 * - **The test.** Of the firm differences, `a` are units only A catches and `b`
 *   units only B catches. The exact two-sided sign test (McNemar's exact test)
 *   gives the chance of a split at least as uneven when each firm difference
 *   is equally likely to go either way. It is `differs` at 0.05 or less.
 * - **Unmeasured.** When either run has one sample on every paired unit of a
 *   kind, the kind's variation is unmeasured: the differences are listed and
 *   the outcome is `unmeasured`, never `differs`.
 * - **Delay and usage** are each run's own, per member, over the stored
 *   subjects (a game or variant, a base or plant) both runs judged that
 *   member on, as `score.ts` charges them.
 */

import { UsageError } from "../../core/errors.ts";
import { catches, findingsRow } from "./findings.ts";
import type { Unit } from "./findings.ts";
import type { Kind, Side } from "./kinds.ts";
import type { TruthSet } from "./loader.ts";
import {
  byCodePoint,
  chargesOf,
  delayOf,
  judged,
  judgesOnManyModels,
  majority,
  membersOf,
  unitsOf,
  usageOf,
} from "./score.ts";
import type { Charge, Member } from "./score.ts";
import type { StoredVerdict } from "./schemas.ts";
import { truthOf } from "./truth.ts";
import type { TruthValue } from "./truth.ts";

export const COMPARE_SCHEMA_VERSION = "mystery-truth-compare/1";

/** The paired test calls a difference at or below this chance. */
export const SIGNIFICANCE = 0.05;

/** The test, as `--help` and the report name it. */
export const TEST_NAME = "exact two-sided sign test (McNemar's exact test) on the firm differences";

export type Outcome =
  /** No paired unit differs. */
  | "same"
  /** Every difference is no larger than a run's own samples' disagreement. */
  | "within_variation"
  /** Firm differences, too few or too even to rule out chance. */
  | "not_shown"
  /** Firm differences the test calls: the runs differ. */
  | "differs"
  /** The variation is not measured, so no difference is called. */
  | "unmeasured"
  /** The runs share no unit of this member and kind. */
  | "no_paired_units";

export type Call = "firm" | "within_variation" | "unmeasured";

export interface Votes {
  /** Judging samples that catch the unit. */
  catches: number;
  /** Judging samples. */
  of: number;
}

export interface UnitDifference {
  unit: string;
  truth: TruthValue;
  a: Votes;
  b: Votes;
  /** Which run catches it. */
  catching: "a" | "b";
  call: Call;
}

export interface Agreement {
  /** Null when no paired unit had two or more judging samples: unmeasured, not 100%. */
  share: number | null;
  /** Paired units with two or more judging samples. */
  units: number;
}

export interface KindComparison {
  kind: Kind;
  paired: number;
  /** Paired units each run catches. */
  catches: { a: number; b: number };
  /** Paired units where the runs' calls differ, and which run catches. */
  differing: { a_only: number; b_only: number };
  firm: { a_only: number; b_only: number };
  within_variation: number;
  unmeasured: number;
  agreement: { a: Agreement; b: Agreement };
  /** The test's chance; null when it was not run: no firm difference, or the variation is unmeasured. */
  p: number | null;
  outcome: Outcome;
  /** Every difference, in the order of its unit. */
  differences: UnitDifference[];
  /** Units one run alone judged, left out of the comparison. */
  only_in: { a: string[]; b: string[] };
}

export interface RunCharge {
  model: string;
  /** Over the stored subjects both runs judged this member on; null when none, or a part is unknown. */
  delay_ms: number | null;
  usage_usd: number | null;
}

export interface MemberComparison {
  /** The judge's id, or `<judge>@<model>` when either run holds it on more than one model. */
  id: string;
  judge: string;
  a: RunCharge;
  b: RunCharge;
  kinds: KindComparison[];
}

export interface SideComparison {
  side: Side;
  members: MemberComparison[];
  /** Members only one run holds, left out of the comparison. */
  only_in: { a: string[]; b: string[] };
}

export interface CompareReport {
  schema_version: typeof COMPARE_SCHEMA_VERSION;
  rules: { catch: string; variation: string; test: string; significance: number };
  sides: SideComparison[];
}

// ---------------------------------------------------------------------------
// One model of a run

/** The verdicts of a run on `model`; a model the run holds no verdict on is a usage error naming the ones it holds. */
export function onModel(verdicts: readonly StoredVerdict[], model: string, run: string): StoredVerdict[] {
  const kept = verdicts.filter((verdict) => verdict.model === model);
  if (kept.length > 0) return kept;
  const held = [...new Set(verdicts.map((verdict) => verdict.model))].sort(byCodePoint);
  throw new UsageError(`${run} holds no verdict on model "${model}"; its models: ${held.length > 0 ? held.join(", ") : "none"}`);
}

// ---------------------------------------------------------------------------
// The test

function logFactorials(n: number): number[] {
  const table = [0];
  for (let index = 1; index <= n; index += 1) table.push(table[index - 1] + Math.log(index));
  return table;
}

/**
 * The exact two-sided sign test: with `a` firm differences for one run and `b`
 * for the other, the chance of a split at least this uneven if each were
 * equally likely to go either way. It is 1 with no differences.
 */
export function signTest(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const low = Math.min(a, b);
  const logs = logFactorials(n);
  let tail = 0;
  for (let k = 0; k <= low; k += 1) tail += Math.exp(logs[n] - logs[k] - logs[n - k] - n * Math.LN2);
  return Math.min(1, 2 * tail);
}

// ---------------------------------------------------------------------------
// One member in one run

interface UnitVotes {
  unit: Unit;
  /** Each judging sample's call on the unit. */
  votes: boolean[];
}

/**
 * A member's units by key: what its judging samples said, in sample order. A unit that
 * two stored subjects of one member both cover (a whole game and one of its turns) has the
 * samples of each, subject by subject.
 */
function votesOf(set: TruthSet, member: Member): Map<string, UnitVotes> {
  const units = new Map<string, UnitVotes>();
  for (const [, all] of [...member.bySubject].sort(([a], [b]) => byCodePoint(a, b))) {
    const voting = all.filter(judged).sort((x, y) => x.sample - y.sample);
    if (voting.length === 0) continue;
    for (const unit of unitsOf(set, voting[0].subject, member.kinds)) {
      const key = JSON.stringify(unit);
      const entry = units.get(key) ?? { unit, votes: [] };
      entry.votes.push(...voting.map((verdict) => catches(verdict, unit)));
      units.set(key, entry);
    }
  }
  return units;
}

// ---------------------------------------------------------------------------
// Kinds

function describeUnit(unit: Unit): string {
  if (unit.side === "blueprint") return unit.plant === null ? `blueprint ${unit.base}` : `blueprint ${unit.base}, plant ${unit.plant}`;
  const game = unit.variant === null ? `game ${unit.game}` : `game ${unit.game}, variant ${unit.variant}`;
  return `${game}, turn ${unit.sequence}`;
}

function votes(of: UnitVotes): Votes {
  return { catches: of.votes.filter(Boolean).length, of: of.votes.length };
}

function unanimous(of: UnitVotes): boolean {
  return of.votes.every((vote) => vote === of.votes[0]);
}

function agreementOf(measured: number, agreeing: number): Agreement {
  return { share: measured === 0 ? null : agreeing / measured, units: measured };
}

type UnitMap = Map<string, UnitVotes>;

function emptyKind(kind: Kind, a: UnitMap, b: UnitMap): KindComparison {
  const keys = (own: UnitMap) => new Set([...own].filter(([, entry]) => entry.unit.kind === kind).map(([key]) => key));
  const keysA = keys(a);
  const keysB = keys(b);
  const alone = (own: UnitMap, ours: Set<string>, theirs: Set<string>) =>
    [...ours]
      .filter((key) => !theirs.has(key))
      .sort(byCodePoint)
      .map((key) => describeUnit((own.get(key) as UnitVotes).unit));
  return {
    kind,
    paired: 0,
    catches: { a: 0, b: 0 },
    differing: { a_only: 0, b_only: 0 },
    firm: { a_only: 0, b_only: 0 },
    within_variation: 0,
    unmeasured: 0,
    agreement: { a: { share: null, units: 0 }, b: { share: null, units: 0 } },
    p: null,
    outcome: "no_paired_units",
    differences: [],
    only_in: { a: alone(a, keysA, keysB), b: alone(b, keysB, keysA) },
  };
}

/** How the run's own samples vary over the paired units: those with two or more samples, and those among them that agree. */
interface Variation {
  units: number;
  agreeing: number;
}

function noteVariation(tally: Variation, own: UnitVotes): void {
  if (own.votes.length < 2) return;
  tally.units += 1;
  if (unanimous(own)) tally.agreeing += 1;
}

/** Whether a difference on a unit is firm: each run's samples are measured there, and unanimous. */
function callOf(a: UnitVotes, b: UnitVotes): Call {
  if (a.votes.length < 2 || b.votes.length < 2) return "unmeasured";
  return unanimous(a) && unanimous(b) ? "firm" : "within_variation";
}

function recordDifference(set: TruthSet, result: KindComparison, a: UnitVotes, b: UnitVotes, catching: "a" | "b"): void {
  const call = callOf(a, b);
  const side = catching === "a" ? "a_only" : "b_only";
  result.differing[side] += 1;
  if (call === "firm") result.firm[side] += 1;
  else if (call === "within_variation") result.within_variation += 1;
  else result.unmeasured += 1;
  result.differences.push({ unit: describeUnit(a.unit), truth: truthOf(set, a.unit).truth, a: votes(a), b: votes(b), catching, call });
}

/**
 * The two runs' samples on a unit, cut to the first as many as both have. The sign test needs a
 * firm difference to be as likely one way as the other when the runs do not differ, and with
 * unequal counts the run with fewer samples is unanimous more often, so it would be the one
 * "catching" or "missing" by chance alone.
 */
function equalSamples(a: UnitVotes, b: UnitVotes): [UnitVotes, UnitVotes] {
  const count = Math.min(a.votes.length, b.votes.length);
  return [{ ...a, votes: a.votes.slice(0, count) }, { ...b, votes: b.votes.slice(0, count) }];
}

function compareKind(set: TruthSet, kind: Kind, a: UnitMap, b: UnitMap): KindComparison {
  const result = emptyKind(kind, a, b);
  const measuredA: Variation = { units: 0, agreeing: 0 };
  const measuredB: Variation = { units: 0, agreeing: 0 };
  const paired = [...a.keys()].filter((key) => b.has(key) && (a.get(key) as UnitVotes).unit.kind === kind).sort(byCodePoint);

  for (const key of paired) {
    const [unitA, unitB] = equalSamples(a.get(key) as UnitVotes, b.get(key) as UnitVotes);
    const callA = majority(unitA.votes);
    const callB = majority(unitB.votes);
    result.paired += 1;
    result.catches.a += Number(callA);
    result.catches.b += Number(callB);
    noteVariation(measuredA, unitA);
    noteVariation(measuredB, unitB);
    if (callA !== callB) recordDifference(set, result, unitA, unitB, callA ? "a" : "b");
  }

  result.agreement = { a: agreementOf(measuredA.units, measuredA.agreeing), b: agreementOf(measuredB.units, measuredB.agreeing) };
  return settle(result);
}

/** Sets the outcome, and the chance when the test was run. */
function settle(kind: KindComparison): KindComparison {
  const { firm } = kind;
  if (kind.paired === 0) return { ...kind, outcome: "no_paired_units" };
  if (kind.differing.a_only + kind.differing.b_only === 0) return { ...kind, outcome: "same" };
  // Each run needs a paired unit it judged more than once for its own variation to be measured at all.
  if (kind.agreement.a.units === 0 || kind.agreement.b.units === 0) return { ...kind, outcome: "unmeasured" };
  if (firm.a_only + firm.b_only === 0) return { ...kind, outcome: kind.within_variation > 0 ? "within_variation" : "unmeasured" };
  const p = signTest(firm.a_only, firm.b_only);
  return { ...kind, p, outcome: p <= SIGNIFICANCE ? "differs" : "not_shown" };
}

// ---------------------------------------------------------------------------
// Members and sides

function chargeOf(member: Member, shared: ReadonlySet<string>): RunCharge {
  const own = new Map([...chargesOf(member)].filter(([key]) => shared.has(key)));
  return {
    model: member.model,
    delay_ms: shared.size === 0 ? null : delayOf([own]),
    usage_usd: shared.size === 0 ? null : usageOf([own]),
  };
}

function compareMember(set: TruthSet, a: Member, b: Member): MemberComparison {
  const chargesA: Map<string, Charge> = chargesOf(a);
  const chargesB: Map<string, Charge> = chargesOf(b);
  const shared = new Set([...chargesA.keys()].filter((key) => chargesB.has(key)));
  const unitsA = votesOf(set, a);
  const unitsB = votesOf(set, b);
  return {
    id: a.id,
    judge: a.judge,
    a: chargeOf(a, shared),
    b: chargeOf(b, shared),
    kinds: findingsRow(a.judge).kinds.map((kind) => compareKind(set, kind, unitsA, unitsB)),
  };
}

function compareSide(set: TruthSet, side: Side, a: readonly StoredVerdict[], b: readonly StoredVerdict[]): SideComparison | null {
  const split = new Set([...judgesOnManyModels(a), ...judgesOnManyModels(b)]);
  const membersA = membersOf(side, a, split);
  const membersB = membersOf(side, b, split);
  if (membersA.length === 0 && membersB.length === 0) return null;
  const idsB = new Set(membersB.map((member) => member.id));
  const idsA = new Set(membersA.map((member) => member.id));
  return {
    side,
    members: membersA
      .filter((member) => idsB.has(member.id))
      .map((member) => compareMember(set, member, membersB.find((other) => other.id === member.id) as Member)),
    only_in: {
      a: membersA.filter((member) => !idsB.has(member.id)).map((member) => member.id),
      b: membersB.filter((member) => !idsA.has(member.id)).map((member) => member.id),
    },
  };
}

/** Compares run `a` with run `b`, each already checked against `set`, on each side either judged: blueprint first, then game. */
export function compareRuns(set: TruthSet, a: readonly StoredVerdict[], b: readonly StoredVerdict[]): CompareReport {
  const order: readonly Side[] = ["blueprint", "game"];
  return {
    schema_version: COMPARE_SCHEMA_VERSION,
    rules: {
      catch: "a run catches a unit when most of its judging samples do; a tie is not a catch",
      variation:
        "a difference is firm only when each run's own samples are unanimous on the unit; one run's samples disagreeing makes it within variation; a single judging sample in either run leaves it unmeasured",
      test: TEST_NAME,
      significance: SIGNIFICANCE,
    },
    sides: order.map((side) => compareSide(set, side, a, b)).filter((side): side is SideComparison => side !== null),
  };
}
