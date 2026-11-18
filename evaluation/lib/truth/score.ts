/**
 * Scores stored verdicts against the truth set, with no model call.
 *
 * A **member** is one judge on one model; the same judge on two models is two
 * members. On each side (blueprint, game) it reports per member and kind:
 *
 * - of the units it reported, the share that are real faults; of the real
 *   faults it judged, the share it found; each with a 95% Wilson range. Units
 *   of unknown truth are left out of both and counted apart.
 * - how often its samples agree.
 *
 * Then it scores every subset of the side's members from the same verdicts and
 * names the smallest that meets the bar.
 *
 * The rules, each a decision `--help` repeats:
 *
 * - **Reports.** A finding of either severity is a report. The same shares
 *   counting only `major` findings are reported beside.
 * - **Samples.** Only a sample that judged (`pass` or `fail`) votes. A member
 *   catches a unit when most of its judging samples catch it; a tie is not a
 *   catch. Agreement is the share of units, among those with two or more
 *   judging samples, on which every one says the same; with none, unmeasured.
 * - **A subset** catches the union of what its members catch. The full
 *   battery is every member present on the side.
 * - **Delay** of a set: for each stored subject (a game or variant; a base or
 *   plant), the slowest member's time, summed over subjects. A member's time on
 *   a subject is the sum of its verdicts' durations there (a turn judge has one
 *   per turn), averaged over its samples. **Usage** is the members' reported
 *   costs, summed the same way. Either is unknown when any verdict it sums is.
 * - **The smallest set**: fewest members, then the shorter delay, then the
 *   lower usage; an unknown delay or usage loses to a known one.
 * - **Stale.** Only a verdict at its judge's current version
 *   (`core/judge-version.ts`), on its subject as the truth set holds it now
 *   (`subject-hash.ts`), is scored; the rest are counted apart as stale.
 * - **Unmeasured.** A judge's games and variants, or bases and plants, with
 *   no current verdict are listed by name: a new plant is unmeasured until
 *   its suite runs again.
 */

import { InputError } from "../../core/errors.ts";
import { judgeVersions } from "../../core/judge-version.ts";
import { playedEvents } from "../game-events.ts";
import { catches, findingsRow } from "./findings.ts";
import type { Unit } from "./findings.ts";
import type { BlueprintKind, GameKind, Kind, Side } from "./kinds.ts";
import type { TruthSet } from "./loader.ts";
import type { StoredSubject, StoredVerdict } from "./schemas.ts";
import { subjectHasher } from "./subject-hash.ts";
import { truthOf } from "./truth.ts";
import type { TruthValue } from "./truth.ts";
import { wilson } from "./wilson.ts";
import type { Share } from "./wilson.ts";

export const SCORE_SCHEMA_VERSION = "mystery-truth-score/3";

/** Every subset of a side is scored; past this many members that is too many. */
export const MAX_MEMBERS_PER_SIDE = 16;

export type Bar = { kind: "lose_nothing" } | { kind: "min_found"; share: number };

export const LOSE_NOTHING: Bar = { kind: "lose_nothing" };

/** The bar in words, as the table and the report say it. */
export function describeBar(bar: Bar): string {
  return bar.kind === "lose_nothing"
    ? "loses no fault the full battery catches"
    : `finds at least ${bar.share} of the real faults on its side`;
}

export interface Counts {
  fault: number;
  clean: number;
  unknown: number;
}

export interface Shares {
  /** Of the units reported, how many are real: hits are real faults, `of` real and clean. */
  real_of_reported: Share;
  /** Of the real faults judged, how many were reported. */
  found_of_real: Share;
  /** Reported units whose truth is unknown, left out of both shares. */
  unknown_reported: number;
}

export interface KindScore {
  kind: Kind;
  /** The units judged, by truth. */
  units: Counts;
  shares: Shares;
  /** The same, counting only `major` findings. */
  major_only: Shares;
  /** Null when no unit had two or more judging samples: unmeasured, not 100%. */
  agreement: { share: number | null; units: number };
}

