// The reading age belongs to the reader, never the case. This file guards the
// whole across the repository: no committed case, brief or fixture carries an
// age, one that does is refused by name, and the helpers that once read a case's
// age do not come back. Each part's own behaviour is in its own tests
// (`clue-graph.test.ts`, `clue-graph-generate.test.ts`, `role-request.test.ts`).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import { validateClueGraph } from "@my2/shared";
import { ClueGraphBriefSchema } from "../../../packages/blueprint-generator/src/index.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
const THIS_FILE = path.relative(ROOT, import.meta.filename);
const CASES = "blueprints/clue-graph";
const BRIEFS = "blueprints/clue-graph/briefs";

/** Every file git would show: tracked, plus untracked files not ignored. */
function repoFiles(): string[] {
  const listed = spawnSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  expect(listed.status, listed.stderr).toBe(0);
  return listed.stdout.split("\0").filter((file) => file && fs.existsSync(path.join(ROOT, file)));
}

/** The files whose text matches `pattern`, binary files aside. */
function filesNaming(pattern: RegExp): string[] {
  return repoFiles().filter((file) => {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    return !bytes.includes(0) && pattern.test(bytes.toString("utf8"));
  });
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const jsonIn = (dir: string, suffix: string) =>
  fs.readdirSync(path.join(ROOT, dir)).filter((name) => name.endsWith(suffix)).map((name) => `${dir}/${name}`);

/** Each issue's message, or none when the value parses. */
function refusals(parse: () => unknown): string[] {
  try {
    parse();
    return [];
  } catch (error) {
    if (!(error instanceof z.ZodError)) throw error;
    return error.issues.map((issue) => issue.message);
  }
}

describe("a case and a brief carry no reading age", () => {
  const cases = jsonIn(CASES, ".json");
  const briefs = jsonIn(BRIEFS, ".brief.json");

  it("finds the committed cases and briefs to check", () => {
    expect(cases).toContain(`${CASES}/mock-case.json`);
    expect(briefs.length).toBeGreaterThan(0);
  });

  it.each(cases)("%s validates, with no age", (file) => {
    const graph = validateClueGraph(readJson(file));
    expect(graph.metadata).not.toHaveProperty("target_age");
  });

  it.each(briefs)("%s parses, with no age", (file) => {
    expect(ClueGraphBriefSchema.parse(readJson(file))).not.toHaveProperty("targetAge");
  });

  it("refuses a committed case given a target_age, by name", () => {
    const graph = readJson(`${CASES}/mock-case.json`);
    const aged = { ...graph, metadata: { ...graph.metadata, target_age: 8 } };
    expect(refusals(() => validateClueGraph(aged))).toEqual([expect.stringContaining("'target_age'")]);
  });

  it("refuses a committed brief given a targetAge, by name", () => {
    const aged = { ...readJson(briefs[0]), targetAge: 8 };
    expect(refusals(() => ClueGraphBriefSchema.parse(aged))).toEqual([expect.stringContaining("'targetAge'")]);
  });

  it("names the field nowhere but in the tests that prove it is refused", () => {
    expect(filesNaming(/target_age|targetAge/).sort()).toEqual(
      [
        THIS_FILE,
        "tests/api/unit/clue-graph-generate.test.ts",
        "tests/api/unit/clue-graph-judges.test.ts",
        "tests/api/unit/clue-graph.test.ts",
      ].sort(),
    );
  });
});

describe("the age has one source, the reader", () => {
  it("has no helper that read a case's age, anywhere", () => {
    expect(filesNaming(/atReadingAge|gameReadingAge/).filter((file) => file !== THIS_FILE)).toEqual([]);
  });
});
