/**
 * Planning a suite: from its file, the registry, the bindings and the truth
 * set, every call it makes, before any is made. Anything wrong (an unknown
 * judge, a missing binding, a subject the set does not have, a plant that no
 * longer applies) fails here, naming it, so a run never stops part-way for a
 * reason it could have seen.
 *
 * A judge is named by registry id, whether or not a harness's battery runs
 * it, and judges what its registry subjects say: a blueprint judge each base
 * and planted blueprint, a game judge each stored game and planted variant
 * whole, and a judge of turns only each narrated turn of those games, on the
 * narration the game holds. Each judge calls its harness's binding: the
 * blueprint judges `blueprint-judge`, the game judges `game-judge`, the turn
 * judges `turn-judge`.
 *
 * A call is one judge, on one subject, on one model, for one sample.
 */

import fs from "node:fs";

import { BLUEPRINT_JUDGE_BINDING } from "../blueprint/commands.ts";
import type { ResolvedBinding } from "../core/config.ts";
import { InputError } from "../core/errors.ts";
import { findEntry, REGISTRY } from "../core/registry.ts";
import type { JudgeEntry } from "../core/registry.ts";
import { findingsRow } from "../lib/truth/findings.ts";
import type { TruthSet } from "../lib/truth/loader.ts";
import { buildBlueprintVariant, buildGameVariant, PlantError } from "../lib/truth/plants.ts";
import type { BlueprintSubject, GameSubject, StoredGame } from "../lib/truth/schemas.ts";
import { DEFAULT_JUDGE_BINDING, GAME_TURN_JUDGES, storedGameTurns } from "../runtime/judge-turn.ts";
import type { StoredTurn } from "../runtime/lib/turn.ts";
import { GAME_JUDGE_BINDING, prepareGameJudging } from "../trace/judge-game.ts";
import type { JudgeRun } from "../trace/judge-game.ts";
import type { Selection, Suite, Threshold } from "./file.ts";

/** What a judge judges in a suite, from its registry subjects. */
export type JudgeRole = "blueprint" | "game" | "turn";

export const BINDING_OF: Readonly<Record<JudgeRole, string>> = {
  blueprint: BLUEPRINT_JUDGE_BINDING,
  game: GAME_JUDGE_BINDING,
  turn: DEFAULT_JUDGE_BINDING,
};

const ROLE_SUBJECTS: Readonly<Record<JudgeRole, string>> = {
  blueprint: "bases and planted blueprints (bases, blueprint_plants)",
  game: "stored games and their variants (games, game_variants)",
  turn: "the turns of stored games and their variants (games, game_variants)",
};

export interface PlannedJudge {
  id: string;
  role: JudgeRole;
  binding: string;
}

export type PlannedSubject =
  | { kind: "blueprint"; id: string; stored: BlueprintSubject; blueprint: unknown; brief: unknown }
  | { kind: "game"; id: string; stored: GameSubject; trace: StoredGame; prepared: GamePrepared }
  | { kind: "turn"; id: string; stored: GameSubject; turn: StoredTurn };

/** What every game judge of one game reads, made once when the suite is planned. */
export type GamePrepared = Pick<JudgeRun, "trace" | "judgeSubject">;

/** A game's judging, prepared now, so a trace `judge game` cannot read fails before any call. */
function prepared(trace: StoredGame, id: string): GamePrepared {
  try {
    return prepareGameJudging(trace);
  } catch (error) {
    throw new InputError(`game "${id}" cannot be judged: ${(error as Error).message}`);
  }
}

export interface PlannedCall {
  judge: PlannedJudge;
  /** The judge's binding with this call's model. */
  binding: ResolvedBinding;
  model: string;
  sample: number;
}

export interface SuitePlan {
  judges: PlannedJudge[];
  /** Each binding the suite calls, as configured. */
  bindings: ResolvedBinding[];
  /** By binding name, the models its calls run on. */
  models: Record<string, string[]>;
  subjects: Array<{ subject: PlannedSubject; calls: PlannedCall[] }>;
  calls: number;
}