export interface MemberScore {
  /** The judge's id, or `<judge>@<model>` when the judge is present on more than one model. */
  id: string;
  judge: string;
  /** The judge's version its verdicts were reached at. */
  version: number;
  model: string;
  verdicts: number;
  /** Verdicts that are not `pass` or `fail`, which do not vote. */
  not_judged: number;
  /** The most samples on any one subject. */
  samples: number;
  /** Findings of a game judge that point at no turn of what it judged, so catch nothing. */
  findings_off_turn: number;
  /** The truth set's games and variants, or bases and plants, it holds no current verdict on: unmeasured. */
  unjudged: string[];
  delay_ms: number | null;
  usage_usd: number | null;
  kinds: KindScore[];
}

export interface SubsetScore {
  members: string[];
  /** Real faults caught, of the side's `faults`. */
  found: number;
  found_by_kind: Partial<Record<Kind, number>>;
  /** Clean units reported. */
  false_reports: number;
  delay_ms: number | null;
  usage_usd: number | null;
  meets_bar: boolean;
}

export interface SideScore {
  side: Side;
  members: MemberScore[];
  /** Real faults judged by any member. */
  faults: number;
  /** Real faults the full battery catches. */
  full_found: number;
  /** Every subset, by size, then by member order. */
  subsets: SubsetScore[];
  /** The smallest subset that meets the bar; null when none does. */
  smallest: SubsetScore | null;
}

/**
 * Verdicts left unscored: `judge` when their judge has moved on from the
 * version that reached them, `subject` when only the subject they judged has
 * changed since.
 */
export interface StaleVerdicts {
  judge: string;
  model: string;
  /** The version that reached them. */
  version: number;
  /** The judge's version now; null when its files match no recorded version. */
  current: number | null;
  reason: "judge" | "subject";
  verdicts: number;
}

export interface ScoreReport {
  schema_version: typeof SCORE_SCHEMA_VERSION;
  rules: { reports: string; catch: string; stale: string; bar: Bar & { text: string } };
  sides: SideScore[];
  /** By judge, model and version, the verdicts not scored; empty when every verdict is current. */
  stale: StaleVerdicts[];
}

// ---------------------------------------------------------------------------
// Units

/** One judge on one model, with its verdicts by stored subject. */
export interface Member {
  id: string;
  judge: string;
  version: number;
  model: string;
  kinds: readonly Kind[];
  /** Its verdicts, by stored subject. */
  bySubject: Map<string, StoredVerdict[]>;
}

interface UnitInfo {
  key: string;
  kind: Kind;
  truth: TruthValue;
}

export function subjectKey(subject: StoredSubject): string {
  return JSON.stringify(subject);
}

/** Where a verdict's time and cost are charged: the game or variant, or the base or plant, it judged. */
export function chargeKey(subject: StoredSubject): string {
  return subject.side === "game" ? JSON.stringify([subject.game, subject.variant]) : JSON.stringify([subject.base, subject.plant]);
}

function turnsOf(set: TruthSet, subject: StoredSubject): number[] {
  if (subject.side !== "game") return [];
  if (subject.sequence !== null) return [subject.sequence];
  const game = set.games.find((candidate) => candidate.id === subject.game);
  if (!game) throw new InputError(`no stored game "${subject.game}"`);
  return playedEvents(game.trace.events).map((event) => event.sequence);
}

export function unitsOf(set: TruthSet, subject: StoredSubject, kinds: readonly Kind[]): Unit[] {
  if (subject.side === "blueprint") {
    return kinds.map((kind): Unit => ({ side: "blueprint", base: subject.base, plant: subject.plant, kind: kind as BlueprintKind }));
  }
  return turnsOf(set, subject).flatMap((sequence) =>
    kinds.map((kind): Unit => ({ side: "game", game: subject.game, variant: subject.variant, sequence, kind: kind as GameKind })),
  );
}

