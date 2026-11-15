/**
 * The one loader for a truth set: `evaluation/truth/`, or a fixture laid out
 * the same way. It reads every part through its schema (`schemas.ts`), checks
 * what one part says about another, and fails on the first file that is wrong,
 * naming its path and the field. A file or folder that is not part of the
 * layout fails too, so nothing is skipped silently. A missing part is empty.
 *
 * ```
 * <root>/
 * ├── README.md, guide.md
 * ├── bases/<base>/blueprint.json, brief.json
 * ├── games/<game>/trace.json, labels.json (optional)
 * ├── plants/turns/<variant>.json
 * ├── plants/blueprints/<plant>.json
 * └── results/<name>.json
 * ```
 */

import fs from "node:fs/promises";
import path from "node:path";

import { StoryBriefSchema } from "../../../packages/blueprint-generator/src/story-brief.ts";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { findingsRow } from "./findings.ts";
import type { BlueprintPlant, Label, StoredGame, StoredSubject, StoredVerdict, TurnVariant } from "./schemas.ts";
import {
  BlueprintPlantSchema,
  LabelFileSchema,
  parseTruthFile,
  StoredGameSchema,
  StoredResultsSchema,
  TRUTH_ID,
  TruthFileError,
  TurnVariantSchema,
} from "./schemas.ts";

/** The real truth set, relative to the repository root. */
export const TRUTH_ROOT = "evaluation/truth";

export const README_FILE = "README.md";
/** How each kind of fault is decided, with examples. */
export const GUIDE_FILE = "guide.md";
export const BASE_BLUEPRINT = "blueprint.json";
export const BASE_BRIEF = "brief.json";
export const GAME_TRACE = "trace.json";
export const GAME_LABELS = "labels.json";

const PARTS = ["bases", "games", "plants", "results"] as const;
const PLANT_PARTS = ["turns", "blueprints"] as const;
/** What macOS leaves in a folder it has shown; never part of the set. */
const IGNORED = new Set([".DS_Store"]);

export interface TruthBase {
  id: string;
  blueprintFile: string;
  briefFile: string;
}

export interface TruthGame {
  id: string;
  traceFile: string;
  trace: StoredGame;
  /** Null when the game has no label file yet. */
  labelsFile: string | null;
  /** Every label, in file order, including those a later label replaced. */
  labels: Label[];
}

export interface TruthTurnVariant extends TurnVariant {
  id: string;
  file: string;
}

export interface TruthBlueprintPlant extends BlueprintPlant {
  id: string;
  file: string;
}

export interface TruthResults {
  id: string;
  file: string;
  verdicts: StoredVerdict[];
}

export interface TruthSet {
  root: string;
  bases: TruthBase[];
  games: TruthGame[];
  turnVariants: TruthTurnVariant[];
  blueprintPlants: TruthBlueprintPlant[];
  /** The guide's path; null until it is written. */
  guide: string | null;
  results: TruthResults[];
}

interface Entry {
  name: string;
  file: string;
  isDirectory: boolean;
}

function notInLayout(file: string, expected: string): TruthFileError {
  return new TruthFileError(file, `not part of the truth set here (expected ${expected})`);
}

