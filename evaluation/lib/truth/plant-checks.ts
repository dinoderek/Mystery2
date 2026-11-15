/**
 * What the gate holds every plant to, with no model:
 *
 * - it applies cleanly to its base (`plants.ts`);
 * - it changes only what it says: nothing outside the places its edits name,
 *   and something inside each plant's turn;
 * - the result is still a valid subject: a game variant parses as a trace and
 *   reconstructs as the base does, a blueprint variant passes Blueprint V2;
 * - the deterministic checks that newly report it are exactly the ones its
 *   `caught_by` records. On a game, the trace's mechanical checks at the
 *   planted turn, and `flesch` on it; on a blueprint, the mechanical checks
 *   and the analyzers. A check that already failed on the base does not count.
 *
 * A mismatch names what the checks report now, so the record is copied from
 * the failure.
 */

import fs from "node:fs/promises";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { runMechanicalChecks } from "../../checks/mechanical.ts";
import { loadAnalyzer } from "../../core/judge-loader.ts";
import { checksFor, REGISTRY } from "../../core/registry.ts";
import { judge as fleschJudge } from "../../runtime/lib/flesch.ts";
import type { StoredTurn } from "../../runtime/lib/turn.ts";
import type { RawTrace } from "../../trace/lib/normalize.ts";
import { runTraceMechanicalChecks } from "../../trace/lib/mechanical.ts";
import type { TraceCheckResult } from "../../trace/lib/mechanical.ts";
import { reconstructTrace } from "../../trace/lib/reconstruct.ts";
import type { TruthBase, TruthBlueprintPlant, TruthGame, TruthSet, TruthTurnVariant } from "./loader.ts";
import { changedPaths, isWithin } from "./patch.ts";
import { buildBlueprintVariant, buildGameVariant, PlantError } from "./plants.ts";
import type { BuiltGame } from "./plants.ts";
import type { StoredGame } from "./schemas.ts";

/** One plant, or one variant's problems that belong to no single plant. */
export interface PlantReport {
  /** `<variant>@<turn>` for a turn plant, the plant's id for a blueprint plant, the variant's id for a variant as a whole. */
  plant: string;
  /** The checks that report it now, sorted; empty when none does. */
  caughtBy: string[];
  /** Empty when the plant holds. */
  problems: string[];
}

type Status = "pass" | "fail" | "error";

function describe(ids: readonly string[]): string {
  return ids.length === 0 ? "none" : [...ids].sort().join(", ");
}

/** A problem when the recorded checks are not the ones that report the plant now. */
function recordProblem(recorded: readonly string[], now: readonly string[]): string[] {
  const same = describe(recorded) === describe(now);
  return same ? [] : [`caught_by records ${describe(recorded)}; the checks report ${describe(now)} now`];
}

function newFailures(base: ReadonlyMap<string, Status>, variant: ReadonlyMap<string, Status>): string[] {
  return [...variant].filter(([id, status]) => status === "fail" && base.get(id) !== "fail").map(([id]) => id);
}

// ---------------------------------------------------------------------------
// Game side.

/** The settings `judge game` runs the trace checks with: the registry's, merged. */
function traceContext(): Record<string, unknown> | null {
  const merged: Record<string, unknown> = Object.assign({}, ...checksFor("game").map((entry) => entry.context ?? {}));
  return Object.keys(merged).length > 0 ? merged : null;
}

function violationsAt(check: TraceCheckResult | undefined, sequence: number): Set<string> {
  const violations = (check?.details as { violations?: { sequence?: unknown }[] } | null)?.violations ?? [];
  return new Set(violations.filter((violation) => violation.sequence === sequence).map((violation) => JSON.stringify(violation)));
}

/** The trace checks that report a violation at `sequence` in `variant` that `base` did not have. */
function traceCatches(base: TraceCheckResult[], variant: TraceCheckResult[], sequence: number): string[] {
  return variant
    .filter((check) => {
      const before = violationsAt(
        base.find((candidate) => candidate.id === check.id),
        sequence,
      );
      return [...violationsAt(check, sequence)].some((violation) => !before.has(violation));
    })
    .map((check) => check.id);
}

function fleschStatus(trace: StoredGame, sequence: number): Status {
  const event = trace.events.find((candidate) => candidate.sequence === sequence);
  const targetAge = (trace.blueprint as { metadata?: { target_age?: unknown } }).metadata?.target_age;
  // `flesch` reads a captured turn; a stored game's event holds the same narration.
  const turn = {
    target_age: typeof targetAge === "number" ? targetAge : null,
    action: { type: event?.event_type ?? null },
    response: { narration_text: event?.narration ?? "", narration_parts: event?.narration_parts ?? [] },
  } as unknown as StoredTurn;
  return fleschJudge(turn).status as Status;
}

function reconstructionIssues(trace: StoredGame): Set<string> {
  return new Set(reconstructTrace(trace as unknown as RawTrace).issues.map((issue) => `turn ${issue.sequence}: ${issue.message}`));
}

function gameChecks(trace: StoredGame): TraceCheckResult[] {
  return runTraceMechanicalChecks({ rawTrace: trace as unknown as RawTrace, context: traceContext() });
}

function unexpectedChanges(base: StoredGame, built: BuiltGame): string[] {
  const touched = built.plants.flatMap((plant) => plant.touched);
  return changedPaths(base, built.trace).filter((path) => !touched.some((place) => isWithin(path, place)));
}

