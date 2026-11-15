/**
 * Puts live material into a truth set, by code, so nothing in it is copied or
 * scrubbed by hand:
 *
 * - `base <id> <result.json>` stores a judged blueprint as a base: the
 *   blueprint and brief beside the result, and its judges' verdicts in
 *   `results/bases.json`. Only a clean result is stored: every check,
 *   analyzer and judge of the default battery passed.
 * - `game <id> <trace.json> <summary.json>` stores a self-played game's
 *   trace. Its provenance keeps its kind, and gains the persona and the
 *   investigator's model from the game's `summary.json`; never the path of the
 *   database it was read from.
 *
 * Each refuses a file the leak guard (`guard.ts`) objects to, and loads the
 * whole set again after writing, so a stored part that breaks it fails here.
 *
 * ```bash
 * node evaluation/lib/truth/store.ts base <id> <run>/<subject>/result.json
 * node evaluation/lib/truth/store.ts game <id> <judge run>/<game>/trace.json <play run>/<game>/summary.json
 * ```
 */

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { StoryBriefSchema } from "../../../packages/blueprint-generator/src/story-brief.ts";
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { repoRoot } from "../../core/judge-loader.ts";
import { judgesFor } from "../../core/registry.ts";
import { parseResult } from "../../core/result.ts";
import type { Result, Verdict } from "../../core/result.ts";
import { kindedFindings } from "./findings.ts";
import { leaksIn } from "./guard.ts";
import { BASE_BLUEPRINT, BASE_BRIEF, GAME_TRACE, loadTruthSet, TRUTH_ROOT } from "./loader.ts";
import type { TruthSet } from "./loader.ts";
import {
  parseTruthFile,
  STORED_RESULTS_VERSION,
  StoredGameSchema,
  StoredResultsSchema,
  TRUTH_ID,
} from "./schemas.ts";
import type { StoredGame, StoredSubject, StoredVerdict } from "./schemas.ts";

/** Where the default battery's judging of the bases is stored. */
export const BASES_RESULTS = "bases";

/**
 * One judge's verdict as the truth set stores it. `turn` is the turn a judge
 * of one turn judged, else null. A verdict with no model call has no model to
 * store, so it is refused.
 */
export function toStoredVerdict(verdict: Verdict, subject: StoredSubject, turn: number | null = null, sample = 0): StoredVerdict {
  if (verdict.tier !== "judge") throw new Error(`"${verdict.id}" is a ${verdict.tier} check, not a judge; only judges are stored`);
  const call = verdict.call;
  if (!call?.model) throw new Error(`judge "${verdict.id}" has no model call to store (status ${verdict.status})`);
  return {
    subject,
    judge: verdict.id,
    model: call.model,
    sample,
    status: verdict.status,
    findings: kindedFindings(verdict, turn),
    duration_ms: call.duration_ms,
    cost_usd: call.cost_usd,
  };
}

/** Why a result is not a clean base, or null when it is. */
export function notClean(result: Result): string | null {
  if (result.subject.kind !== "blueprint") return `its subject is a ${result.subject.kind}, not a blueprint`;
  if (result.run_error) return `the run broke at ${result.run_error.stage}: ${result.run_error.message}`;
  const notPassed = result.verdicts.filter((verdict) => verdict.status !== "pass");
  if (notPassed.length > 0) return `not every check and judge passed: ${notPassed.map((v) => `${v.id} ${v.status}`).join(", ")}`;
  const judged = new Set(result.verdicts.filter((verdict) => verdict.tier === "judge").map((verdict) => verdict.id));
  const missing = judgesFor("blueprint").map((judge) => judge.id).filter((id) => !judged.has(id));
  if (missing.length > 0) return `the default battery's ${missing.join(", ")} did not judge it`;
  return null;
}

/** What a self-played game's `summary.json` says about who played it. */
export interface PlaySummary {
  game_id: string;
  blueprint: { id: string };
  persona: string;
  investigator_model: string;
  error: string | null;
}

function isPlaySummary(value: unknown): value is PlaySummary {
  const summary = value as Partial<PlaySummary> | null;
  return (
    typeof summary?.game_id === "string" &&
    typeof summary.blueprint?.id === "string" &&
    typeof summary.persona === "string" &&
    typeof summary.investigator_model === "string" &&
    (summary.error === null || typeof summary.error === "string")
  );
}

/**
 * A self-played game's trace as the truth set stores it. Its provenance keeps
 * its kind, adds who played from the game's summary, and drops the rest, such
 * as the path of the database it was read from. A summary of another game, or
 * of a game that broke, is refused.
 */