function roleOf(entry: JudgeEntry): JudgeRole {
  if (entry.subjects.includes("blueprint")) return "blueprint";
  if (entry.subjects.includes("game")) return "game";
  return "turn";
}

function planJudge(id: string): PlannedJudge {
  const entry = findEntry(id);
  if (!entry) {
    const judges = REGISTRY.filter((candidate) => candidate.type === "judge").map((candidate) => candidate.id);
    throw new InputError(`the suite names judge "${id}", which is not in the registry. Judges: ${judges.join(", ")}`);
  }
  if (entry.type !== "judge") throw new InputError(`the suite names "${id}", which is a check, not a judge; a plant's caught_by records the checks`);
  try {
    findingsRow(id);
  } catch (error) {
    throw new InputError(`the suite names judge "${id}": ${(error as Error).message}`);
  }
  const role = roleOf(entry);
  if (role === "turn" && !GAME_TURN_JUDGES.includes(id)) {
    throw new InputError(`the suite names "${id}", which judges replayed turns only; a stored game's turns take ${GAME_TURN_JUDGES.join(" and ")}`);
  }
  return { id, role, binding: BINDING_OF[role] };
}

/** The ids a selection names, in the set's order for `all`, each checked to exist. */
function select(selection: Selection | undefined, available: readonly string[], part: string): string[] {
  if (selection === undefined) return [];
  if (selection === "all") return [...available];
  for (const id of selection) {
    if (!available.includes(id)) throw new InputError(`subjects.${part} names "${id}", which the truth set does not have (it has: ${available.join(", ") || "none"})`);
  }
  return [...selection];
}

function readBlueprint(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function planted<T>(build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof PlantError) throw new InputError(`a plant does not apply: ${error.message}`);
    throw error;
  }
}

function blueprintSubjects(set: TruthSet, subjects: Suite["subjects"]): PlannedSubject[] {
  const bases = new Map(set.bases.map((base) => [base.id, { blueprint: readBlueprint(base.blueprintFile), brief: readBlueprint(base.briefFile) }]));
  const planned: PlannedSubject[] = select(subjects.bases, [...bases.keys()], "bases").map((id) => ({
    kind: "blueprint",
    id,
    stored: { side: "blueprint", base: id, plant: null },
    ...(bases.get(id) as { blueprint: unknown; brief: unknown }),
  }));
  for (const id of select(subjects.blueprint_plants, set.blueprintPlants.map((plant) => plant.id), "blueprint_plants")) {
    const plant = set.blueprintPlants.find((candidate) => candidate.id === id) as TruthSet["blueprintPlants"][number];
    const base = bases.get(plant.base) as { blueprint: unknown; brief: unknown };
    const built = planted(() => buildBlueprintVariant(base.blueprint, plant));
    planned.push({ kind: "blueprint", id, stored: { side: "blueprint", base: plant.base, plant: id }, blueprint: built.blueprint, brief: base.brief });
  }
  return planned;
}

/** Every stored game and variant named, whole. */
function gameSubjects(set: TruthSet, subjects: Suite["subjects"]): Array<Extract<PlannedSubject, { kind: "game" }>> {
  const games = select(subjects.games, set.games.map((game) => game.id), "games").map((id) => {
    const game = set.games.find((candidate) => candidate.id === id) as TruthSet["games"][number];
    const stored = { side: "game" as const, game: id, variant: null, sequence: null };
    return { kind: "game" as const, id, stored, trace: game.trace, prepared: prepared(game.trace, id) };
  });
  const variants = select(subjects.game_variants, set.turnVariants.map((variant) => variant.id), "game_variants").map((id) => {
    const variant = set.turnVariants.find((candidate) => candidate.id === id) as TruthSet["turnVariants"][number];
    const game = set.games.find((candidate) => candidate.id === variant.game) as TruthSet["games"][number];
    const built = planted(() => buildGameVariant(game.trace, variant));
    const stored = { side: "game" as const, game: variant.game, variant: id, sequence: null };
    return { kind: "game" as const, id, stored, trace: built.trace, prepared: prepared(built.trace, id) };
  });
  return [...games, ...variants];
}

