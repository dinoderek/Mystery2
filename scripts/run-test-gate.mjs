/**
 * Test gate orchestrator — replaces the chained && in `npm test`.
 *
 * Phase 1 (parallel): lint, typecheck, svelte-check, unit tests, curated-doc
 *                     drift check
 * Phase 2 (serial):   integration, API e2e, browser e2e
 *
 * Phase 2 builds the game and runs it against a throwaway database. It needs
 * nothing installed beyond this repo — no Docker, no containers, no seeding —
 * which is why the `MYSTERY_CLOUD_SESSION` waiver that used to let Phase 2 be
 * skipped is gone. Every step runs everywhere.
 *
 * The two unit steps run with coverage on, and the summary carries what they
 * measured: totals per project, and the files thin enough to be worth naming.
 * Coverage never decides the verdict.
 *
 * Produces timestamped log files in test-results/ and a summary with timing.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { npmBin } from "./lib/process.mjs";
import {
  clearCoverageReports,
  collectCoverage,
  formatCoverageDetail,
  formatCoverageSummary,
} from "./lib/coverage-report.mjs";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  // Phase 1 — independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  { name: "unit-api", phase: 1, args: ["run", "test:unit:coverage"] },
  {
    name: "unit-web",
    phase: 1,
    args: ["-w", "web", "run", "test:unit:coverage"],
  },
  { name: "curated-docs", phase: 1, args: ["run", "check:curated-docs"] },

  // Phase 2 — each starts a server on the worktree's port, so serial
  { name: "integration", phase: 2, args: ["run", "test:integration"] },
  { name: "e2e-api", phase: 2, args: ["run", "test:e2e"] },
  { name: "e2e-browser", phase: 2, args: ["-w", "web", "run", "test:e2e"] },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_RUNS = 5;

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function pruneOldRuns(baseDir) {
  if (!fs.existsSync(baseDir)) return;
  const entries = fs
    .readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => ({ name: d.name, path: path.join(baseDir, d.name) }))
    .sort((a, b) => b.name.localeCompare(a.name)); // newest first

  for (const old of entries.slice(MAX_RUNS)) {
    fs.rmSync(old.path, { recursive: true, force: true });
  }
}

function firstErrorLine(logPath) {
  try {
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    for (const line of lines) {
      const lower = line.toLowerCase();
      if (
        lower.includes("error") ||
        lower.includes("fail") ||
        lower.includes("✗") ||
        lower.includes("×")
      ) {
        return line.trim().slice(0, 200);
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Run a single step, tee-ing output to both console and a log file.
 * Returns { name, passed, durationMs }.
 */
function runStep(step, logDir) {
  return new Promise((resolve) => {
    const logPath = path.join(logDir, `${step.name}.log`);
    const logStream = fs.createWriteStream(logPath);
    const start = performance.now();

    const child = spawn(npmBin, step.args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const prefix = `[${step.name}] `;

    child.stdout.on("data", (chunk) => {
      logStream.write(chunk);
      for (const line of chunk.toString().split("\n")) {
        if (line) process.stdout.write(`${prefix}${line}\n`);
      }
    });

    child.stderr.on("data", (chunk) => {
      logStream.write(chunk);
      for (const line of chunk.toString().split("\n")) {
        if (line) process.stderr.write(`${prefix}${line}\n`);
      }
    });

    child.on("close", (code) => {
      logStream.end();
      const durationMs = performance.now() - start;
      resolve({ name: step.name, passed: code === 0, durationMs, logPath });
    });
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const baseDir = path.resolve("test-results");
const runDir = path.join(baseDir, timestamp());
fs.mkdirSync(runDir, { recursive: true });

console.log(`\n=== Test Gate ===`);
console.log(`Log directory: ${runDir}`);
console.log("");

clearCoverageReports(process.cwd());

const results = [];
const totalStart = performance.now();

// --- Phase 1: parallel ---
const phase1Steps = STEPS.filter((s) => s.phase === 1);
console.log(
  `--- Phase 1 (parallel): ${phase1Steps.map((s) => s.name).join(", ")} ---\n`,
);

const phase1Results = await Promise.all(
  phase1Steps.map((step) => runStep(step, runDir)),
);
results.push(...phase1Results);

const phase1Failed = phase1Results.filter((r) => !r.passed);
if (phase1Failed.length > 0) {
  console.error(
    `\nPhase 1 failures: ${phase1Failed.map((r) => r.name).join(", ")}`,
  );
  console.error("Skipping phase 2.\n");
} else {
  // --- Phase 2: serial ---
  const phase2Steps = STEPS.filter((s) => s.phase === 2);
  console.log(
    `\n--- Phase 2 (serial): ${phase2Steps.map((s) => s.name).join(", ")} ---\n`,
  );

  for (const step of phase2Steps) {
    const result = await runStep(step, runDir);
    results.push(result);
    if (!result.passed) {
      console.error(`\n${step.name} failed — stopping phase 2.\n`);
      // Mark remaining steps as skipped
      const remaining = phase2Steps.slice(phase2Steps.indexOf(step) + 1);
      for (const skipped of remaining) {
        results.push({
          name: skipped.name,
          passed: false,
          durationMs: 0,
          logPath: null,
          skipped: true,
        });
      }
      break;
    }
  }
}

const totalMs = performance.now() - totalStart;

const overallPass = results.every((r) => r.passed);

// --- Summary ---
const lines = [
  "=== Test Gate Summary ===",
  "",
  ...results.map((r) => {
    const status = r.skipped ? "SKIP" : r.passed ? "PASS" : "FAIL";
    const time = r.durationMs
      ? `${(r.durationMs / 1000).toFixed(1)}s`
      : "  -  ";
    const padName = r.name.padEnd(16);
    const padTime = time.padStart(7);
    let line = `${padName} ${padTime}  ${status}`;
    if (!r.passed && !r.skipped && r.logPath) {
      const err = firstErrorLine(r.logPath);
      if (err) line += `\n${"".padEnd(27)}${err}`;
    }
    return line;
  }),
  "─".repeat(40),
  `${"Total".padEnd(16)} ${(totalMs / 1000).toFixed(1).padStart(7)}s  ${overallPass ? "PASS" : "FAIL"}`,
  "",
];

// --- Coverage ---
// Reported after the verdict, deliberately: the first question anyone asks a
// gate log is what failed, and coverage only becomes the interesting number
// once the answer is "nothing".
const coverage = collectCoverage({ repoRoot: process.cwd(), results });
fs.writeFileSync(
  path.join(runDir, "coverage.log"),
  formatCoverageDetail(coverage),
);

const summary = `${lines.join("\n")}\n${formatCoverageSummary(coverage)}`;
console.log(`\n${summary}`);
fs.writeFileSync(path.join(runDir, "summary.log"), summary);

pruneOldRuns(baseDir);

process.exit(overallPass ? 0 : 1);