export function toStoredGame(trace: unknown, summary: unknown, files: { trace: string; summary: string }): StoredGame {
  // Checked against the schema, but stored as it was extracted, apart from its provenance.
  const game = parseTruthFile(StoredGameSchema, trace, files.trace);
  if (!isPlaySummary(summary)) throw new Error(`${files.summary}: not a self-play summary.json`);
  if (summary.game_id !== game.session.id || summary.blueprint.id !== game.session.blueprint_id) {
    throw new Error(`${files.summary}: is game ${summary.game_id} on ${summary.blueprint.id}, not the trace's ${game.session.id} on ${game.session.blueprint_id}`);
  }
  if (summary.error !== null) throw new Error(`${files.summary}: the game broke (${summary.error})`);
  return {
    ...(trace as StoredGame),
    source: { kind: game.source.kind, persona: summary.persona, investigator_model: summary.investigator_model },
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8")) as unknown;
}

/**
 * Writes each value as JSON to its file, refusing all of them, before any is
 * written, when the leak guard objects to a line of one.
 */
async function writeGuarded(files: ReadonlyArray<[file: string, value: unknown]>): Promise<void> {
  const texts = files.map(([file, value]): [string, string] => {
    const text = `${JSON.stringify(value, null, 2)}\n`;
    const leaks = leaksIn(text, file);
    if (leaks.length > 0) {
      throw new Error(`${file}: not stored, ${leaks.map((leak) => `line ${leak.line} looks like ${leak.what}`).join("; ")}`);
    }
    return [file, text];
  });
  for (const [file, text] of texts) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text, "utf8");
  }
}

async function refuseExisting(target: string): Promise<void> {
  if (await fs.stat(target).then(() => true, () => false)) throw new Error(`${target} already exists; remove it to store it again`);
}

function requireId(id: string): void {
  if (!TRUTH_ID.test(id)) throw new Error(`"${id}" is not an id: lower-case letters, digits and hyphens`);
}

/** Stores the clean blueprint judged in `resultFile` as base `id`, with its verdicts. */
export async function storeBase(root: string, id: string, resultFile: string): Promise<TruthSet> {
  requireId(id);
  const baseDir = path.join(root, "bases", id);
  await refuseExisting(baseDir);
  const result = parseResult(await readJson(resultFile), resultFile);
  const why = notClean(result);
  if (why) throw new Error(`${resultFile}: not a clean base, ${why}`);
  const subjectDir = path.dirname(resultFile);
  const blueprintFile = path.join(subjectDir, result.subject.path ?? BASE_BLUEPRINT);
  // Checked against their schemas, but stored as they were judged: a parse may add defaults or drop fields.
  const blueprint = await readJson(blueprintFile);
  parseTruthFile(BlueprintV2Schema, blueprint, blueprintFile);
  const briefFile = path.join(path.dirname(blueprintFile), BASE_BRIEF);
  const brief = await readJson(briefFile);
  parseTruthFile(StoryBriefSchema, brief, briefFile);

  const subject: StoredSubject = { side: "blueprint", base: id, plant: null };
  const verdicts = result.verdicts.filter((verdict) => verdict.tier === "judge").map((verdict) => toStoredVerdict(verdict, subject));
  const resultsFile = path.join(root, "results", `${BASES_RESULTS}.json`);
  const stored = (await fs.stat(resultsFile).then(() => true, () => false))
    ? parseTruthFile(StoredResultsSchema, await readJson(resultsFile), resultsFile).verdicts
    : [];
  if (stored.some((verdict) => verdict.subject.side === "blueprint" && verdict.subject.base === id)) {
    throw new Error(`${resultsFile} already holds verdicts on base "${id}"; remove them to store it again`);
  }
  const results = parseTruthFile(StoredResultsSchema, { schema_version: STORED_RESULTS_VERSION, verdicts: [...stored, ...verdicts] }, resultsFile);

  await writeGuarded([
    [path.join(baseDir, BASE_BLUEPRINT), blueprint],
    [path.join(baseDir, BASE_BRIEF), brief],
    [resultsFile, results],
  ]);
  return loadTruthSet(root);
}

/** Stores the trace in `traceFile`, with who played it from `summaryFile`, as game `id`. */
export async function storeGame(root: string, id: string, traceFile: string, summaryFile: string): Promise<TruthSet> {
  requireId(id);
  const game = toStoredGame(await readJson(traceFile), await readJson(summaryFile), { trace: traceFile, summary: summaryFile });
  const gameDir = path.join(root, "games", id);
  await refuseExisting(gameDir);
  await writeGuarded([[path.join(gameDir, GAME_TRACE), game]]);
  return loadTruthSet(root);
}

const USAGE =
  "usage: node evaluation/lib/truth/store.ts (base <id> <result.json> | game <id> <trace.json> <summary.json>) [--root <truth set>]";

/** The command line: returns its exit code, 0 when stored, 1 otherwise. */
export async function main(argv: readonly string[], write: (line: string) => void = console.log): Promise<number> {
  const args = [...argv];
  let root = path.join(repoRoot(), TRUTH_ROOT);
  const at = args.indexOf("--root");
  if (at >= 0) [, root] = args.splice(at, 2);
  const [part, id, file, summary] = args;
  const arity = part === "base" ? 3 : part === "game" ? 4 : -1;
  if (args.length !== arity || !root) {
    write(USAGE);
    return 1;
  }
  try {
    const set = part === "base" ? await storeBase(root, id, file) : await storeGame(root, id, file, summary);
    write(`stored ${part} "${id}" in ${root}: ${set.bases.length} bases, ${set.games.length} games`);
    return 0;
  } catch (error) {
    write(`not stored: ${(error as Error).message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main(process.argv.slice(2));
}
