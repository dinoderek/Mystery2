import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearCoverageReports,
  collectCoverage,
  formatCoverageDetail,
  formatCoverageSummary,
  LOW_FILE_THRESHOLD,
} from "../../../scripts/lib/coverage-report.mjs";

/**
 * The gate's coverage section is the one part of `summary.log` that reports a
 * number rather than a verdict, so the thing worth pinning down is that it
 * never reports a number it cannot stand behind: no stale reports, no partial
 * data from a suite that failed.
 */

// `scripts/lib/*.mjs` is untyped to TypeScript (see `tests/mjs-modules.d.ts`),
// so the shapes the reporter returns are spelled out here for the assertions.
type LowFile = { file: string; statements: number; uncovered: number };
type Project = { label: string; status: string; reason?: string };

const PASSED = [
  { name: "unit-api", passed: true },
  { name: "unit-web", passed: true },
];

let repoRoot: string;

/** Builds a `coverage-summary.json` in the istanbul shape the reporters emit. */
function writeReport(
  dir: string,
  files: Record<string, { total: number; covered: number }>,
) {
  const abs = path.join(repoRoot, dir);
  fs.mkdirSync(abs, { recursive: true });

  const entries = Object.entries(files);
  const totals = entries.reduce(
    (acc, [, m]) => ({
      total: acc.total + m.total,
      covered: acc.covered + m.covered,
    }),
    { total: 0, covered: 0 },
  );
  const metric = (m: { total: number; covered: number }) => ({
    total: m.total,
    covered: m.covered,
    skipped: 0,
    pct: m.total === 0 ? 100 : (m.covered / m.total) * 100,
  });

  const report: Record<string, unknown> = {
    total: {
      statements: metric(totals),
      branches: metric(totals),
      functions: metric(totals),
      lines: metric(totals),
    },
  };
  for (const [file, m] of entries) {
    report[path.join(repoRoot, file)] = {
      statements: metric(m),
      branches: metric(m),
      functions: metric(m),
      lines: metric(m),
    };
  }

  fs.writeFileSync(
    path.join(abs, "coverage-summary.json"),
    JSON.stringify(report),
  );
}

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-report-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

describe("collectCoverage", () => {
  it("reports totals and names every file at or below the threshold", () => {
    writeReport("coverage/api", {
      "packages/game-engine/src/thin.ts": { total: 100, covered: 20 },
      "packages/game-engine/src/thick.ts": { total: 100, covered: 95 },
    });

    const [api] = collectCoverage({ repoRoot, results: PASSED });

    expect(api.status).toBe("ok");
    expect(api.total.statements.pct).toBeCloseTo(57.5);
    expect(api.lowFiles.map((f: LowFile) => f.file)).toEqual([
      "packages/game-engine/src/thin.ts",
    ]);
  });

  it("ranks low files by uncovered statements, not by percentage", () => {
    // The six-line helper is the worse percentage; the big module is the
    // better use of anyone's next hour, and must be listed first.
    writeReport("coverage/api", {
      "packages/game-engine/src/tiny-helper.ts": { total: 6, covered: 0 },
      "packages/game-engine/src/big-module.ts": { total: 300, covered: 120 },
    });

    const [api] = collectCoverage({ repoRoot, results: PASSED });

    expect(api.lowFiles.map((f: LowFile) => f.file)).toEqual([
      "packages/game-engine/src/big-module.ts",
      "packages/game-engine/src/tiny-helper.ts",
    ]);
  });

  it("treats a file exactly at the threshold as low", () => {
    writeReport("coverage/api", {
      "packages/shared/src/borderline.ts": {
        total: 100,
        covered: LOW_FILE_THRESHOLD,
      },
    });

    const [api] = collectCoverage({ repoRoot, results: PASSED });

    expect(api.lowFiles).toHaveLength(1);
  });

  it("refuses to report numbers for a project whose step failed", () => {
    // A failed suite still leaves a report behind. Reading it would show a
    // collapse in coverage that is really just a suite that stopped early.
    writeReport("coverage/api", {
      "packages/game-engine/src/thin.ts": { total: 100, covered: 3 },
    });

    const [api] = collectCoverage({
      repoRoot,
      results: [{ name: "unit-api", passed: false }],
    });

    expect(api.status).toBe("unmeasured");
    expect(api.reason).toContain("unit-api failed");
    expect(api.total).toBeUndefined();
  });

  it("reports every project even when none of them ran", () => {
    const projects = collectCoverage({ repoRoot, results: [] });

    expect(projects).toHaveLength(2);
    expect(projects.map((p: Project) => p.label)).toEqual(["api", "web"]);
    for (const project of projects) {
      expect(project.status).toBe("unmeasured");
      expect(project.reason).toContain("did not run");
    }
  });

  it("says so when a passing step wrote no report", () => {
    const [api] = collectCoverage({ repoRoot, results: PASSED });

    expect(api.status).toBe("unmeasured");
    expect(api.reason).toContain("no coverage report");
  });
});

