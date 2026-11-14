import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  checkFloors,
  describeFailures,
  evaluateFloors,
  FLOOR_FILE,
  readFloors,
} from "../../../scripts/lib/coverage-floors.mjs";
import { GATE_STEPS } from "../../../scripts/lib/gate-steps.mjs";

/**
 * The floors decide the gate's verdict, so what matters is the edge: a project
 * exactly at its floor passes, a hair under it fails naming the project and
 * measure, and a report that is missing or empty never reads as a pass.
 */

// `scripts/lib/*.mjs` is untyped (see `tests/mjs-modules.d.ts`).
type Counts = { covered: number; total: number };
type Result = {
  label: string;
  measure: string;
  floor: number;
  actual: number | null;
  status: string;
};

const FLOORS = {
  api: { lines: 80, branches: 80 },
  web: { lines: 80, branches: 75 },
};

function summary(lines: Counts, branches: Counts) {
  return { total: { lines, branches } };
}

const AT_FLOOR = {
  api: summary({ covered: 80, total: 100 }, { covered: 80, total: 100 }),
  web: summary({ covered: 80, total: 100 }, { covered: 75, total: 100 }),
};

function evaluate(summaries: Record<string, unknown>): Result[] {
  return evaluateFloors({ floors: FLOORS, summaries });
}

describe("evaluateFloors", () => {
  it("passes a project exactly at its floors", () => {
    const results = evaluate(AT_FLOOR);

    expect(results.map((r) => r.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(describeFailures(results)).toBeNull();
  });

  it("fails just below a floor, naming the project and the measure", () => {
    const results = evaluate({
      ...AT_FLOOR,
      web: summary({ covered: 80, total: 100 }, { covered: 74, total: 100 }),
    });

    const failures = describeFailures(results);
    expect(failures).toContain("web branches");
    expect(failures).toContain("74.00%");
    expect(failures).toContain("75% floor");
    expect(failures).not.toContain("web lines");
    expect(failures).not.toContain("api");
  });

  it("reports every measure that fell short, not only the first", () => {
    const failures = describeFailures(
      evaluate({
        api: summary({ covered: 79, total: 100 }, { covered: 79, total: 100 }),
        web: AT_FLOOR.web,
      }),
    );

    expect(failures).toContain("api lines");
    expect(failures).toContain("api branches");
  });

  it("does not round a near miss up to the floor", () => {
    // 79.996% prints as 80.00 but is below 80.
    const results = evaluate({
      ...AT_FLOOR,
      api: summary(
        { covered: 79_996, total: 100_000 },
        { covered: 80, total: 100 },
      ),
    });

    expect(
      results.find((r) => r.label === "api" && r.measure === "lines"),
    ).toMatchObject({ status: "below" });
  });

  it("fails a project whose report is missing", () => {
    const failures = describeFailures(evaluate({ ...AT_FLOOR, web: null }));

    expect(failures).toContain("web lines: not measured");
    expect(failures).toContain("web branches: not measured");
  });

  it("fails a report with no totals", () => {
    const failures = describeFailures(evaluate({ ...AT_FLOOR, api: {} }));

    expect(failures).toContain("api lines: not measured");
  });

  it("fails a report whose counts are not numbers", () => {
    const failures = describeFailures(
      evaluate({
        ...AT_FLOOR,
        api: summary(
          { covered: Number.NaN, total: 100 },
          { covered: 80, total: 100 },
        ),
      }),
    );

    expect(failures).toContain("api lines: not measured");
    expect(failures).not.toContain("api branches");
  });

  it("treats a measure with nothing to cover as met", () => {
    const results = evaluate({
      ...AT_FLOOR,
      api: summary({ covered: 80, total: 100 }, { covered: 0, total: 0 }),
    });

    expect(describeFailures(results)).toBeNull();
  });
});

describe("the floor file and the gate", () => {
  let repoRoot: string;

  beforeEach(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "coverage-floors-"));
  });

  afterEach(() => {
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  function writeFloors(content: unknown) {
    fs.writeFileSync(
      path.join(repoRoot, FLOOR_FILE),
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }

  function writeReport(dir: string, summaryJson: unknown) {
    fs.mkdirSync(path.join(repoRoot, dir), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, dir, "coverage-summary.json"),
      JSON.stringify(summaryJson),
    );
  }

  it("reads the floors and the unit reports from disk", () => {
    writeFloors(FLOORS);
    writeReport("coverage/api", AT_FLOOR.api);
    writeReport("web/coverage", AT_FLOOR.web);

    expect(describeFailures(checkFloors(repoRoot))).toBeNull();
  });

  it("reads a report that was never written as not measured", () => {
    writeFloors(FLOORS);
    writeReport("coverage/api", AT_FLOOR.api);

    expect(describeFailures(checkFloors(repoRoot))).toContain(
      "web lines: not measured",
    );
  });

  it("reads an unparseable report as not measured", () => {
    writeFloors(FLOORS);
    writeReport("coverage/api", AT_FLOOR.api);
    fs.mkdirSync(path.join(repoRoot, "web/coverage"), { recursive: true });
    fs.writeFileSync(
      path.join(repoRoot, "web/coverage/coverage-summary.json"),
      "{ not json",
    );

    expect(describeFailures(checkFloors(repoRoot))).toContain(
      "web lines: not measured",
    );
  });

  it("refuses a missing, malformed or incomplete floor file", () => {
    expect(() => readFloors(repoRoot)).toThrow(FLOOR_FILE);

    writeFloors("{ not json");
    expect(() => readFloors(repoRoot)).toThrow(FLOOR_FILE);

    writeFloors({ api: FLOORS.api });
    expect(() => readFloors(repoRoot)).toThrow("web.lines");

    writeFloors({ ...FLOORS, web: { lines: 80, branches: "75" } });
    expect(() => readFloors(repoRoot)).toThrow("web.branches");

    writeFloors({ ...FLOORS, web: { lines: 180, branches: 75 } });
    expect(() => readFloors(repoRoot)).toThrow("web.lines");
  });

  it("is a phase-1 step that waits for both unit suites", () => {
    const step = GATE_STEPS.find(
      (entry: { name: string }) => entry.name === "coverage-floors",
    );

    expect(step).toMatchObject({
      phase: 1,
      after: ["unit-api", "unit-web"],
    });
  });

  it("never commits a floor below the agreed numbers", () => {
    const committed = readFloors(path.resolve(import.meta.dirname, "../../.."));

    for (const [label, measures] of Object.entries(FLOORS)) {
      for (const [measure, agreed] of Object.entries(measures)) {
        expect(committed[label][measure]).toBeGreaterThanOrEqual(agreed);
      }
    }
  });
});
