/**
 * Test gate orchestrator — replaces the chained && in `npm test`.
 *
 * Phase 1 (parallel): lint, typecheck, svelte-check, unit tests
 * Phase 2 (serial):   integration, API e2e, browser e2e
 *
 * Phase 2 needs a local Supabase stack in Docker. In the cloud execution
 * environment (Claude Code on the web) there is no Docker, so Phase 2 is
 * WAIVED — but only when the environment-owned marker `MYSTERY_CLOUD_SESSION`
 * is set. Locally that marker is absent, so Phase 2 always runs and a stack
 * that is not up is a setup step to complete, never a reason to skip. The
 * marker is set by the cloud environment definition; agents must not set,
 * export, or fabricate it to authorize a waiver.
 *
 * Produces timestamped log files in test-results/ and a summary with timing.
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { npmBin } from "./supabase-utils.mjs";

// ---------------------------------------------------------------------------
// Step definitions
// ---------------------------------------------------------------------------

const STEPS = [
  // Phase 1 — independent, run in parallel
  { name: "lint", phase: 1, args: ["run", "lint"] },
  { name: "typecheck", phase: 1, args: ["run", "typecheck"] },
  { name: "check-web", phase: 1, args: ["-w", "web", "run", "check"] },
  { name: "unit-api", phase: 1, args: ["run", "test:unit"] },
  { name: "unit-web", phase: 1, args: ["-w", "web", "run", "test:unit"] },

  // Phase 2 — share Supabase state, run serially
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

// Waiver is gated on a positive, environment-owned marker — never on Docker
// or Supabase reachability, which is the excuse this is designed to prevent.
const cloudSession = Boolean(process.env.MYSTERY_CLOUD_SESSION);

const baseDir = path.resolve("test-results");
const runDir = path.join(baseDir, timestamp());
fs.mkdirSync(runDir, { recursive: true });

console.log(`\n=== Test Gate ===`);
console.log(`Log directory: ${runDir}`);
if (cloudSession) {
  console.log(`Cloud session detected (MYSTERY_CLOUD_SESSION set).`);
}
console.log("");

const results = [];
const totalStart = performance.now();

// --- Phase 1: parallel ---
const phase1Steps = STEPS.filter((s) => s.phase === 1);
console.log(`--- Phase 1 (parallel): ${phase1Steps.map((s) => s.name).join(", ")} ---\n`);

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
} else if (cloudSession) {
  // --- Phase 2: WAIVED (cloud session) ---
  // The cloud container has no Docker, so the Supabase-backed suites cannot
  // run. Record them as explicitly waived (not skipped, not passed) so the
  // summary is honest and the gate still goes green on Phase 1. These suites
  // must be run locally before merge.
  const phase2Steps = STEPS.filter((s) => s.phase === 2);
  console.log(
    `\n--- Phase 2 WAIVED: cloud session (MYSTERY_CLOUD_SESSION set) ---`,
  );
  console.log(
    `Supabase-backed suites (${phase2Steps
      .map((s) => s.name)
      .join(", ")}) do not run without Docker. Run them locally before merge.\n`,
  );
  for (const step of phase2Steps) {
    results.push({
      name: step.name,
      passed: false,
      waived: true,
      durationMs: 0,
      logPath: null,
    });
  }
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

  // --- Leak detection (non-fatal, after phase 2) ---
  try {
    const { detectTestUserLeaks } = await import(
      "../tests/testkit/src/leak-detector.ts"
    );
    const leakedCount = await detectTestUserLeaks();
    const leakLine =
      leakedCount > 0
        ? `Leak check: ${leakedCount} orphaned test user(s) found`
        : "Leak check: clean";
    console.log(`\n${leakLine}`);
    fs.appendFileSync(path.join(runDir, "summary.log"), `\n${leakLine}\n`);
  } catch {
    // Leak detection is best-effort — don't fail the gate
  }
}

const totalMs = performance.now() - totalStart;

// Waived steps do not fail the gate; skipped/failed steps do.
const overallPass = results.every((r) => r.passed || r.waived);

// --- Summary ---
const lines = [
  "=== Test Gate Summary ===",
  "",
  ...results.map((r) => {
    const status = r.skipped
      ? "SKIP"
      : r.waived
        ? "WAIVED"
        : r.passed
          ? "PASS"
          : "FAIL";
    const time = r.durationMs
      ? `${(r.durationMs / 1000).toFixed(1)}s`
      : "  -  ";
    const padName = r.name.padEnd(16);
    const padTime = time.padStart(7);
    let line = `${padName} ${padTime}  ${status}`;
    if (!r.passed && !r.skipped && !r.waived && r.logPath) {
      const err = firstErrorLine(r.logPath);
      if (err) line += `\n${"".padEnd(27)}${err}`;
    }
    return line;
  }),
  "─".repeat(40),
  `${"Total".padEnd(16)} ${(totalMs / 1000).toFixed(1).padStart(7)}s  ${overallPass ? "PASS" : "FAIL"}`,
  ...(cloudSession
    ? ["", "Phase 2 WAIVED: cloud session (MYSTERY_CLOUD_SESSION). Run Supabase-backed suites locally before merge."]
    : []),
  "",
];

const summary = lines.join("\n");
console.log(`\n${summary}`);
fs.writeFileSync(path.join(runDir, "summary.log"), summary);

pruneOldRuns(baseDir);

process.exit(overallPass ? 0 : 1);
