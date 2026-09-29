// Grading played games, when a run asks for it (--judge).
//
// The trace pipeline runs unchanged, as a person would run it on the run's
// database:
//   eval:trace:extract --db <run>/game.db --session <id> --out <game>/trace.json
//   eval:trace --trace <game>/trace.json --output-root <game>/judge
// which gives the mechanical checks and the four gm_* judges (one model call
// each). Then every narration in the trace is scored by the runtime harness's
// `flesch` judge against the blueprint's target_age, with no model call.
//
// Each game folder gains trace.json, result.json (the trace pipeline's
// envelope, copied out of its run folder under judge/), readability.json and
// judge.log (both commands' output).

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { judge as fleschJudge } from "../../runtime/lib/judges/flesch.mjs";
import { partsToText } from "../../runtime/lib/transcript.mjs";

/** The trace judges' CLI binding, copied by hand from cli.example.json. */
export function traceCliConfigPath(repoRoot) {
  return path.join(repoRoot, "evaluation", "trace", "config", "cli.json");
}

/**
 * Why --judge cannot run, or null when it can. Without a judge step,
 * eval:trace would quietly run the mechanical checks alone.
 */
export function judgeSetupProblem(repoRoot) {
  const file = traceCliConfigPath(repoRoot);
  const relative = path.relative(repoRoot, file);
  if (!fs.existsSync(file)) {
    return `--judge needs ${relative}: copy it from cli.example.json next to it.`;
  }
  try {
    if (!JSON.parse(fs.readFileSync(file, "utf8")).judge) return `${relative} has no "judge" step.`;
  } catch (error) {
    return `${relative} is not valid JSON: ${error.message}`;
  }
  return null;
}

function runNode(repoRoot, args, logFile) {
  return new Promise((resolve, reject) => {
    const log = fs.openSync(logFile, "a");
    fs.writeSync(log, `$ node ${args.join(" ")}\n`);
    const child = spawn(process.execPath, args, { cwd: repoRoot, stdio: ["ignore", log, log] });
    child.once("error", (error) => {
      fs.closeSync(log);
      reject(error);
    });
    child.once("exit", (code) => {
      fs.closeSync(log);
      if (code === 0) resolve();
      else reject(new Error(`${args[0]} exited ${code}; see ${logFile}`));
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

/** What the judge CLI reported spending, from the event streams its wrapper keeps. */
function judgeCost(logDir) {
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
  const narrations = trace.events
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
        grade: verdict.score,
        words: verdict.details.words ?? null,
        preview: verdict.details.preview ?? null,
        threshold: verdict.details.threshold ?? null,
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

/** The verdicts worth a glance, from the trace pipeline's result.json. */
export function summarizeResult(result) {
  return {
    mechanical: Object.fromEntries(result.mechanical.map((check) => [check.id, check.status])),
    judges: Object.fromEntries(
      result.dimensions.map((dimension) => [
        dimension.id,
        {
          status: dimension.overall,
          major: dimension.judge?.major_count ?? null,
          minor: dimension.judge?.minor_count ?? null,
        },
      ]),
    ),
    run_error: result.run_error ?? null,
  };
}

/** Pulls one game's trace out of the run's database into its folder. */
export async function extractTrace({ repoRoot, database, gameId, gameDir }) {
  await runNode(
    repoRoot,
    [
      "evaluation/trace/extract.mjs",
      "--db",
      database,
      "--session",
      gameId,
      "--out",
      path.join(gameDir, "trace.json"),
    ],
    path.join(gameDir, "judge.log"),
  );
}

/**
 * Grades one game whose trace.json is already in its folder, and returns the
 * grades for its summary. `judgeTraceArgs` adds options to eval:trace (tests
 * point --config at a stub judge).
 */
export async function gradeGame({ repoRoot, gameDir, targetAge, judgeTraceArgs = [] }) {
  const tracePath = path.join(gameDir, "trace.json");
  const readability = scoreReadability(JSON.parse(fs.readFileSync(tracePath, "utf8")), targetAge);
  fs.writeFileSync(path.join(gameDir, "readability.json"), `${JSON.stringify(readability, null, 2)}\n`);

  const judgeRoot = path.join(gameDir, "judge");
  await runNode(
    repoRoot,
    [
      "evaluation/trace/run.mjs",
      "--trace",
      tracePath,
      "--output-root",
      judgeRoot,
      "--quiet",
      ...judgeTraceArgs,
    ],
    path.join(gameDir, "judge.log"),
  );
  const resultPath = findFile(judgeRoot, "result.json");
  if (!resultPath) throw new Error(`eval:trace wrote no result.json under ${judgeRoot}`);
  fs.copyFileSync(resultPath, path.join(gameDir, "result.json"));
  const result = JSON.parse(fs.readFileSync(resultPath, "utf8"));

  const { narrations: _narrations, ...readabilitySummary } = readability;
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
