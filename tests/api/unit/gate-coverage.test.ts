import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  excludeArgs,
  GATE_STEPS,
  OPT_IN_SUITES,
} from "../../../scripts/lib/gate-steps.mjs";
import {
  describeUncovered,
  findOptInFilesTheGateRuns,
  findUncoveredTestFiles,
  listTestFiles,
} from "../../../scripts/lib/gate-coverage.mjs";

const steps = [
  { name: "lint", args: ["run", "lint"] },
  { name: "unit", roots: ["tests/api/unit"], files: /\.test\.ts$/ },
  {
    name: "browser",
    roots: ["web/e2e/"],
    files: /\.(test|spec)\.[cm]?[jt]sx?$/,
  },
];

describe("findUncoveredTestFiles", () => {
  it("passes when every test file is under a step's roots", () => {
    expect(
      findUncoveredTestFiles(
        ["tests/api/unit/a.test.ts", "web/e2e/b.spec.ts"],
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

  it("names a file under a root that the step's runner would not collect", () => {
    expect(
      findUncoveredTestFiles(
        ["tests/api/unit/a.spec.ts", "tests/api/unit/b.test.tsx"],
        steps,
      ),
    ).toEqual(["tests/api/unit/a.spec.ts", "tests/api/unit/b.test.tsx"]);
  });

  it("ignores files that are not test files", () => {
    expect(findUncoveredTestFiles(["tests/setup-env.ts"], steps)).toEqual([]);
  });

  it("does not count a file under a root the step excludes", () => {
    const excluding = [
      { name: "int", roots: ["tests/int"], exclude: ["tests/int/live"], files: /\.test\.ts$/ },
    ];
    expect(
      findUncoveredTestFiles(
        ["tests/int/a.test.ts", "tests/int/live/b.test.ts"],
        excluding,
      ),
    ).toEqual(["tests/int/live/b.test.ts"]);
  });

  it("names an opt-in file that a gate step also runs", () => {
    const optIn = [{ name: "live", roots: ["tests/int/live"], files: /\.test\.ts$/ }];
    const files = ["tests/int/a.test.ts", "tests/int/live/b.test.ts"];
    const including = [{ name: "int", roots: ["tests/int"], files: /\.test\.ts$/ }];
    expect(findOptInFilesTheGateRuns(files, including, optIn)).toEqual([
      "tests/int/live/b.test.ts",
    ]);
    const excluding = [{ ...including[0], exclude: ["tests/int/live"] }];
    expect(findOptInFilesTheGateRuns(files, excluding, optIn)).toEqual([]);
    const text = describeUncovered([], including, ["tests/int/live/b.test.ts"]);
    expect(text).toContain("declared opt-in that a gate step also runs");
    expect(text).toContain("tests/int/live/b.test.ts");
  });

  it("reports the failure with each file named", () => {
    const text = describeUncovered(["tests/foo.test.ts"], steps);
    expect(text).toContain("tests/foo.test.ts");
    expect(describeUncovered([], steps)).toBeNull();
  });
});

describe("the gate's real steps", () => {
  it("build the Vitest commands from the declared roots", () => {
    const web = GATE_STEPS.find(
      (s: { name: string }) => s.name === "unit-web",
    )!;
    expect(web.args).toContain("src/lib/domain");
    const api = GATE_STEPS.find(
      (s: { name: string }) => s.name === "unit-api",
    )!;
    expect(api.args).toContain("tests/api/unit");
  });

  it("leave every opt-in suite's files to the opt-in suite", () => {
    const files = OPT_IN_SUITES.flatMap((suite: { roots: string[] }) =>
      suite.roots.map((root) => `${root}/x.test.ts`),
    );
    expect(files.length).toBeGreaterThan(0);
    expect(findUncoveredTestFiles(files, OPT_IN_SUITES)).toEqual([]);
    expect(findUncoveredTestFiles(files, GATE_STEPS)).toEqual(files);
  });

  it("pass each excluded root to Vitest as an exclude glob", () => {
    const integration = GATE_STEPS.find(
      (s: { name: string }) => s.name === "integration",
    )!;
    expect(excludeArgs(integration)).toEqual([
      "--exclude",
      "tests/api/integration/live-ai/**",
    ]);
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
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "commit",
      "-q",
      "-m",
      "init",
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