function turnSubjects(games: ReadonlyArray<Extract<PlannedSubject, { kind: "game" }>>): PlannedSubject[] {
  return games.flatMap((game) =>
    storedGameTurns(game.trace, game.id).map((turn): PlannedSubject => ({
      kind: "turn",
      id: `${game.id}--s${turn.sequence}`,
      stored: { ...game.stored, sequence: turn.sequence as number },
      turn,
    })),
  );
}

function modelsOf(suite: Suite, judges: readonly PlannedJudge[], bindings: ReadonlyMap<string, ResolvedBinding>): Record<string, string[]> {
  for (const name of Object.keys(suite.models)) {
    if (!bindings.has(name)) {
      throw new InputError(`models names binding "${name}", which no judge of the suite calls (they call: ${[...bindings.keys()].join(", ")})`);
    }
  }
  const models: Record<string, string[]> = {};
  for (const judge of judges) {
    const binding = bindings.get(judge.binding) as ResolvedBinding;
    // A binding with no model of its own (a stub) is named by the binding.
    models[judge.binding] = suite.models[judge.binding] ?? [binding.model ?? binding.name];
  }
  return models;
}

function checkThreshold(threshold: Threshold, index: number, judges: readonly PlannedJudge[], models: Record<string, string[]>): void {
  const where = `thresholds.${index}`;
  const [id, model] = threshold.judge?.split("@") ?? [];
  const judge = judges.find((candidate) => candidate.id === id);
  if (threshold.judge !== undefined && !judge) {
    throw new InputError(`${where}.judge: "${threshold.judge}" is not one of the suite's judges (${judges.map((candidate) => candidate.id).join(", ")})`);
  }
  if (judge && model !== undefined && !models[judge.binding].includes(model)) {
    throw new InputError(`${where}.judge: "${judge.id}" runs on ${models[judge.binding].join(", ")}, not "${model}"`);
  }
  const kinds = new Set((judge ? [judge] : judges).flatMap((candidate) => findingsRow(candidate.id).kinds));
  if (threshold.kind !== undefined && !kinds.has(threshold.kind as never)) {
    throw new InputError(`${where}.kind: "${threshold.kind}" is not a kind of ${judge ? `"${judge.id}"` : "the suite's judges"} (${[...kinds].join(", ")})`);
  }
}

/**
 * Every call the suite makes, grouped by subject. `resolve` gives a binding
 * by name and throws, naming it, when it is missing or cannot run.
 */
export function planSuite(suite: Suite, set: TruthSet, resolve: (name: string) => ResolvedBinding): SuitePlan {
  const judges = suite.judges.map(planJudge);
  const bindings = new Map<string, ResolvedBinding>();
  for (const judge of judges) if (!bindings.has(judge.binding)) bindings.set(judge.binding, resolve(judge.binding));
  const models = modelsOf(suite, judges, bindings);
  suite.thresholds.forEach((threshold, index) => checkThreshold(threshold, index, judges, models));

  const games = gameSubjects(set, suite.subjects);
  const wantsTurns = judges.some((judge) => judge.role === "turn");
  const subjects = [...blueprintSubjects(set, suite.subjects), ...games, ...(wantsTurns ? turnSubjects(games) : [])];
  for (const judge of judges) {
    if (!subjects.some((subject) => subject.kind === judge.role)) {
      throw new InputError(`"${judge.id}" judges ${ROLE_SUBJECTS[judge.role]}, and the suite names none`);
    }
  }

  const planned = subjects
    .map((subject) => ({
    subject,
    calls: judges
      .filter((judge) => judge.role === subject.kind)
      .flatMap((judge) =>
        models[judge.binding].flatMap((model) => {
          const binding = { ...(bindings.get(judge.binding) as ResolvedBinding), model };
          return Array.from({ length: suite.samples }, (_, sample): PlannedCall => ({ judge, binding, model, sample }));
        }),
      ),
    }))
    // A game only its turns' judges judge is no subject of its own.
    .filter((entry) => entry.calls.length > 0);
  return { judges, bindings: [...bindings.values()], models, subjects: planned, calls: planned.reduce((sum, entry) => sum + entry.calls.length, 0) };
}
