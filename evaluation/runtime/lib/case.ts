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
  /** `flesch`: grade levels of slack above the target age. */
  tolerance?: number;
  /** `flesch`, `age_appropriate_turn`: overrides the blueprint's target age. */
  targetAge?: number;
  /** The `gm_*` judges: overrides the blueprint the stored turn names. */
  blueprintPath?: string;
}

export interface TurnCase {
  id: string;
  blueprint: { path: string };
  given: Given;
  action: TurnAction;
  /** The registry ids to judge with, unless `--judges` says otherwise. */
  judges?: string[];
  judgeConfig?: Record<string, JudgeOptions>;
  /** Who narrates: `server` or a narrator binding. `--narrator` overrides it. */
  narrator?: string;
  /** The profile a server narrator is asked for. */
  aiProfile?: string;
}

interface Named {
  id: string;
}

export interface BlueprintLike {
  id?: string;
  metadata?: { target_age?: number; title?: string };
  world: {
    characters: Array<Named & { first_name: string; last_name?: string }>;
    locations: Array<
      Named & {
        name: string;
        clues?: Array<Named & { requires?: { clue_ids?: string[] } }>;
      }
    >;
  };
}

export function validateCase(testCase: unknown, source: string): TurnCase {
  const candidate = testCase as Partial<TurnCase> | null;
  if (!candidate?.id || !candidate.action?.type || !candidate.given || !candidate.blueprint?.path) {
    throw new UsageError(`Case in ${source} must have { id, blueprint: { path }, given, action: { type, ... } }`);
  }
  return candidate as TurnCase;
}

/** Reads a blueprint, which must have a top-level `id`. Relative paths are against `root`. */
export async function readBlueprint(
  blueprintPath: string,
  root: string,
): Promise<{ blueprint: BlueprintLike; blueprintPath: string }> {
  const absolute = path.resolve(root, blueprintPath);
  let blueprint: BlueprintLike;
  try {
    blueprint = JSON.parse(await fs.readFile(absolute, "utf8")) as BlueprintLike;
  } catch (error) {
    throw new UsageError(`cannot read blueprint ${absolute}: ${(error as Error).message}`);
  }
  if (!blueprint?.id) throw new UsageError(`Blueprint ${absolute} is missing a top-level "id" field`);
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
