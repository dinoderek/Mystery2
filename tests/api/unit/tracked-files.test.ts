// No file named `ai.json` is ever tracked: it may hold keys in clear and the
// repository is public. The ignore rule keeps it out, the example ships
// without a key, and the gate's `tracked-files` step catches a forced add.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseAIConfig } from "../../../packages/game-engine/src/ai-config.ts";
import { GATE_STEPS } from "../../../scripts/lib/gate-steps.mjs";
import {
  describeForbidden,
  findForbiddenFiles,
  listTrackedFiles,
} from "../../../scripts/lib/tracked-files.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");

describe("the tracked-files check", () => {
  it("fails on ai.json at any depth, naming each", () => {
    const listing = ["README.md", "ai.json", "web/src/ai.json", "deep/er/ai.json", "ai.example.json", "not-ai.json", "ai.json.bak"];
    expect(findForbiddenFiles(listing)).toEqual(["ai.json", "web/src/ai.json", "deep/er/ai.json"]);
    expect(describeForbidden(findForbiddenFiles(listing))).toMatch(/3 tracked files that may hold keys:\n {2}ai\.json\n/);
  });

  it("passes a listing without one", () => {
    expect(describeForbidden(findForbiddenFiles(["ai.example.json", "package.json"]))).toBeNull();
  });

  it("is a gate step, and passes on this repository", () => {
    expect(GATE_STEPS.map((step: { name: string }) => step.name)).toContain("tracked-files");
    const tracked = listTrackedFiles(REPO_ROOT);
    expect(tracked).toContain("package.json");
    expect(findForbiddenFiles(tracked)).toEqual([]);
  });
});

describe("keeping ai.json out of git", () => {
  it("ignores ai.json at the root and below, but not the example", () => {
    const ignored = execFileSync("git", ["check-ignore", "--no-index", "ai.json", "web/ai.json", "ai.example.json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    }).trim().split("\n");
    expect(ignored).toEqual(["ai.json", "web/ai.json"]);
  });

  it("ships an example that parses with the schema and carries no key", () => {
    const example = parseAIConfig(JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "ai.example.json"), "utf8")));
    expect(Object.keys(example.ais).length).toBeGreaterThan(0);
    expect(Object.values(example.ais).every((entry) => entry.key === undefined)).toBe(true);
  });
});
