import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { runQuality } from "../../../scripts/lib/check-quality.mjs";

const OVER = "packages/shared/src/over.ts";
const UNDER = "packages/shared/src/under.ts";

const tooLong = `export function tooLong(): number {\n  let n = 0;\n${"  n += 1;\n".repeat(200)}  return n;\n}\n`;
const tooComplex = `export function tooComplex(a: boolean): number {\n  let n = 0;\n${"  if (a) {\n    n += 1;\n  }\n".repeat(26)}  return n;\n}\n`;
const tooDeep = `export function tooDeep(a: boolean): number {
  let n = 0;
  if (a) { if (a) { if (a) { if (a) { if (a) { n += 1; } } } } }
  return n;
}\n`;
const tooManyParams =
  "export function tooMany(a: number, b: number, c: number, d: number, e: number, f: number) {\n  return a + b + c + d + e + f;\n}\n";

const atTheLimits = `export function fiveParams(a: number, b: number, c: number, d: number, e: number) {
  let n = 0;
  if (a) { if (b) { if (c) { if (d) { n += e; } } } }
  return n;
}\n`;

let dir: string;
let baselines: string;

function setUp(root: string, files: Record<string, string>) {
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, text);
  }
}

describe("quality limits", () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "quality-limits-"));
    baselines = path.join(dir, "baselines");
    fs.mkdirSync(baselines);
    fs.writeFileSync(path.join(baselines, "none.json"), "{}");
  });

  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("fails a function over each limit, naming the limit", () => {
    const root = path.join(dir, "over");
    setUp(root, { [OVER]: tooLong + tooComplex + tooDeep + tooManyParams });
    const { status, output } = runQuality({
      cwd: root,
      baseline: path.join(baselines, "none.json"),
    });
    expect(status).toBe(1);
    expect(output).toContain("max-lines-per-function");
    expect(output).toContain("sonarjs/cognitive-complexity");
    expect(output).toContain("max-depth");
    expect(output).toContain("max-params");
  });

  it("passes functions at the limits", () => {
    const root = path.join(dir, "under");
    setUp(root, { [UNDER]: atTheLimits });
    const { status, output } = runQuality({
      cwd: root,
      baseline: path.join(baselines, "none.json"),
    });
    expect(output).toBe("");
    expect(status).toBe(0);
  });

  it("passes the offenders a baseline lists, and no more of them", () => {
    const root = path.join(dir, "over");
    const baseline = path.join(baselines, "over.json");
    const listed = {
      [OVER]: {
        "max-lines-per-function": { count: 1 },
        "sonarjs/cognitive-complexity": { count: 1 },
        "max-depth": { count: 1 },
        "max-params": { count: 1 },
      },
    };
    fs.writeFileSync(baseline, JSON.stringify(listed));
    expect(runQuality({ cwd: root, baseline }).status).toBe(0);

    // A second offender in the same file is new, so it fails.
    fs.appendFileSync(
      path.join(root, OVER),
      tooManyParams.replace("tooMany", "another"),
    );
    const { status, output } = runQuality({ cwd: root, baseline });
    expect(status).toBe(1);
    expect(output).toContain("max-params");
  });

  it("fails a baseline entry for a violation that no longer exists", () => {
    const root = path.join(dir, "under");
    const baseline = path.join(baselines, "stale.json");
    fs.writeFileSync(
      baseline,
      JSON.stringify({ [UNDER]: { "max-params": { count: 1 } } }),
    );
    const { status, output } = runQuality({ cwd: root, baseline });
    expect(status).not.toBe(0);
    expect(output).toContain("suppressions left that do not occur anymore");

    // Pruning removes the stale entry and the check then passes.
    expect(runQuality({ cwd: root, baseline, prune: true }).status).toBe(0);
    expect(runQuality({ cwd: root, baseline }).status).toBe(0);
  });

  it("fails a baseline count above what still occurs", () => {
    const root = path.join(dir, "under");
    const baseline = path.join(baselines, "count.json");
    fs.writeFileSync(path.join(root, UNDER), tooManyParams);
    fs.writeFileSync(
      baseline,
      JSON.stringify({ [UNDER]: { "max-params": { count: 2 } } }),
    );
    const { status, output } = runQuality({ cwd: root, baseline });
    expect(status).not.toBe(0);
    expect(output).toContain("do not occur anymore");
  });
});