async function entries(dir: string): Promise<Entry[]> {
  let found;
  try {
    found = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new TruthFileError(dir, `cannot be read: ${(error as Error).message}`);
  }
  return found
    .filter((entry) => !IGNORED.has(entry.name))
    .map((entry) => ({ name: entry.name, file: path.join(dir, entry.name), isDirectory: entry.isDirectory() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readJson(file: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch (error) {
    throw new TruthFileError(file, `cannot be read: ${(error as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new TruthFileError(file, `is not JSON: ${(error as Error).message}`);
  }
}

/** The `<id>.json` files of a folder, with their ids; anything else fails. */
async function jsonFiles(dir: string): Promise<{ id: string; file: string }[]> {
  const files = [];
  for (const entry of await entries(dir)) {
    const id = entry.name.replace(/\.json$/, "");
    if (entry.isDirectory || !entry.name.endsWith(".json") || !TRUTH_ID.test(id)) {
      throw notInLayout(entry.file, "<id>.json, the id in lower-case letters, digits and hyphens");
    }
    files.push({ id, file: entry.file });
  }
  return files;
}

/** The `<id>/` folders of a folder, each holding only the named files; returns which of them exist. */
async function idFolders(dir: string, allowed: readonly string[]): Promise<{ id: string; dir: string; has: Set<string> }[]> {
  const folders = [];
  for (const entry of await entries(dir)) {
    if (!entry.isDirectory || !TRUTH_ID.test(entry.name)) {
      throw notInLayout(entry.file, "a folder named by its id, in lower-case letters, digits and hyphens");
    }
    const has = new Set<string>();
    for (const inner of await entries(entry.file)) {
      if (inner.isDirectory || !allowed.includes(inner.name)) throw notInLayout(inner.file, allowed.join(" or "));
      has.add(inner.name);
    }
    folders.push({ id: entry.name, dir: entry.file, has });
  }
  return folders;
}

function requireFile(folder: { dir: string; has: Set<string> }, name: string): string {
  const file = path.join(folder.dir, name);
  if (!folder.has.has(name)) throw new TruthFileError(file, "is missing");
  return file;
}

async function loadBases(root: string): Promise<TruthBase[]> {
  const bases = [];
  for (const folder of await idFolders(path.join(root, "bases"), [BASE_BLUEPRINT, BASE_BRIEF])) {
    const blueprintFile = requireFile(folder, BASE_BLUEPRINT);
    const briefFile = requireFile(folder, BASE_BRIEF);
    parseTruthFile(BlueprintV2Schema, await readJson(blueprintFile), blueprintFile);
    parseTruthFile(StoryBriefSchema, await readJson(briefFile), briefFile);
    bases.push({ id: folder.id, blueprintFile, briefFile });
  }
  return bases;
}

function sequencesOf(game: StoredGame): Set<number> {
  return new Set(game.events.map((event) => event.sequence));
}

function requireTurn(game: TruthGame, sequence: number, file: string, field: string): void {
  if (!sequencesOf(game.trace).has(sequence)) {
    throw new TruthFileError(file, `${field}: turn ${sequence} is not in game "${game.id}"`);
  }
}

async function loadGames(root: string): Promise<TruthGame[]> {
  const games = [];
  for (const folder of await idFolders(path.join(root, "games"), [GAME_TRACE, GAME_LABELS])) {
    const traceFile = requireFile(folder, GAME_TRACE);
    const trace = parseTruthFile(StoredGameSchema, await readJson(traceFile), traceFile);
    const labelsFile = folder.has.has(GAME_LABELS) ? path.join(folder.dir, GAME_LABELS) : null;
    const labels = labelsFile ? parseTruthFile(LabelFileSchema, await readJson(labelsFile), labelsFile).labels : [];
    const game: TruthGame = { id: folder.id, traceFile, trace, labelsFile, labels };
    labels.forEach((label, index) => requireTurn(game, label.sequence, labelsFile ?? traceFile, `labels.${index}.sequence`));
    games.push(game);
  }
  return games;
}

function findGame(games: readonly TruthGame[], id: string, file: string, field: string): TruthGame {
  const game = games.find((candidate) => candidate.id === id);
  if (!game) throw new TruthFileError(file, `${field}: no stored game "${id}"`);
  return game;
}

async function loadTurnVariants(root: string, games: readonly TruthGame[]): Promise<TruthTurnVariant[]> {
  const variants = [];
  for (const { id, file } of await jsonFiles(path.join(root, "plants", "turns"))) {
    const variant = parseTruthFile(TurnVariantSchema, await readJson(file), file);
    const game = findGame(games, variant.game, file, "game");
    variant.plants.forEach((plant, index) => requireTurn(game, plant.sequence, file, `plants.${index}.sequence`));
    variants.push({ id, file, ...variant });
  }
  return variants;
}

function requireBlueprintJudge(judge: string, file: string, field: string): void {
  let side;
  try {
    side = findingsRow(judge).side;
  } catch (error) {
    throw new TruthFileError(file, `${field}: ${(error as Error).message}`);
  }
  if (side !== "blueprint") throw new TruthFileError(file, `${field}: "${judge}" is not a blueprint judge`);
}

async function loadBlueprintPlants(root: string, bases: readonly TruthBase[]): Promise<TruthBlueprintPlant[]> {
  const plants = [];
  for (const { id, file } of await jsonFiles(path.join(root, "plants", "blueprints"))) {
    const plant = parseTruthFile(BlueprintPlantSchema, await readJson(file), file);
    if (!bases.some((base) => base.id === plant.base)) throw new TruthFileError(file, `base: no base "${plant.base}"`);
    requireBlueprintJudge(plant.judge, file, "judge");
    plants.push({ id, file, ...plant });
  }
  return plants;
}

/** What a results file is checked against: the subjects of a set. */
export type TruthSubjects = Omit<TruthSet, "results" | "guide" | "root">;

/** Why a stored subject names nothing in the set, or null when it names something. */
function missingSubject(set: TruthSubjects, subject: StoredSubject): string | null {
  if (subject.side === "blueprint") {
    if (!set.bases.some((base) => base.id === subject.base)) return `no base "${subject.base}"`;
    if (subject.plant === null) return null;
    const plant = set.blueprintPlants.find((candidate) => candidate.id === subject.plant);
    return plant?.base === subject.base ? null : `no plant "${subject.plant}" on base "${subject.base}"`;
  }
  const game = set.games.find((candidate) => candidate.id === subject.game);
  if (!game) return `no stored game "${subject.game}"`;
  if (subject.variant !== null) {
    const variant = set.turnVariants.find((candidate) => candidate.id === subject.variant);
    if (variant?.game !== subject.game) return `no variant "${subject.variant}" of game "${subject.game}"`;
  }
  if (subject.sequence !== null && !sequencesOf(game.trace).has(subject.sequence)) {
    return `turn ${subject.sequence} is not in game "${subject.game}"`;
  }
  return null;
}

function checkVerdict(set: TruthSubjects, verdict: StoredVerdict, file: string, field: string): void {
  const missing = missingSubject(set, verdict.subject);
  if (missing) throw new TruthFileError(file, `${field}.subject: ${missing}`);
  let side;
  try {
    side = findingsRow(verdict.judge).side;
  } catch (error) {
    throw new TruthFileError(file, `${field}.judge: ${(error as Error).message}`);
  }
  if (side !== verdict.subject.side) {
    throw new TruthFileError(file, `${field}.judge: "${verdict.judge}" scores on the ${side} side, not the ${verdict.subject.side}`);
  }
  // The findings table is the one source of kinds: a stored kind it does not give the judge would score as if it did.
  const allowed: readonly string[] = findingsRow(verdict.judge).kinds;
  verdict.findings.forEach((finding, index) => {
    const stray = finding.kinds.find((kind) => !allowed.includes(kind));
    if (stray !== undefined) {
      throw new TruthFileError(file, `${field}.findings.${index}.kinds: the findings table gives "${verdict.judge}" ${allowed.join(", ")}, not "${stray}"`);
    }
  });
}

/**
 * Reads one stored results file, inside the set or not, and checks each
 * verdict against the set: its subject exists, its judge scores on that side,
 * and its kinds are the ones the findings table gives the judge.
 */
export async function readResultsFile(set: TruthSubjects, file: string): Promise<StoredVerdict[]> {
  const { verdicts } = parseTruthFile(StoredResultsSchema, await readJson(file), file);
  verdicts.forEach((verdict, index) => checkVerdict(set, verdict, file, `verdicts.${index}`));
  return verdicts;
}

async function loadResults(root: string, set: TruthSubjects): Promise<TruthResults[]> {
  const results = [];
  for (const { id, file } of await jsonFiles(path.join(root, "results"))) {
    results.push({ id, file, verdicts: await readResultsFile(set, file) });
  }
  return results;
}

async function checkTopLevel(root: string): Promise<string | null> {
  const plantsDir = path.join(root, "plants");
  for (const entry of await entries(plantsDir)) {
    if (!entry.isDirectory || !(PLANT_PARTS as readonly string[]).includes(entry.name)) {
      throw notInLayout(entry.file, PLANT_PARTS.join(" or "));
    }
  }
  let guide: string | null = null;
  for (const entry of await entries(root)) {
    const isPart = entry.isDirectory && (PARTS as readonly string[]).includes(entry.name);
    const isDoc = !entry.isDirectory && (entry.name === README_FILE || entry.name === GUIDE_FILE);
    if (!isPart && !isDoc) throw notInLayout(entry.file, `${README_FILE}, ${GUIDE_FILE} or one of ${PARTS.join(", ")}`);
    if (entry.name === GUIDE_FILE) guide = entry.file;
  }
  if (guide !== null && (await fs.readFile(guide, "utf8")).trim().length === 0) throw new TruthFileError(guide, "is empty");
  return guide;
}

/** Loads the truth set at `root`; throws a `TruthFileError` naming the first file that is wrong. */
export async function loadTruthSet(root: string): Promise<TruthSet> {
  const stat = await fs.stat(root).catch(() => null);
  if (!stat?.isDirectory()) throw new TruthFileError(root, "is not a folder; a truth set is one");
  const guide = await checkTopLevel(root);
  const bases = await loadBases(root);
  const games = await loadGames(root);
  const turnVariants = await loadTurnVariants(root, games);
  const blueprintPlants = await loadBlueprintPlants(root, bases);
  const loaded: TruthSubjects = { bases, games, turnVariants, blueprintPlants };
  const results = await loadResults(root, loaded);
  return { root, ...loaded, guide, results };
}
