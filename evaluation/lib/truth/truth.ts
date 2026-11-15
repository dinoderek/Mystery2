/**
 * The truth of one unit: `fault`, `clean` or `unknown`.
 *
 * - A turn of a stored game takes its latest label: a fault of the unit's
 *   kind is a fault, a label without one is clean, no label is unknown.
 * - A turn of a variant that carries a plant is a fault of the plant's kind;
 *   the edit may have disturbed the rest of the turn, so its other kinds are
 *   unknown. The variant's other turns take the stored game's labels.
 * - A base blueprint is clean for every kind: it passed every check and judge
 *   before it was used, which is the only sense of clean on this side.
 * - A planted blueprint is a fault of its plant's kind; its other kinds are
 *   unknown, because nothing but the plant is known for certain.
 */

import type { BlueprintUnit, TurnUnit, Unit } from "./findings.ts";
import type { Severity } from "./kinds.ts";
import type { Label } from "./schemas.ts";
import type { TruthSet } from "./loader.ts";

export type TruthValue = "fault" | "clean" | "unknown";

export interface Truth {
  truth: TruthValue;
  /** The worst severity of a labelled or planted turn fault; null otherwise, and for a planted blueprint, which has none. */
  severity: Severity | null;
}

const UNKNOWN: Truth = { truth: "unknown", severity: null };
const CLEAN: Truth = { truth: "clean", severity: null };

/** The label of a turn that is scored: the latest. Earlier labels are kept but not read. */
export function latestLabel(labels: readonly Label[], sequence: number): Label | null {
  let latest: Label | null = null;
  for (const label of labels) {
    if (label.sequence === sequence && (latest === null || Date.parse(label.at) > Date.parse(latest.at))) latest = label;
  }
  return latest;
}

function fromLabel(label: Label | null, kind: TurnUnit["kind"]): Truth {
  if (label === null) return UNKNOWN;
  const faults = label.faults.filter((fault) => fault.kind === kind);
  if (faults.length === 0) return CLEAN;
  return { truth: "fault", severity: faults.some((fault) => fault.severity === "major") ? "major" : "minor" };
}

function truthOfTurn(set: TruthSet, unit: TurnUnit): Truth {
  const game = set.games.find((candidate) => candidate.id === unit.game);
  if (!game) throw new Error(`no stored game "${unit.game}" in ${set.root}`);
  if (unit.variant !== null) {
    const variant = set.turnVariants.find((candidate) => candidate.id === unit.variant && candidate.game === unit.game);
    if (!variant) throw new Error(`no variant "${unit.variant}" of game "${unit.game}" in ${set.root}`);
    const plant = variant.plants.find((candidate) => candidate.sequence === unit.sequence);
    if (plant) return plant.kind === unit.kind ? { truth: "fault", severity: plant.severity } : UNKNOWN;
  }
  return fromLabel(latestLabel(game.labels, unit.sequence), unit.kind);
}

function truthOfBlueprint(set: TruthSet, unit: BlueprintUnit): Truth {
  if (!set.bases.some((base) => base.id === unit.base)) throw new Error(`no base "${unit.base}" in ${set.root}`);
  if (unit.plant === null) return CLEAN;
  const plant = set.blueprintPlants.find((candidate) => candidate.id === unit.plant && candidate.base === unit.base);
  if (!plant) throw new Error(`no plant "${unit.plant}" on base "${unit.base}" in ${set.root}`);
  return plant.kind === unit.kind ? { truth: "fault", severity: null } : UNKNOWN;
}

/** What the truth set knows about one unit; throws when it names a subject the set does not have. */
export function truthOf(set: TruthSet, unit: Unit): Truth {
  return unit.side === "game" ? truthOfTurn(set, unit) : truthOfBlueprint(set, unit);
}
