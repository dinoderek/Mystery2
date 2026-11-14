// Grading played games, when a run asks for it (--judge).
//
// The game is extracted from a copy of the run's database taken when it ended,
// read-only, into <game>/trace.json. Then the game command runs on that trace,
// in this process, as a person would run it:
//   ./dev eval judge game <game>/trace.json --output-root <game>/judge
// which gives the mechanical checks and the four gm_* judges (one model call
// each, plus a retry when one fails). Then every narration in the trace is
// scored by the runtime harness's `flesch` check against the blueprint's
// target_age, with no model call.
//
// The game command exits 2 when a judge fails a game, which is a finding and
// not a broken run, so only a missing result.json is an error here. Each game
// folder gains trace.json, readability.json and judge.log (the command's
// output); the command's own result is under judge/.

import fs from "node:fs";
import path from "node:path";

import { runEval } from "../../core/dispatch.ts";
import type { EvalContext } from "../../core/dispatch.ts";
import { readResult } from "../../core/result.ts";
import type { Result, RunError } from "../../core/result.ts";
import { playedEvents } from "../../lib/game-events.ts";
import { judge as fleschJudge } from "../../runtime/lib/flesch.ts";
import { partsToText } from "../../runtime/lib/transcript.ts";
import { judgeGame } from "../../trace/judge-game.ts";
import { createLocalTraceSource, extractSessionTrace } from "../../trace/lib/datasource.ts";
import type { RawEvent, RawTrace } from "../../trace/lib/normalize.ts";

type FleschTurn = Parameters<typeof fleschJudge>[0];

/** How one narration read. */
interface NarrationGrade {
  sequence: number;
  event_type: string;
  status: string;
  grade: number | null;
  words: number | null;
  preview: string | null;
  threshold: number | null;
  parts: unknown[];
}

/** `readability.json`: every narration of a game, scored for reading level. */
export interface Readability {
  target_age: number;
  threshold: number | null;
  pass: number;
  total: number;
  mean_grade: number | null;
  max_grade: number | null;
  narrations: NarrationGrade[];
}

/** What a game's summary keeps of its grading. */
export interface Grades {
  mechanical: Record<string, string>;
  judges: Record<string, { status: string; major: number | null; minor: number | null }>;
  run_error: RunError | null;
  judge_cost_usd: number | null;
  readability: Omit<Readability, "narrations">;
}

/** The parts of a trace's event that a reading level is scored from. */
type ReadableEvent = Pick<RawEvent, "sequence" | "event_type" | "narration" | "narration_parts">;

/** Every narration in a raw trace, scored for reading level against `targetAge`. */
export function scoreReadability(trace: { events: ReadableEvent[] }, targetAge: number): Readability {
  const narrations = playedEvents(trace.events)
    .map((event: ReadableEvent) => ({
      event,
      text: partsToText(event.narration_parts as Array<{ text?: unknown }>) || event.narration.trim(),
    }))
    .filter(({ text }: { text: string }) => text.length > 0)
    .map(({ event, text }: { event: ReadableEvent; text: string }): NarrationGrade => {
      const verdict = fleschJudge({
        target_age: targetAge,
        action: { type: event.event_type },
        response: { narration_text: text, narration_parts: event.narration_parts },
      } as unknown as FleschTurn);
      const details = verdict.details as Record<string, unknown>;
      return {
        sequence: event.sequence,
        event_type: event.event_type,
        status: verdict.status,
        grade: details.score as number | null,
        words: (details.words as number | undefined) ?? null,
        preview: (details.preview as string | undefined) ?? null,
        threshold: (details.threshold as number | undefined) ?? null,
        parts: (details.parts as unknown[] | undefined) ?? [],
      };
    });
  const grades = narrations.map((entry: NarrationGrade) => entry.grade).filter((grade: number | null): grade is number => grade !== null);
  return {
    target_age: targetAge,
    threshold: narrations[0]?.threshold ?? null,
    pass: narrations.filter((entry: NarrationGrade) => entry.status === "pass").length,
    total: narrations.length,
    mean_grade: grades.length > 0
      ? Math.round((grades.reduce((sum: number, grade: number) => sum + grade, 0) / grades.length) * 100) / 100
      : null,
    max_grade: grades.length > 0 ? Math.max(...grades) : null,
    narrations,
  };
}

/** What the judges cost, from their calls; null when none reported a cost. */
function judgeCost(result: Result): number | null {
  const costs = result.verdicts.map((verdict) => verdict.call?.cost_usd ?? null).filter((cost): cost is number => cost !== null);
  return costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
}

/** The verdicts worth a glance, from the game command's result.json. */
export function summarizeResult(result: Result): Pick<Grades, "mechanical" | "judges" | "run_error"> {
  const counts = (verdict: Result["verdicts"][number]) => (verdict.details ?? {}) as Record<string, number | undefined>;
  return {
    mechanical: Object.fromEntries(
      result.verdicts.filter((verdict) => verdict.tier === "mechanical").map((check) => [check.id, check.status]),
    ),
    judges: Object.fromEntries(
      result.verdicts
        .filter((verdict) => verdict.tier === "judge")
        .map((verdict) => [
          verdict.id,
          { status: verdict.status, major: counts(verdict).major_count ?? null, minor: counts(verdict).minor_count ?? null },
        ]),
    ),
    run_error: result.run_error ?? null,
  };
}

