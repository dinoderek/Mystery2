// The baseline files in the repo: each is a whole run of its story folder, from a
// clean tree at a known commit, by the model its file is named for. `baseline
// save` refuses an incomplete run but only notes a dirty tree, so this holds the rest.

import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";

const REPO_ROOT = process.cwd();

const BASELINES = execFileSync("git", ["ls-files", "--", ":(glob)evaluation/runtime/**/baselines/*.json"], {
  cwd: REPO_ROOT,
  encoding: "utf8",
})
  .split("\n")
  .filter(Boolean);

/** The value after `flag` in a run's argv, or undefined. */
function flagValue(argv: readonly string[], flag: string): string | undefined {
  const at = argv.indexOf(flag);
  return at === -1 ? undefined : argv[at + 1];
}

describe("committed baselines", () => {
  it("are found", () => {
    expect(BASELINES.length).toBeGreaterThan(0);
  });

  it.each(BASELINES)("%s is a complete run on a clean tree at a recorded commit", (file) => {
    const summary = readSummary(path.join(REPO_ROOT, file));
    expect(summary.complete).toBe(true);
    expect(summary.run.tree_clean).toBe(true);
    expect(summary.run.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(summary.narrators.length).toBeGreaterThan(0);
  });

  it.each(BASELINES)("%s holds every sample its run asked for, of its own story folder", (file) => {
    const summary = readSummary(path.join(REPO_ROOT, file));
    const { argv } = summary.run;
    expect(argv[0]).toBe(path.posix.dirname(path.posix.dirname(file)));
    for (const narrator of summary.narrators) {
      expect(narrator.complete).toBe(true);
      expect(String(narrator.samples_per_case)).toBe(flagValue(argv, "--samples"));
      expect(narrator.cases.length).toBeGreaterThan(0);
      for (const tally of narrator.cases) {
        expect({ id: tally.id, samples: tally.samples, incomplete: tally.incomplete }).toEqual({
          id: tally.id,
          samples: narrator.samples_per_case,
          incomplete: 0,
        });
      }
    }
  });

  it.each(BASELINES)("%s comes from the model its file is named for", (file) => {
    const summary = readSummary(path.join(REPO_ROOT, file));
    const name = path.posix.basename(file, ".json");
    for (const narrator of summary.narrators) {
      expect(narrator.model).toBe(`${narrator.narrator}:${name}`);
      expect(flagValue(summary.run.argv, "--model-override")).toBe(`${narrator.narrator}=${name}`);
    }
  });
});
