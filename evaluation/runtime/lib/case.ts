/**
 * The shapes the turn harness reads: a case (a fixed prior state and one action
 * to replay), the blueprint it is played on, and where a case file comes from.
 *
 * A case evaluates one action against a fully specified prior state. The whole
 * conversation history is part of the case, not produced by playing turns, so
 * the input is identical on every run and across models.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { UsageError } from "../../core/errors.ts";
import { buildClueGraphWorld, type ClueGraphWorld } from "../../../packages/shared/src/clue-graph-case.ts";
import { isClueGraphFile, type ClueGraphCase } from "../../../packages/shared/src/clue-graph-schema.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import { READING_AGES, ReadingAgeSchema } from "../../../packages/shared/src/reading-age.ts";

export interface Speaker {
  kind: string;
  key: string;
  label: string;
}

/** A row of `game_events`, as a case writes it. */
export interface HistoryEntry {
  sequence?: number;
  event_type: string;
  actor?: string;
  narration?: string;
  payload?: Record<string, unknown> | null;
  narration_parts?: Array<{ text: string; speaker: Speaker }>;
}

/** The prior state a case fixes. */
export interface Given {
  mode?: string;
  location_id?: string;
  talk_character_id?: string;
  time_remaining?: number;
  discovered_clues?: string[];
  revealed_clue_ids?: string[];
  history?: HistoryEntry[];
}

/** The one action under test; which fields it uses depends on `type` (`ACTIONS` in `roles.ts`). */
export interface TurnAction {
  type: string;
  player_input?: string;
  character_id?: string;
  destination?: string;
  search_query?: string;
  player_reasoning?: string;
  accusation_history_mode?: string;
}

/** Per-judge options a case may carry. */
export interface JudgeOptions {
  /** `flesch`: grade levels of slack above the reading age. */
  tolerance?: number;
  /** `flesch`, `age_appropriate_turn`: overrides the age the turn was narrated at. */
  readingAge?: number;
  /** The `gm_*` judges: overrides the blueprint the stored turn names. */
  blueprintPath?: string;
}

/** Which way a failing judge in `expect.judges` means the narrator erred. */
export type JudgedDirection = "withheld" | "given_away" | "either";

/** A detail of a clue's fact (a name, time or place): one spelling, or a list of accepted spellings. */
export type Detail = string | string[];

/**
 * What the narrator's structured output must say, graded by code over every
 * sample (`expect.ts`). A key left out is not graded. `revealed_clue_id` is a
 * search's; `revealed_clue_ids` and `used_clue_ids` are a talk turn's (`ask`).
 * `judges` names turn judges whose fail makes a sample wrong, and which way.
 * `whole_fact` lists, per clue the case expects revealed, the details of its
 * fact that the narration and its notebook line must both carry.
 *
 * A clue-graph accusation (`accuse`) is graded on what the engine decided from
 * the narrator's report, `verdict` and `reply_kind` (a failure's), and on
 * `handed`: the details of what the engine handed the reply, each of which the
 * narration must carry.
 */
export interface Expect {
  revealed_clue_id?: string | null;
  revealed_clue_ids?: string[];
  used_clue_ids?: string[];
  input_understood?: boolean;
  judges?: Record<string, JudgedDirection>;
  whole_fact?: Record<string, Detail[]>;
  verdict?: "win" | "not_yet" | "lose";
  reply_kind?: "flaw" | "alternative" | "missing";
  handed?: Detail[];
}

export interface TurnCase {
  id: string;
  blueprint: { path: string };
  /**
   * The age the action under test is narrated at, and judged at: the reader's,
   * as a profile sets it. One per case, since a case judges one turn.
   */
  reading_age: number;
  given: Given;
  action: TurnAction;
  /** The registry ids to judge with, unless `--judges` says otherwise. */
  judges?: string[];
  judgeConfig?: Record<string, JudgeOptions>;
  /** Who narrates: `server` or a narrator binding. `--narrator` overrides it. */
  narrator?: string;
  /** The profile a server narrator is asked for. */
  aiProfile?: string;
  /** Grades the case by code over `--samples` replays; without it a case runs once, as it always has. */
  expect?: Expect;
  /** The group an `expect` case's share is summed into. */
  group?: string;
  /** An `expect` case that is shown but never counted in its group's share. */
  ungraded?: boolean;
}

interface Named {
  id: string;
}

