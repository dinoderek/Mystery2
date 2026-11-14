/**
 * Storing and judging one blueprint subject: the blueprint and its brief are
 * written beside `result.json`, so the same command can judge them again, and
 * the result records what was found. A failure that stops the run is recorded
 * in the result's `run_error` with the stage it happened in; the result is
 * still written.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { RunFolder, SubjectFolder } from "../core/run-folder.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from "../core/result.ts";
import type { ModelCall, Result, RunError, Verdict } from "../core/result.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { RunTimer, StageError } from "../core/timing.ts";
import { judgeBlueprint, runMechanical } from "./judge.ts";
import type { JudgeSelection } from "./judge.ts";
import { STORED_BLUEPRINT, STORED_BRIEF } from "./inputs.ts";

export interface BlueprintSubject {
  run: RunFolder;
  folder: SubjectFolder;
  /** Names the subject in its result and its folder. */
  id: string;
  timer: RunTimer;
  /** The model calls that made the blueprint, when this run made it. */
  production?: ModelCall[] | null;
}

/** Writes this subject's `result.json`. `stored` is false when the run broke before a blueprint was kept. */
export async function writeBlueprintResult(
  subject: BlueprintSubject,
  outcome: { verdicts: Verdict[]; runError: RunError | null; stored: boolean },
): Promise<Result> {
  return writeResult(subject.folder.resultFile, {
    schema_version: RESULT_SCHEMA_VERSION,
    run: subject.run.info(),
    subject: { kind: "blueprint", id: subject.id, path: outcome.stored ? STORED_BLUEPRINT : null },
    production: subject.production ? { calls: subject.production } : null,
    verdicts: outcome.verdicts,
    summary: summarize(outcome.verdicts, outcome.runError),
    run_error: outcome.runError,
    timing: subject.timer.summarize(),
  });
}

/** What a thrown error says about the stage it stopped. */
export function runErrorOf(error: unknown): RunError {
  const stage = (error as StageError | null)?.runErrorStage;
  return { stage: stage ?? "unknown", message: String((error as Error | null)?.message ?? error) };
}

/** Keeps the blueprint and its brief in the subject's folder. */
export async function storeBlueprint(subject: BlueprintSubject, blueprint: unknown, brief: unknown): Promise<void> {
  await subject.timer.stage("write_blueprint", async () => {
    await fs.writeFile(path.join(subject.folder.dir, STORED_BLUEPRINT), JSON.stringify(blueprint, null, 2), "utf8");
    if (brief !== null && brief !== undefined) {
      await fs.writeFile(path.join(subject.folder.dir, STORED_BRIEF), JSON.stringify(brief, null, 2), "utf8");
    }
  });
}

export interface JudgeSubjectInput {
  brief: unknown;
  blueprint: unknown;
  binding: ResolvedBinding | null;
  selection: JudgeSelection;
  quiet: boolean;
  write: (line: string) => void;
}

/** Stores the blueprint, judges it and writes the result. */
export async function judgeBlueprintSubject(subject: BlueprintSubject, input: JudgeSubjectInput): Promise<Result> {
  let stored = false;
  try {
    await storeBlueprint(subject, input.blueprint, input.brief);
    stored = true;
    const verdicts = await judgeBlueprint({
      ...input,
      logDir: subject.folder.logDir,
      runDir: subject.folder.dir,
      timer: subject.timer,
    });
    return await writeBlueprintResult(subject, { verdicts, runError: null, stored });
  } catch (error) {
    return writeBlueprintResult(subject, { verdicts: [], runError: runErrorOf(error), stored });
  }
}

/** Stores the blueprint, runs the mechanical checks only and writes the result. */
export async function validateBlueprintSubject(subject: BlueprintSubject, input: { brief: unknown; blueprint: unknown }): Promise<Result> {
  let stored = false;
  try {
    await storeBlueprint(subject, input.blueprint, input.brief);
    stored = true;
    const verdicts = await subject.timer.stage("mechanical", () => runMechanical(input.brief, input.blueprint), (checks) => ({ checks: checks.length }));
    return await writeBlueprintResult(subject, { verdicts, runError: null, stored });
  } catch (error) {
    return writeBlueprintResult(subject, { verdicts: [], runError: runErrorOf(error), stored });
  }
}