/**
 * Pulls one game's trace out of a copy of the run's database into its folder.
 * `configRoot` is the server's, where a blueprint from outside the repo was
 * copied; extraction looks for the game's blueprint there as well. The database
 * is opened read-only, so the copy is never changed.
 */
export async function extractTrace({
  repoRoot,
  database,
  gameId,
  gameDir,
  configRoot = null,
  env = process.env,
}: {
  repoRoot: string;
  database: string;
  gameId: string;
  gameDir: string;
  configRoot?: string | null;
  env?: NodeJS.ProcessEnv;
}): Promise<void> {
  const source = createLocalTraceSource({
    databasePath: database,
    repoRoot,
    env: configRoot ? { ...env, MYSTERY_CONFIG_ROOT: configRoot } : env,
  });
  let trace: RawTrace;
  try {
    trace = await extractSessionTrace(source, gameId);
  } finally {
    source.close?.();
  }
  fs.writeFileSync(path.join(gameDir, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
}

function findFile(dir: string, name: string): string | null {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isFile() && entry.name === name) return full;
    if (entry.isDirectory()) {
      const found = findFile(full, name);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Runs `judge game` on the game's trace.json and reads back its result. Its
 * output goes to <game>/judge.log. `judgeArgs` adds options to the command
 * (`--config`, `--model-override`; tests point `--config` at a stub judge).
 */
export async function judgeTrace({
  gameDir,
  root,
  env,
  judgeArgs = [],
}: {
  gameDir: string;
  root: string;
  env: NodeJS.ProcessEnv;
  judgeArgs?: string[];
}): Promise<Result> {
  const logFile = path.join(gameDir, "judge.log");
  const write = (text: string) => fs.appendFileSync(logFile, `${text}\n`);
  const context: EvalContext = { root, env, out: write, err: write };

  // Cleared first, so the result.json found below is this grading's.
  const judgeRoot = path.join(gameDir, "judge");
  fs.rmSync(judgeRoot, { recursive: true, force: true });
  const tracePath = path.join(gameDir, "trace.json");
  write(`$ ./dev eval judge game ${tracePath} --output-root ${judgeRoot} --quiet ${judgeArgs.join(" ")}`);
  const exitCode = await runEval(
    ["judge", "game", tracePath, "--output-root", judgeRoot, "--quiet", ...judgeArgs],
    context,
    [judgeGame],
  );
  // Exit code 2 says a judge failed the game and 1 that the run broke; either
  // way the command wrote a result that says which, and without one there is
  // nothing to report but this.
  const resultPath = findFile(judgeRoot, "result.json");
  if (!resultPath) throw new Error(`judge game exited ${exitCode} and wrote no result.json; see ${logFile}`);
  return readResult(resultPath);
}

/**
 * Grades one game whose trace.json is already in its folder, and returns the
 * grades for its summary along with the judge command's result.
 */
export async function gradeGame({
  gameDir,
  targetAge,
  root,
  env = process.env,
  judgeArgs = [],
}: {
  gameDir: string;
  targetAge: number;
  root: string;
  env?: NodeJS.ProcessEnv;
  judgeArgs?: string[];
}): Promise<{ grades: Grades; result: Result }> {
  const tracePath = path.join(gameDir, "trace.json");
  const readability = scoreReadability(JSON.parse(fs.readFileSync(tracePath, "utf8")), targetAge);
  fs.writeFileSync(path.join(gameDir, "readability.json"), `${JSON.stringify(readability, null, 2)}\n`);

  const result = await judgeTrace({ gameDir, root, env, judgeArgs });
  const readabilitySummary: Grades["readability"] = { ...readability };
  delete (readabilitySummary as Partial<Readability>).narrations;
  return {
    result,
    grades: {
      ...summarizeResult(result),
      judge_cost_usd: judgeCost(result),
      readability: readabilitySummary,
    },
  };
}

/** The grades, as a section appended to transcript.md. */
export function renderGrades(grades: Grades | { error: string }): string {
  const lines = ["", "## Grades", ""];
  if ("error" in grades) {
    lines.push(`- Grading failed: ${grades.error}`, "");
    return lines.join("\n");
  }
  if (grades.run_error) {
    lines.push(`- The trace pipeline stopped (${grades.run_error.stage}): ${grades.run_error.message}`);
  }
  for (const [id, status] of Object.entries(grades.mechanical)) lines.push(`- ${id}: ${status}`);
  for (const [id, verdict] of Object.entries(grades.judges)) {
    const counts = verdict.major === null ? "" : ` (${verdict.major} major, ${verdict.minor} minor)`;
    lines.push(`- ${id}: ${verdict.status}${counts}`);
  }
  const reading = grades.readability;
  lines.push(
    `- flesch: ${reading.pass} of ${reading.total} narrations at or under grade ${reading.threshold}` +
      ` for age ${reading.target_age} (mean ${reading.mean_grade}, highest ${reading.max_grade})`,
    `- Judge cost: ${grades.judge_cost_usd === null ? "n/a" : `$${grades.judge_cost_usd.toFixed(3)}`}`,
    "",
    "Details: result.json (judges' findings), readability.json (each narration).",
    "",
  );
  return lines.join("\n");
}