/** The parts of a clue-graph case's world view the harness reads. */
export interface BlueprintLike {
  clue_graph: ClueGraphCase;
  id?: string;
  metadata?: { title?: string };
  world: {
    characters: Array<Named & { first_name: string }>;
    locations: Array<Named & { name: string }>;
  };
}

export function validateCase(testCase: unknown, source: string): TurnCase {
  const candidate = testCase as Partial<TurnCase> | null;
  if (!candidate?.id || !candidate.action?.type || !candidate.given || !candidate.blueprint?.path) {
    throw new UsageError(`Case in ${source} must have { id, blueprint: { path }, reading_age, given, action: { type, ... } }`);
  }
  if (!ReadingAgeSchema.safeParse(candidate.reading_age).success) {
    throw new UsageError(
      `Case ${candidate.id} in ${source} has no reading_age from ${READING_AGES[0]} to ${READING_AGES.at(-1)}: the age its turn is narrated and judged at`,
    );
  }
  return candidate as TurnCase;
}

/**
 * Refuses a case that names a character its blueprint does not have: the one a
 * `talk` action greets, or the one a talk-mode `given` is already talking to.
 */
export function assertCaseCharacters(testCase: TurnCase, blueprint: BlueprintLike, blueprintPath: string): void {
  const known = new Set(blueprint.world.characters.map((character) => character.id));
  const named = [
    ["action.character_id", testCase.action.character_id],
    ["given.talk_character_id", testCase.given.talk_character_id],
  ] as const;
  for (const [field, id] of named) {
    if (id !== undefined && !known.has(id)) {
      throw new UsageError(`Case ${testCase.id}: ${field} "${id}" is not a character in blueprint ${blueprintPath}`);
    }
  }
}

/**
 * A case file as the game reads it: its world view, with the graph in
 * `clue_graph`. Any other file is refused by name; the harness plays clue
 * graphs only.
 */
export function readCaseWorld(candidate: unknown, file: string): ClueGraphWorld {
  if (!isClueGraphFile(candidate)) {
    const format = (candidate as { format?: unknown; schema_version?: unknown } | null);
    const named = format?.format ?? format?.schema_version;
    throw new UsageError(
      `${file} is not a clue-graph case${typeof named === "string" ? ` (${named})` : ""}: the harness loads clue graphs only`,
    );
  }
  return buildClueGraphWorld(validateClueGraph(candidate));
}

/** Reads a blueprint, which must be a clue-graph case. Relative paths are against `root`. */
export async function readBlueprint(
  blueprintPath: string,
  root: string,
): Promise<{ blueprint: BlueprintLike; blueprintPath: string }> {
  const absolute = path.resolve(root, blueprintPath);
  let blueprint: BlueprintLike;
  try {
    blueprint = readCaseWorld(JSON.parse(await fs.readFile(absolute, "utf8")), absolute);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    throw new UsageError(`cannot read blueprint ${absolute}: ${(error as Error).message}`);
  }
  if (!blueprint.id) throw new UsageError(`Blueprint ${absolute} is missing a top-level "id" field`);
  return { blueprint, blueprintPath: absolute };
}

const CASE_MODULE = /\.(ts|mjs|js)$/;

async function caseFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target).catch(() => {
    throw new UsageError(`no such file or folder: ${target}`);
  });
  if (!stat.isDirectory()) return [target];
  const names = (await fs.readdir(target)).sort();
  return names.filter((name) => CASE_MODULE.test(name) || name.endsWith(".json")).map((name) => path.join(target, name));
}

async function readExported(file: string): Promise<unknown> {
  if (file.endsWith(".json")) return JSON.parse(await fs.readFile(file, "utf8"));
  const mod = (await import(pathToFileURL(file).href)) as Record<string, unknown>;
  return mod.default ?? mod.cases ?? mod.case;
}

/** The cases a case module or `.json` file holds: one case or a list. */
export async function readCaseFile(file: string): Promise<TurnCase[]> {
  const exported = await readExported(file);
  const list = Array.isArray(exported) ? exported : [exported];
  return list.map((entry) => validateCase(entry, file));
}

/** The cases in a case file, or in every case file of a folder. */
export async function loadCasesFrom(target: string): Promise<TurnCase[]> {
  const cases: TurnCase[] = [];
  for (const file of await caseFiles(target)) cases.push(...(await readCaseFile(file)));
  return cases;
}
