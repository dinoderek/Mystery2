import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { STEPS } from "../../../scripts/lib/gate-steps.mjs";
import {
  describeUncovered,
  findUncoveredTestFiles,
  listTestFiles,
} from "../../../scripts/lib/gate-coverage.mjs";

const steps = [
  { name: "lint", args: ["run", "lint"] },
  { name: "unit", roots: ["tests/api/unit"] },
  { name: "web", roots: ["web/src/lib/domain/"] },
];

describe("findUncoveredTestFiles", () => {
  it("passes when every test file is under a step's roots", () => {
    expect(
      findUncoveredTestFiles(
        ["tests/api/unit/a.test.ts", "web/src/lib/domain/b.spec.ts"],
        steps,
      ),
    ).toEqual([]);
  });

  it("names each test file that no step covers", () => {
    expect(
      findUncoveredTestFiles(
        [
          "tests/api/unit/a.test.ts",
          "tests/foo.test.ts",
          "packages/x/src/y.test.ts",
          "tests/api/unit-other/z.test.ts",
        ],
        steps,
      ),
    ).toEqual([
      "tests/foo.test.ts",
      "packages/x/src/y.test.ts",
      "tests/api/unit-other/z.test.ts",
    ]);
  });

  it("ignores files that are not test files", () => {
    expect(findUncoveredTestFiles(["tests/setup-env.ts"], steps)).toEqual([]);
  });

  it("reports the failure with each file named", () => {
    const text = describeUncovered(["tests/foo.test.ts"], steps);
    expect(text).toContain("tests/foo.test.ts");
    expect(describeUncovered([], steps)).toBeNull();
  });
});

describe("the gate's real steps", () => {
  it("build the Vitest commands from the declared roots", () => {
    const web = STEPS.find((s: { name: string }) => s.name === "unit-web")!;
    expect(web.args).toContain("src/lib/domain");
    const api = STEPS.find((s: { name: string }) => s.name === "unit-api")!;
    expect(api.args).toContain("tests/api/unit");
  });
});

describe("listTestFiles", () => {
  let repo: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "gate-coverage-"));
    const git = (...args: string[]) => execFileSync("git", args, { cwd: repo });
    git("init", "-q");
    fs.writeFileSync(path.join(repo, ".gitignore"), "ignored/\n");
    fs.mkdirSync(path.join(repo, "tests"));
    fs.mkdirSync(path.join(repo, "ignored"));
    fs.writeFileSync(path.join(repo, "tests/tracked.test.ts"), "");
    fs.writeFileSync(path.join(repo, "tests/gone.test.ts"), "");
    git("add", ".");
    git(
      "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init",
    );
    fs.rmSync(path.join(repo, "tests/gone.test.ts"));
    fs.writeFileSync(path.join(repo, "tests/untracked.test.ts"), "");
    fs.writeFileSync(path.join(repo, "ignored/skipped.test.ts"), "");
    fs.writeFileSync(path.join(repo, "tests/helper.ts"), "");
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
  });

  it("lists tracked and untracked unignored test files, not deleted or ignored ones", () => {
    expect(listTestFiles(repo)).toEqual([
      "tests/tracked.test.ts",
      "tests/untracked.test.ts",
    ]);
  });
});