/** Problems with a game variant as a whole: what changed outside the plants, and whether it still reconstructs. */
function variantProblems(base: StoredGame, built: BuiltGame): string[] {
  const problems: string[] = [];
  const stray = unexpectedChanges(base, built);
  if (stray.length > 0) problems.push(`changes more than its edits name: ${stray.slice(0, 3).join(", ")}`);
  const before = reconstructionIssues(base);
  const added = [...reconstructionIssues(built.trace)].filter((issue) => !before.has(issue));
  if (added.length > 0) problems.push(`no longer reconstructs: ${added.slice(0, 3).join("; ")}`);
  return problems;
}

/** The trace checks' results on a stored game and on a variant of it. */
interface TraceChecks {
  base: TraceCheckResult[];
  variant: TraceCheckResult[];
}

function turnPlantReport(game: TruthGame, variant: TruthTurnVariant, built: BuiltGame, index: number, checks: TraceChecks): PlantReport {
  const plant = variant.plants[index];
  const place = built.plants[index];
  const at = game.trace.events.findIndex((event) => event.sequence === plant.sequence);
  const problems: string[] = [];
  if (changedPaths(game.trace.events[at], built.trace.events[at]).length === 0) problems.push("changes nothing");
  const caughtBy = traceCatches(checks.base, checks.variant, place.sequence);
  const before = new Map<string, Status>([["flesch", fleschStatus(game.trace, plant.sequence)]]);
  const after = new Map<string, Status>([["flesch", fleschStatus(built.trace, plant.sequence)]]);
  caughtBy.push(...newFailures(before, after));
  problems.push(...recordProblem(plant.caught_by, caughtBy));
  return { plant: `${variant.id}@${plant.sequence}`, caughtBy: caughtBy.sort(), problems };
}

function verifyTurnVariant(game: TruthGame, variant: TruthTurnVariant, baseChecks: TraceCheckResult[]): PlantReport[] {
  let built: BuiltGame;
  try {
    built = buildGameVariant(game.trace, variant);
  } catch (error) {
    if (!(error instanceof PlantError)) throw error;
    return [{ plant: variant.id, caughtBy: [], problems: [error.message] }];
  }
  const checks = { base: baseChecks, variant: gameChecks(built.trace) };
  const reports = variant.plants.map((_, index) => turnPlantReport(game, variant, built, index, checks));
  const whole = variantProblems(game.trace, built);
  return whole.length > 0 ? [{ plant: variant.id, caughtBy: [], problems: whole }, ...reports] : reports;
}

// ---------------------------------------------------------------------------
// Blueprint side.

interface LoadedBase {
  blueprint: unknown;
  brief: unknown;
  statuses: Map<string, Status>;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/** Every deterministic check's status on a blueprint: the mechanical checks, then each analyzer as `<dimension>.analyzer`. */
async function blueprintStatuses(brief: unknown, blueprint: unknown): Promise<Map<string, Status>> {
  const statuses = new Map<string, Status>();
  for (const check of runMechanicalChecks({ brief, blueprintCandidate: blueprint })) statuses.set(check.id, check.status);
  const parsed = BlueprintV2Schema.parse(blueprint);
  for (const entry of REGISTRY) {
    if (entry.type !== "judge" || !entry.analyzer) continue;
    const id = `${entry.id}.analyzer`;
    try {
      const outcome = (await loadAnalyzer(entry.id))?.analyze({ brief, blueprint: parsed, context: entry.context ?? null }) as { status?: unknown } | undefined;
      statuses.set(id, outcome?.status === "pass" || outcome?.status === "fail" ? outcome.status : "error");
    } catch {
      statuses.set(id, "error");
    }
  }
  return statuses;
}

async function loadBase(base: TruthBase): Promise<LoadedBase> {
  const [blueprint, brief] = await Promise.all([readJson(base.blueprintFile), readJson(base.briefFile)]);
  return { blueprint, brief, statuses: await blueprintStatuses(brief, blueprint) };
}

async function verifyBlueprintPlant(plant: TruthBlueprintPlant, base: LoadedBase): Promise<PlantReport> {
  let built;
  try {
    built = buildBlueprintVariant(base.blueprint, plant);
  } catch (error) {
    if (!(error instanceof PlantError)) throw error;
    return { plant: plant.id, caughtBy: [], problems: [error.message] };
  }
  const problems: string[] = [];
  const changed = changedPaths(base.blueprint, built.blueprint);
  if (changed.length === 0) problems.push("changes nothing");
  const stray = changed.filter((path) => !built.touched.some((place) => isWithin(path, place)));
  if (stray.length > 0) problems.push(`changes more than its patch names: ${stray.slice(0, 3).join(", ")}`);
  const caughtBy = newFailures(base.statuses, await blueprintStatuses(base.brief, built.blueprint)).sort();
  problems.push(...recordProblem(plant.caught_by, caughtBy));
  return { plant: plant.id, caughtBy, problems };
}

// ---------------------------------------------------------------------------

/**
 * Holds every plant in the set to the rules above, and reports each. A report
 * with no problems is a plant that holds; its `caughtBy` is what the checks
 * report for it now.
 */
export async function verifyPlants(set: TruthSet): Promise<PlantReport[]> {
  const reports: PlantReport[] = [];
  const checksOf = new Map<string, TraceCheckResult[]>();
  for (const variant of set.turnVariants) {
    const game = set.games.find((candidate) => candidate.id === variant.game) as TruthGame;
    if (!checksOf.has(game.id)) checksOf.set(game.id, gameChecks(game.trace));
    reports.push(...verifyTurnVariant(game, variant, checksOf.get(game.id) as TraceCheckResult[]));
  }
  const bases = new Map<string, LoadedBase>();
  for (const plant of set.blueprintPlants) {
    if (!bases.has(plant.base)) bases.set(plant.base, await loadBase(set.bases.find((base) => base.id === plant.base) as TruthBase));
    reports.push(await verifyBlueprintPlant(plant, bases.get(plant.base) as LoadedBase));
  }
  return reports;
}
