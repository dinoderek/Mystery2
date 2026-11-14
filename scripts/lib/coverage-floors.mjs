/**
 * The coverage floors: the lowest unit-suite line and branch coverage the gate
 * accepts per measured project. The numbers live in `coverage-floors.json`,
 * keyed by the labels in `COVERAGE_PROJECTS`, and are read here rather than
 * written into code so that raising one is a one-line change.
 *
 * A project that cannot be measured fails the check. Reading `not measured` as
 * a pass would let a unit suite that never wrote a report slip through.
 */

import fs from "node:fs";
import path from "node:path";

import { COVERAGE_PROJECTS, readSummary } from "./coverage-report.mjs";

export const FLOOR_FILE = "coverage-floors.json";

/** The measures a floor can name, as istanbul's summary calls them. */
export const MEASURES = ["lines", "branches"];

/**
 * Reads and validates the floor file. Throws on a missing or malformed file,
 * or on a measured project with no floor, since a project without one would
 * silently stop being held to anything.
 */
export function readFloors(repoRoot) {
  const file = path.join(repoRoot, FLOOR_FILE);
  let floors;
  try {
    floors = JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch (err) {
    throw new Error(`cannot read ${FLOOR_FILE}: ${err.message ?? err}`);
  }
  for (const project of COVERAGE_PROJECTS) {
    for (const measure of MEASURES) {
      const floor = floors?.[project.label]?.[measure];
      if (typeof floor !== "number" || !(floor >= 0 && floor <= 100)) {
        throw new Error(
          `${FLOOR_FILE}: "${project.label}.${measure}" must be a number from 0 to 100`,
        );
      }
    }
  }
  return floors;
}

/**
 * Percentage from the counts, not from the report's `pct`, which is rounded to
 * two places and would let 79.996% read as 80. Null when the counts are absent.
 */
function percent(metric) {
  const { covered, total } = metric ?? {};
  if (!Number.isFinite(covered) || !Number.isFinite(total)) return null;
  return total === 0 ? 100 : (covered / total) * 100;
}

/**
 * Compares each project's summary with its floors. `summaries` maps a project
 * label to its parsed `coverage-summary.json` (null when there is none).
 * Returns one entry per project and measure: `{ label, measure, floor, actual,
 * status }` with status `ok`, `below` or `not-measured`.
 */
export function evaluateFloors({ floors, summaries }) {
  const results = [];
  for (const project of COVERAGE_PROJECTS) {
    for (const measure of MEASURES) {
      const floor = floors[project.label][measure];
      const actual = percent(summaries[project.label]?.total?.[measure]);
      let status = "ok";
      if (actual === null) status = "not-measured";
      else if (actual < floor) status = "below";
      results.push({ label: project.label, measure, floor, actual, status });
    }
  }
  return results;
}

function describe(result) {
  const name = `${result.label} ${result.measure}`;
  if (result.status === "not-measured") {
    return `${name}: not measured (no ${result.label} unit coverage report)`;
  }
  return `${name}: ${result.actual.toFixed(2)}% is below the ${result.floor}% floor`;
}

/** The failures as one message, or null when every measure meets its floor. */
export function describeFailures(results) {
  const failed = results.filter((r) => r.status !== "ok");
  return failed.length === 0 ? null : failed.map(describe).join("\n");
}

/** One line per measure, for the passing case. */
export function describeResults(results) {
  return results
    .map(
      (r) =>
        `${r.label} ${r.measure}: ${r.actual === null ? "not measured" : `${r.actual.toFixed(2)}%`} (floor ${r.floor}%)`,
    )
    .join("\n");
}

/** Reads the floor file and every report under `repoRoot`, then evaluates. */
export function checkFloors(repoRoot) {
  const floors = readFloors(repoRoot);
  const summaries = Object.fromEntries(
    COVERAGE_PROJECTS.map((p) => [p.label, readSummary(repoRoot, p)]),
  );
  return evaluateFloors({ floors, summaries });
}
