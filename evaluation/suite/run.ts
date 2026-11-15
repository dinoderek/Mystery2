/**
 * Running a planned suite: each call through its harness's own judge code
 * and the core runner, answered from the journal when it has finished
 * before, and stored as the truth set's verdict.
 *
 * Subjects run `concurrency` at a time. On one subject the judges run side
 * by side, and each judge's calls (its models and samples) one after another,
 * so models and samples never multiply how many model processes run at once.
 *
 * A call made in this run leaves its folder in the run folder: its prompts,
 * attempt logs, any agent workspace, and a `result.json` holding the
 * judge's full verdict. A call answered from the journal makes nothing new.
 *
 * At the usage limit a call throws `UsageLimitError`: no new subject starts,
 * the calls already running finish and are journaled, and the error reaches
 * the command, which stops.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { judgeOneDimension } from "../blueprint/judge.ts";
import type { EvalContext } from "../core/dispatch.ts";
import { mapPool } from "../core/pool.ts";
import { getJudgeEntry } from "../core/registry.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from "../core/result.ts";
import type { Verdict } from "../core/result.ts";
import type { RunFolder } from "../core/run-folder.ts";
import { slugify } from "../core/run-folder.ts";
import { kindedFindings } from "../lib/truth/findings.ts";
import type { StoredVerdict } from "../lib/truth/schemas.ts";
import { judgeTurn } from "../runtime/lib/judges.ts";
import { judgeOne } from "../trace/judge-game.ts";
import type { JudgeRun } from "../trace/judge-game.ts";
import type { CallJournal } from "./journal.ts";
import type { PlannedCall, PlannedSubject, SuitePlan } from "./plan.ts";

export interface SuiteRunning {
  context: EvalContext;
  run: RunFolder;
  journal: CallJournal;
  concurrency: number;
}

export interface SuiteOutcome {
  verdicts: StoredVerdict[];
  made: number;
  recalled: number;
}

interface CallPlace {
  dir: string;
  logDir: string;
}

/** Where one call runs: its folder, its memo, the repo root, and a game subject's prepared judging. */
interface CallSetting {
  place: CallPlace;
  memo: JudgeRun["memo"];
  root: string;
  game: Pick<JudgeRun, "trace" | "judgeSubject"> | null;
}

/** The judge verdict of one call, through the harness its subject belongs to. */
async function judgeCall(subject: PlannedSubject, call: PlannedCall, { place, memo, root, game }: CallSetting): Promise<Verdict> {
  if (subject.kind === "blueprint") {
    return judgeOneDimension(call.judge.id, {
      brief: subject.brief,
      blueprint: subject.blueprint,
      binding: call.binding,
      logDir: place.logDir,
      runDir: place.dir,
      write: () => {},
      memo,
    });
  }
  if (subject.kind === "game") {
    const prepared = game as Pick<JudgeRun, "trace" | "judgeSubject">;
    const judged = await judgeOne(getJudgeEntry(call.judge.id), { ...prepared, binding: call.binding, logDir: place.logDir, memo });
    return judged.verdict;
  }
  const [verdict] = await judgeTurn([call.judge.id], subject.turn, { root, binding: call.binding, logDir: place.logDir, memo });
  return verdict;
}

function stored(subject: PlannedSubject, call: PlannedCall, verdict: Verdict): StoredVerdict {
  return {
    subject: subject.stored,
    judge: call.judge.id,
    model: call.model,
    sample: call.sample,
    status: verdict.status,
    findings: kindedFindings(verdict, subject.kind === "turn" ? subject.stored.sequence : null),
    duration_ms: verdict.call?.duration_ms ?? null,
    cost_usd: verdict.call?.cost_usd ?? null,
  };
}

function describe(verdict: StoredVerdict): string {
  const major = verdict.findings.filter((finding) => finding.severity === "major").length;
  return `${verdict.status}${verdict.findings.length > 0 ? ` (${verdict.findings.length} finding(s), ${major} major)` : ""}`;
}

async function writeCallResult(running: SuiteRunning, subject: PlannedSubject, place: CallPlace, verdict: Verdict): Promise<void> {
  await writeResult(path.join(place.dir, "result.json"), {
    schema_version: RESULT_SCHEMA_VERSION,
    run: running.run.info(),
    subject: { kind: subject.kind, id: subject.id, path: null },
    production: null,
    verdicts: [verdict],
    summary: summarize([verdict]),
    run_error: null,
    timing: null,
  });
}

/**
 * A call's folder: a readable slug of what it is, cut to a length, and a hash
 * of the whole, so no two calls of a run share one however long their names.
 */
function callFolder(subject: PlannedSubject, call: PlannedCall): string {
  const identity = JSON.stringify([subject.stored, call.judge.id, call.model, call.sample]);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 10);
  return `${slugify(`${subject.id}--${call.judge.id}--${call.model}--s${call.sample}`).slice(0, 69)}-${hash}`;
}

/** Runs every call of the plan and returns their stored verdicts, in the plan's order. */
export async function runSuitePlan(plan: SuitePlan, running: SuiteRunning): Promise<SuiteOutcome> {
  const counts = { made: 0, recalled: 0 };
  const total = plan.calls;
  let done = 0;
  const perSubject = await mapPool(plan.subjects, running.concurrency, async ({ subject, calls }) => {
    const game = subject.kind === "game" ? subject.prepared : null;
    const byJudge = [...new Set(calls.map((call) => call.judge.id))].map((id) => calls.filter((call) => call.judge.id === id));
    const judged = await mapPool(byJudge, byJudge.length, (own) => mapPool(own, 1, async (call) => {
      const dir = path.join(running.run.dir, callFolder(subject, call));
      const place = { dir, logDir: path.join(dir, "logs") };
      const memo = running.journal.memo({ subject: subject.stored, judge: call.judge.id, model: call.model, sample: call.sample });
      const verdict = await judgeCall(subject, call, { place, memo, root: running.context.root, game });
      // A verdict reached with no model call (a turn with nothing to judge) is neither made nor recalled.
      const made = verdict.call !== undefined && !memo.recalled;
      if (made) {
        fs.mkdirSync(dir, { recursive: true });
        await writeCallResult(running, subject, place, verdict);
        counts.made += 1;
      }
      if (memo.recalled) counts.recalled += 1;
      done += 1;
      const result = stored(subject, call, verdict);
      running.context.out(`[suite] ${done}/${total} ${subject.id} ${call.judge.id} ${call.model} s${call.sample}: ${describe(result)}${memo.recalled ? " (finished before)" : ""}`);
      return result;
    }));
    return judged.flat();
  });
  return { verdicts: perSubject.flat(), ...counts };
}
