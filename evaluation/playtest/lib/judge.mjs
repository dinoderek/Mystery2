// Grading played games, when a run asks for it (--judge).
//
// The game is extracted from a copy of the run's database taken when it ended,
// read-only, into <game>/trace.json. Then the game command runs on that trace,
// as a person would:
//   ./dev eval judge game <game>/trace.json --output-root <game>/judge
// which gives the mechanical checks and the four gm_* judges (one model call
// each, plus a retry when one fails). Then every narration in the trace is
// scored by the runtime harness's `flesch` check against the blueprint's
// target_age, with no model call.
//
// Each game folder gains trace.json, result.json (the game command's result,
// copied out of its run folder under judge/), readability.json and judge.log
// (the command's output).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { loadConfig, resolveBinding } from "../../core/config.ts";
import { playedEvents } from "../../lib/game-events.mjs";
import { judge as fleschJudge } from "../../runtime/lib/flesch.ts";
import { partsToText } from "../../runtime/lib/transcript.ts";
import { createLocalTraceSource, extractSessionTrace } from "../../trace/lib/datasource.ts";

/** The binding the game judges are called through (`evaluation/config.example.json`). */
const GAME_JUDGE_BINDING = "game-judge";

/**
 * Why --judge cannot run, or null when it can. A game judge that cannot run is
 * an error for the game command too; this says so before a game is played.
 */
export function judgeSetupProblem(repoRoot) {
  try {
    resolveBinding(loadConfig({ root: repoRoot }), GAME_JUDGE_BINDING, { root: repoRoot });
    return null;
  } catch (error) {
    return `--judge needs the ${GAME_JUDGE_BINDING} binding: ${error.message}`;
  }
}

function runNode(repoRoot, args, logFile, env = {}) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logFile, "a");
    fs.writeSync(log, `$ node ${args.join(" ")}\n`);
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env: { ...process.env, ...env },
      stdio: ["ignore", log, log],
    });
    child.once("error", (error) => {
      fs.closeSync(log);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`${args[0]} exited ${code ?? signal}; see ${logFile}`));
    });
  });
}

function findFile(dir, name) {
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
 * What the judge CLI reported spending, from the event streams its wrapper
 * keeps: one per call, retries included. A call killed by its timeout reports
 * nothing, so its cost is missing.
 */
export function judgeCost(logDir) {
  if (!fs.existsSync(logDir)) return null;
  let total = null;
  for (const name of fs.readdirSync(logDir).filter((entry) => entry.endsWith(".stream.jsonl"))) {
    for (const line of fs.readFileSync(path.join(logDir, name), "utf8").split("\n")) {
      if (!line.includes('"type":"result"')) continue;
      try {
        const event = JSON.parse(line);
        if (typeof event.total_cost_usd === "number") total = (total ?? 0) + event.total_cost_usd;
      } catch {
        // A line cut short by a killed call: nothing to count.
      }
    }
  }
  return total;
}

/** Every narration in a raw trace, scored for reading level against `targetAge`. */
export function scoreReadability(trace, targetAge) {
  const narrations = playedEvents(trace.events)
    .map((event) => ({ event, text: partsToText(event.narration_parts) || event.narration.trim() }))
    .filter(({ text }) => text.length > 0)
    .map(({ event, text }) => {
      const verdict = fleschJudge({
        target_age: targetAge,
        action: { type: event.event_type },
        response: { narration_text: text, narration_parts: event.narration_parts },
      });
      return {
        sequence: event.sequence,
        event_type: event.event_type,
        status: verdict.status,
        grade: verdict.details.score,
        words: verdict.details.words ?? null,
        preview: verdict.details.preview ?? null,
        threshold: verdict.details.threshold ?? null,
        parts: verdict.details.parts ?? [],
      };
    });
  const grades = narrations.map((entry) => entry.grade).filter((grade) => grade !== null);
  return {
    target_age: targetAge,
    threshold: narrations[0]?.threshold ?? null,
    pass: narrations.filter((entry) => entry.status === "pass").length,
    total: narrations.length,
    mean_grade: grades.length > 0
      ? Math.round((grades.reduce((sum, grade) => sum + grade, 0) / grades.length) * 100) / 100
      : null,
    max_grade: grades.length > 0 ? Math.max(...grades) : null,
    narrations,
  };
}

/** The verdicts worth a glance, from the game command's result.json. */
export function summarizeResult(result) {
  return {
    mechanical: Object.fromEntries(
      result.verdicts.filter((verdict) => verdict.tier === "mechanical").map((check) => [check.id, check.status]),
    ),
    judges: Object.fromEntries(
      result.verdicts
        .filter((verdict) => verdict.tier === "judge")
        .map((verdict) => [
          verdict.id,
          {
            status: verdict.status,
            major: verdict.details?.major_count ?? null,
            minor: verdict.details?.minor_count ?? null,
          },
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
export async function extractTrace({ repoRoot, database, gameId, gameDir, configRoot = null }) {
  const source = createLocalTraceSource({
    databasePath: database,
    repoRoot,
    env: configRoot ? { ...process.env, MYSTERY_CONFIG_ROOT: configRoot } : process.env,
  });
  let trace;
  try {
    trace = await extractSessionTrace(source, gameId);
  } finally {
    source.close();
  }
  fs.writeFileSync(path.join(gameDir, "trace.json"), `${JSON.stringify(trace, null, 2)}\n`);
}

/**
 * Grades one game whose trace.json is already in its folder, and returns the
 * grades for its summary. `judgeTraceArgs` adds options to the game command
 * (tests point --config at a stub judge).
 */
export async function gradeGame({ repoRoot, gameDir, targetAge, judgeTraceArgs = [] }) {
  const tracePath = path.join(gameDir, "trace.json");
  const readability = scoreReadability(JSON.parse(fs.readFileSync(tracePath, "utf8")), targetAge);
  fs.writeFileSync(path.join(gameDir, "readability.json"), `${JSON.stringify(readability, null, 2)}\n`);

  // Cleared first, so the result.json found below is this grading's.
  const judgeRoot = path.join(gameDir, "judge");
  fs.rmSync(judgeRoot, { recursive: true, force: true });
  let failure = null;
  try {
    await runNode(
      repoRoot,
      [
        "dev",
        "eval",
        "judge",
        "game",
        tracePath,
        "--output-root",
        judgeRoot,
        "--quiet",
        ...judgeTraceArgs,
      ],
      path.join(gameDir, "judge.log"),
    );
  } catch (error) {
    // The command exits 1 on a run error and 2 on a failed verdict, and writes
    // result.json either way, which says what went wrong; without one there is
    // nothing to report but this.
    failure = error;
  }
  const resultPath = findFile(judgeRoot, "result.json");
  if (!resultPath) throw failure ?? new Error(`judge game wrote no result.json under ${judgeRoot}`);
  fs.copyFileSync(resultPath, path.join(gameDir, "result.json"));
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

  const readabilitySummary = { ...readability };
  delete readabilitySummary.narrations;
  return {
    ...summarizeResult(result),
    judge_cost_usd: judgeCost(path.join(path.dirname(resultPath), "logs")),
    readability: readabilitySummary,
  };
}

/** The grades, as a section appended to transcript.md. */
export function renderGrades(grades) {
  const lines = ["", "## Grades", ""];
  if (grades.error) {
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
