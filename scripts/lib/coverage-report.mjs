/**
 * Turns the coverage reports the gate's unit steps produce into something
 * readable in a few seconds — by a person scanning a terminal, or by an agent
 * reading `summary.log` after a background run.
 *
 * The gate answers three questions in order, and coverage is the third: what
 * failed, and if nothing failed, how well covered the code is and which files
 * are dragging it down. Coverage never decides pass/fail — a thin file is a
 * warning to act on, not a broken build.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Where each measured project writes its report, and which gate step produces
 * it. A project is only reported when its step actually passed: a failed suite
 * leaves partial data that reads as a coverage regression when it is nothing
 * of the sort.
 */
export const COVERAGE_PROJECTS = [
  {
    label: "api",
    step: "unit-api",
    dir: "coverage/api",
    scope: "packages/game-engine/src, packages/shared/src",
  },
  {
    label: "web",
    step: "unit-web",
    dir: "web/coverage",
    scope: "web/src/lib",
  },
];

/** A file at or below this statement percentage gets named in the summary. */
export const LOW_FILE_THRESHOLD = 60;

/** Worst offenders promoted into `summary.log`; the rest live in `coverage.log`. */
const SUMMARY_FILE_LIMIT = 5;

/**
 * Stale reports are worse than none: they describe a tree that no longer
 * exists. Clear them before the run so a missing report stays visibly missing.
 */
export function clearCoverageReports(repoRoot) {
  for (const project of COVERAGE_PROJECTS) {
    fs.rmSync(path.join(repoRoot, project.dir), {
      recursive: true,
      force: true,
    });
  }
}

function readSummary(repoRoot, project) {
  const file = path.join(repoRoot, project.dir, "coverage-summary.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function pct(metric) {
  return typeof metric?.pct === "number" ? metric.pct : 0;
}

/**
 * Reads every project's report and pairs it with the outcome of the step that
 * was supposed to write it. Returns one entry per project, always — a project
 * that could not be measured says so rather than vanishing from the summary.
 */
export function collectCoverage({ repoRoot, results }) {
  return COVERAGE_PROJECTS.map((project) => {
    const result = results.find((r) => r.name === project.step);

    if (!result || !result.passed) {
      const reason = !result
        ? `${project.step} did not run`
        : result.skipped
          ? `${project.step} was skipped`
          : `${project.step} failed`;
      return { ...project, status: "unmeasured", reason };
    }

    const summary = readSummary(repoRoot, project);
    if (!summary?.total) {
      return {
        ...project,
        status: "unmeasured",
        reason: `no coverage report at ${project.dir}/coverage-summary.json`,
      };
    }

    const files = Object.entries(summary)
      .filter(([key]) => key !== "total")
      .map(([file, metrics]) => ({
        file: path.relative(repoRoot, file),
        statements: pct(metrics.statements),
        uncovered:
          (metrics.statements?.total ?? 0) - (metrics.statements?.covered ?? 0),
      }))
      // Biggest absolute gap first: 40% of a 300-statement module is a much
      // better use of the next hour than 40% of a six-line helper.
      .sort((a, b) => b.uncovered - a.uncovered || a.statements - b.statements);

    return {
      ...project,
      status: "ok",
      total: summary.total,
      files,
      lowFiles: files.filter((f) => f.statements <= LOW_FILE_THRESHOLD),
    };
  });
}

function totalsLine(project) {
  const { total } = project;
  const parts = [
    `stmts ${pct(total.statements).toFixed(1)}%`,
    `branch ${pct(total.branches).toFixed(1)}%`,
    `funcs ${pct(total.functions).toFixed(1)}%`,
  ];
  return `${project.label.padEnd(5)} ${parts.join("  ")}`;
}

function fileLine(entry) {
  return `  ${`${entry.statements.toFixed(1)}%`.padStart(6)}  ${String(entry.uncovered).padStart(4)} uncovered  ${entry.file}`;
}

/** The short section appended to `summary.log`, under the pass/fail verdict. */
export function formatCoverageSummary(projects) {
  const lines = ["=== Coverage ===", ""];

  for (const project of projects) {
    if (project.status !== "ok") {
      lines.push(`${project.label.padEnd(5)} not measured — ${project.reason}`);
      continue;
    }

    lines.push(totalsLine(project));

    if (project.lowFiles.length === 0) {
      lines.push(`      no file at or below ${LOW_FILE_THRESHOLD}% statements`);
      continue;
    }

    lines.push(
      `      ${project.lowFiles.length} file(s) at or below ${LOW_FILE_THRESHOLD}% statements:`,
    );
    for (const entry of project.lowFiles.slice(0, SUMMARY_FILE_LIMIT)) {
      lines.push(fileLine(entry));
    }
    const remaining = project.lowFiles.length - SUMMARY_FILE_LIMIT;
    if (remaining > 0) {
      lines.push(`      ...and ${remaining} more — see coverage.log`);
    }
  }

  lines.push("");
  lines.push("Coverage is reported, not enforced: it never fails the gate.");
  lines.push(
    "Unit suites only — code reached only over HTTP (endpoints, Svelte",
  );
  lines.push("components) reads as uncovered here even when e2e exercises it.");
  lines.push("");
  return lines.join("\n");
}

/** The full per-file breakdown, written next to `summary.log` in the run dir. */
export function formatCoverageDetail(projects) {
  const lines = [
    "=== Coverage Detail ===",
    "",
    "Measured by the unit suites alone. An endpoint or component that only the",
    "integration and e2e suites reach shows as 0% here: those drive a separate",
    "server process, which this instrumentation does not observe.",
    "",
  ];

  for (const project of projects) {
    lines.push(`--- ${project.label} (${project.scope}) ---`);

    if (project.status !== "ok") {
      lines.push(`not measured — ${project.reason}`, "");
      continue;
    }

    lines.push(totalsLine(project));
    lines.push(`html report: ${project.dir}/index.html`);
    lines.push("");

    if (project.lowFiles.length === 0) {
      lines.push(`Every file is above ${LOW_FILE_THRESHOLD}% statements.`, "");
      continue;
    }

    lines.push(
      `Files at or below ${LOW_FILE_THRESHOLD}% statements, worst gap first:`,
    );
    for (const entry of project.lowFiles) lines.push(fileLine(entry));
    lines.push("");
  }

  return lines.join("\n");
}