/** Orders strings by code point, never by locale, so the report is the same on every machine. */
export function byCodePoint(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function judged(verdict: StoredVerdict): boolean {
  return verdict.status === "pass" || verdict.status === "fail";
}

function majorOnly(verdict: StoredVerdict): StoredVerdict {
  return { ...verdict, findings: verdict.findings.filter((finding) => finding.severity === "major") };
}

export function majority(votes: readonly boolean[]): boolean {
  return votes.filter(Boolean).length * 2 > votes.length;
}

// ---------------------------------------------------------------------------
// One member

interface Tally {
  units: Counts;
  reported: Counts;
  major: Counts;
  agreeing: number;
  measured: number;
}

function emptyCounts(): Counts {
  return { fault: 0, clean: 0, unknown: 0 };
}

function shares(reported: Counts, units: Counts): Shares {
  return {
    real_of_reported: wilson(reported.fault, reported.fault + reported.clean),
    found_of_real: wilson(reported.fault, units.fault),
    unknown_reported: reported.unknown,
  };
}

interface MemberRun {
  score: Omit<MemberScore, "delay_ms" | "usage_usd" | "unjudged">;
  /** The keys of the units it catches. */
  caught: Set<string>;
  units: UnitInfo[];
}

function offTurn(set: TruthSet, subject: StoredSubject, verdicts: readonly StoredVerdict[]): number {
  if (subject.side !== "game") return 0;
  const turns = new Set(turnsOf(set, subject));
  return verdicts.reduce((sum, verdict) => sum + verdict.findings.filter((f) => f.sequence === null || !turns.has(f.sequence)).length, 0);
}

function tallyUnit(tally: Tally, truth: TruthValue, votes: boolean[], majorVotes: boolean[]): boolean {
  tally.units[truth] += 1;
  const caught = majority(votes);
  if (caught) tally.reported[truth] += 1;
  if (majority(majorVotes)) tally.major[truth] += 1;
  if (votes.length >= 2) {
    tally.measured += 1;
    if (votes.every((vote) => vote === votes[0])) tally.agreeing += 1;
  }
  return caught;
}

function scoreMember(set: TruthSet, member: Member): MemberRun {
  const tallies = new Map<Kind, Tally>(
    member.kinds.map((kind) => [kind, { units: emptyCounts(), reported: emptyCounts(), major: emptyCounts(), agreeing: 0, measured: 0 }]),
  );
  const caught = new Set<string>();
  const units: UnitInfo[] = [];
  let verdicts = 0;
  let notJudged = 0;
  let samples = 0;
  let findingsOffTurn = 0;
  for (const [, all] of [...member.bySubject].sort(([a], [b]) => byCodePoint(a, b))) {
    verdicts += all.length;
    samples = Math.max(samples, all.length);
    const voting = all.filter(judged);
    notJudged += all.length - voting.length;
    if (voting.length === 0) continue;
    const subject = voting[0].subject;
    findingsOffTurn += offTurn(set, subject, voting);
    const major = voting.map(majorOnly);
    for (const unit of unitsOf(set, subject, member.kinds)) {
      const key = JSON.stringify(unit);
      const truth = truthOf(set, unit).truth;
      const tally = tallies.get(unit.kind) as Tally;
      const votes = voting.map((verdict) => catches(verdict, unit));
      if (tallyUnit(tally, truth, votes, major.map((verdict) => catches(verdict, unit)))) caught.add(key);
      units.push({ key, kind: unit.kind, truth });
    }
  }
  const kinds = member.kinds.map((kind): KindScore => {
    const tally = tallies.get(kind) as Tally;
    return {
      kind,
      units: tally.units,
      shares: shares(tally.reported, tally.units),
      major_only: shares(tally.major, tally.units),
      agreement: { share: tally.measured === 0 ? null : tally.agreeing / tally.measured, units: tally.measured },
    };
  });
  return {
    score: { id: member.id, judge: member.judge, version: member.version, model: member.model, verdicts, not_judged: notJudged, samples, findings_off_turn: findingsOffTurn, kinds },
    caught,
    units,
  };
}

// ---------------------------------------------------------------------------
// Delay and usage

export interface Charge {
  time: number | null;
  cost: number | null;
}

export function sumOrNull(values: readonly (number | null)[]): number | null {
  let total = 0;
  for (const value of values) {
    if (value === null) return null;
    total += value;
  }
  return total;
}

function mean(values: readonly (number | null)[]): number | null {
  const total = sumOrNull(values);
  return total === null ? null : total / values.length;
}

/** A member's time and cost on each stored subject: summed within a sample, averaged over samples. */
export function chargesOf(member: Member): Map<string, Charge> {
  const bySample = new Map<string, Map<number, StoredVerdict[]>>();
  for (const verdicts of member.bySubject.values()) {
    for (const verdict of verdicts) {
      const key = chargeKey(verdict.subject);
      const samples = bySample.get(key) ?? new Map<number, StoredVerdict[]>();
      samples.set(verdict.sample, [...(samples.get(verdict.sample) ?? []), verdict]);
      bySample.set(key, samples);
    }
  }
  const charges = new Map<string, Charge>();
  for (const key of [...bySample.keys()].sort()) {
    const samples = [...(bySample.get(key) as Map<number, StoredVerdict[]>)].sort(([a], [b]) => a - b).map(([, verdicts]) => verdicts);
    charges.set(key, {
      time: mean(samples.map((verdicts) => sumOrNull(verdicts.map((verdict) => verdict.duration_ms)))),
      cost: mean(samples.map((verdicts) => sumOrNull(verdicts.map((verdict) => verdict.cost_usd)))),
    });
  }
  return charges;
}

/** The delay of a set: per stored subject the slowest member, summed. */
export function delayOf(charges: readonly Map<string, Charge>[]): number | null {
  const keys = [...new Set(charges.flatMap((member) => [...member.keys()]))].sort();
  let total = 0;
  for (const key of keys) {
    let slowest = 0;
    for (const member of charges) {
      const charge = member.get(key);
      if (!charge) continue;
      if (charge.time === null) return null;
      slowest = Math.max(slowest, charge.time);
    }
    total += slowest;
  }
  return total;
}

export function usageOf(charges: readonly Map<string, Charge>[]): number | null {
  return sumOrNull(charges.flatMap((member) => [...member.values()].map((charge) => charge.cost)));
}

// ---------------------------------------------------------------------------
// Subsets

interface SideUnits {
  /** Each unit of known truth judged by any member, with the members that catch it as a bit mask. */
  faults: { kind: Kind; mask: number }[];
  clean: { mask: number }[];
}

function sideUnits(runs: readonly MemberRun[]): SideUnits {
  const seen = new Map<string, UnitInfo & { mask: number }>();
  runs.forEach((run, index) => {
    for (const unit of run.units) {
      const entry = seen.get(unit.key) ?? { ...unit, mask: 0 };
      if (run.caught.has(unit.key)) entry.mask |= 1 << index;
      seen.set(unit.key, entry);
    }
  });
  const ordered = [...seen.values()].sort((a, b) => byCodePoint(a.key, b.key));
  return {
    faults: ordered.filter((unit) => unit.truth === "fault").map((unit) => ({ kind: unit.kind, mask: unit.mask })),
    clean: ordered.filter((unit) => unit.truth === "clean").map((unit) => ({ mask: unit.mask })),
  };
}

function bitsOf(mask: number, size: number): number[] {
  const bits = [];
  for (let index = 0; index < size; index += 1) if (mask & (1 << index)) bits.push(index);
  return bits;
}

function compareIndices(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return a.length - b.length;
  for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function meetsBar(bar: Bar, found: number, fullFound: number, faults: number): boolean {
  if (bar.kind === "lose_nothing") return found === fullFound;
  return faults === 0 || found / faults >= bar.share;
}

/** Known beats unknown; then the smaller. */
function compareKnown(a: number | null, b: number | null): number {
  if (a === null || b === null) return (a === null ? 1 : 0) - (b === null ? 1 : 0);
  return a - b;
}

function smallestOf(subsets: readonly SubsetScore[]): SubsetScore | null {
  const meeting = subsets.filter((subset) => subset.meets_bar);
  // Stable: ties beyond usage keep the listing's order.
  return (
    [...meeting].sort(
      (a, b) => a.members.length - b.members.length || compareKnown(a.delay_ms, b.delay_ms) || compareKnown(a.usage_usd, b.usage_usd),
    )[0] ?? null
  );
}

function scoreSubsets(members: readonly Member[], runs: readonly MemberRun[], bar: Bar): Omit<SideScore, "side" | "members"> {
  const units = sideUnits(runs);
  const charges = members.map(chargesOf);
  const full = (1 << members.length) - 1;
  const foundBy = (mask: number) => units.faults.filter((unit) => unit.mask & mask);
  const fullFound = foundBy(full).length;
  const masks = Array.from({ length: full + 1 }, (_, mask) => ({ mask, picked: bitsOf(mask, members.length) })).sort((a, b) =>
    compareIndices(a.picked, b.picked),
  );
  const subsets = masks.map(({ mask, picked }): SubsetScore => {
    const found = foundBy(mask);
    const found_by_kind: Partial<Record<Kind, number>> = {};
    for (const unit of found) found_by_kind[unit.kind] = (found_by_kind[unit.kind] ?? 0) + 1;
    return {
      members: picked.map((index) => members[index].id),
      found: found.length,
      found_by_kind,
      false_reports: units.clean.filter((unit) => unit.mask & mask).length,
      delay_ms: delayOf(picked.map((index) => charges[index])),
      usage_usd: usageOf(picked.map((index) => charges[index])),
      meets_bar: meetsBar(bar, found.length, fullFound, units.faults.length),
    };
  });
  return { faults: units.faults.length, full_found: fullFound, subsets, smallest: smallestOf(subsets) };
}

// ---------------------------------------------------------------------------
// Sides

/** The judges that appear on more than one model: each model of such a judge is a member of its own. */
export function judgesOnManyModels(verdicts: readonly StoredVerdict[]): Set<string> {
  const models = new Map<string, Set<string>>();
  for (const verdict of verdicts) models.set(verdict.judge, (models.get(verdict.judge) ?? new Set()).add(verdict.model));
  return new Set([...models].filter(([, own]) => own.size > 1).map(([judge]) => judge));
}

/**
 * The members of one side, by id. A judge in `split` is one member per model,
 * `<judge>@<model>`. A member is one version of its judge: verdicts of one
 * member at two versions are refused, since they judged by different rules.
 */
export function membersOf(side: Side, verdicts: readonly StoredVerdict[], split: ReadonlySet<string> = judgesOnManyModels(verdicts)): Member[] {
  const members = new Map<string, Member>();
  for (const verdict of verdicts.filter((candidate) => candidate.subject.side === side)) {
    const id = split.has(verdict.judge) ? `${verdict.judge}@${verdict.model}` : verdict.judge;
    const member = members.get(id) ?? {
      id,
      judge: verdict.judge,
      version: verdict.judge_version,
      model: verdict.model,
      kinds: findingsRow(verdict.judge).kinds,
      bySubject: new Map(),
    };
    if (member.version !== verdict.judge_version) {
      throw new InputError(`${id} has verdicts at versions ${member.version} and ${verdict.judge_version}; keep one version of a judge in what is read together`);
    }
    const key = subjectKey(verdict.subject);
    member.bySubject.set(key, [...(member.bySubject.get(key) ?? []), verdict]);
    members.set(id, member);
  }
  return [...members.values()].sort((a, b) => byCodePoint(a.id, b.id));
}

/** Every game and variant, or base and plant, of the truth set, keyed as `chargeKey` keys a verdict's subject. */
function sideSubjects(set: TruthSet, side: Side): Array<{ id: string; key: string }> {
  if (side === "game") {
    return [
      ...set.games.map((game) => ({ id: game.id, key: chargeKey({ side, game: game.id, variant: null, sequence: null }) })),
      ...set.turnVariants.map((variant) => ({ id: variant.id, key: chargeKey({ side, game: variant.game, variant: variant.id, sequence: null }) })),
    ];
  }
  return [
    ...set.bases.map((base) => ({ id: base.id, key: chargeKey({ side, base: base.id, plant: null }) })),
    ...set.blueprintPlants.map((plant) => ({ id: plant.id, key: chargeKey({ side, base: plant.base, plant: plant.id }) })),
  ];
}

function scoreSide(set: TruthSet, side: Side, verdicts: readonly StoredVerdict[], bar: Bar): SideScore | null {
  const members = membersOf(side, verdicts);
  if (members.length === 0) return null;
  if (members.length > MAX_MEMBERS_PER_SIDE) {
    throw new InputError(
      `the ${side} side has ${members.length} judges; every subset is scored only up to ${MAX_MEMBERS_PER_SIDE} (${members.map((member) => member.id).join(", ")})`,
    );
  }
  const runs = members.map((member) => scoreMember(set, member));
  const subjects = sideSubjects(set, side);
  const memberScores = runs.map((run, index): MemberScore => {
    const charges = [chargesOf(members[index])];
    const unjudged = subjects.filter(({ key }) => !charges[0].has(key)).map(({ id }) => id);
    return { ...run.score, unjudged, delay_ms: delayOf(charges), usage_usd: usageOf(charges) };
  });
  return { side, members: memberScores, ...scoreSubsets(members, runs, bar) };
}

/** Scores `verdicts`, already checked against `set`, on each side they judged: blueprint first, then game. */
export function scoreVerdicts(set: TruthSet, verdicts: readonly StoredVerdict[], bar: Bar = LOSE_NOTHING): ScoreReport {
  const order: readonly Side[] = ["blueprint", "game"];
  const versions = judgeVersions();
  const current = (judge: string): number | null => versions[judge] ?? null;
  const hashOf = subjectHasher(set);
  const staleness = (verdict: StoredVerdict): StaleVerdicts["reason"] | null => {
    if (verdict.judge_version !== current(verdict.judge)) return "judge";
    return verdict.subject_hash === hashOf(verdict.subject) ? null : "subject";
  };
  const scored: StoredVerdict[] = [];
  const stale = new Map<string, StaleVerdicts>();
  for (const verdict of verdicts) {
    const reason = staleness(verdict);
    if (reason === null) {
      scored.push(verdict);
      continue;
    }
    const key = JSON.stringify([verdict.judge, verdict.model, verdict.judge_version, reason]);
    const entry = stale.get(key) ?? { judge: verdict.judge, model: verdict.model, version: verdict.judge_version, current: current(verdict.judge), reason, verdicts: 0 };
    entry.verdicts += 1;
    stale.set(key, entry);
  }
  return {
    schema_version: SCORE_SCHEMA_VERSION,
    rules: {
      reports: "a finding of either severity is a report; major_only counts only major findings",
      catch: "a judge catches a unit when most of its judging samples do; a tie is not a catch",
      stale: "only a verdict at its judge's current version, on its subject as it stands, is scored; the rest are listed as stale",
      bar: { ...bar, text: describeBar(bar) },
    },
    sides: order.map((side) => scoreSide(set, side, scored, bar)).filter((side): side is SideScore => side !== null),
    stale: [...stale.entries()].sort(([a], [b]) => byCodePoint(a, b)).map(([, entry]) => entry),
  };
}