describe("clearCoverageReports", () => {
  it("removes both report directories so a stale one cannot be read", () => {
    writeReport("coverage/api", {
      "packages/game-engine/src/a.ts": { total: 10, covered: 10 },
    });
    writeReport("web/coverage", {
      "web/src/lib/b.ts": { total: 10, covered: 10 },
    });

    clearCoverageReports(repoRoot);

    expect(fs.existsSync(path.join(repoRoot, "coverage/api"))).toBe(false);
    expect(fs.existsSync(path.join(repoRoot, "web/coverage"))).toBe(false);
    expect(collectCoverage({ repoRoot, results: PASSED })[0].status).toBe(
      "unmeasured",
    );
  });

  it("is fine when there is nothing to clear", () => {
    expect(() => clearCoverageReports(repoRoot)).not.toThrow();
  });
});

describe("formatting", () => {
  it("puts the totals, the count and the worst offenders in the summary", () => {
    writeReport("coverage/api", {
      "packages/game-engine/src/thin.ts": { total: 100, covered: 10 },
      "packages/game-engine/src/thick.ts": { total: 100, covered: 90 },
    });

    const text = formatCoverageSummary(
      collectCoverage({ repoRoot, results: PASSED }),
    );

    expect(text).toContain("stmts 50.0%");
    expect(text).toContain(`1 file(s) at or below ${LOW_FILE_THRESHOLD}%`);
    expect(text).toContain("packages/game-engine/src/thin.ts");
    expect(text).not.toContain("packages/game-engine/src/thick.ts");
    // The gate's exit code is decided above this section, and must stay so.
    expect(text).toContain("never fails the gate");
  });

  it("caps the summary list and points at the detail file", () => {
    const files: Record<string, { total: number; covered: number }> = {};
    for (let i = 0; i < 8; i += 1) {
      files[`packages/game-engine/src/f${i}.ts`] = {
        total: 100 - i,
        covered: 0,
      };
    }
    writeReport("coverage/api", files);

    const projects = collectCoverage({ repoRoot, results: PASSED });
    const summary = formatCoverageSummary(projects);
    const detail = formatCoverageDetail(projects);

    expect(summary).toContain("...and 3 more — see coverage.log");
    expect(summary).not.toContain("f7.ts");
    expect(detail).toContain("f7.ts");
  });

  it("carries the unmeasured reason into both files", () => {
    const projects = collectCoverage({
      repoRoot,
      results: [{ name: "unit-api", passed: false }],
    });

    expect(formatCoverageSummary(projects)).toContain("not measured");
    expect(formatCoverageDetail(projects)).toContain("unit-api failed");
  });

  it("warns that the numbers come from the unit suites alone", () => {
    writeReport("coverage/api", {
      "packages/game-engine/src/a.ts": { total: 10, covered: 10 },
    });
    const projects = collectCoverage({ repoRoot, results: PASSED });

    expect(formatCoverageSummary(projects)).toContain("Unit suites only");
    expect(formatCoverageDetail(projects)).toContain(
      "Measured by the unit suites alone",
    );
  });
});
