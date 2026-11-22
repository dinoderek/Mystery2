// The trails command: a case's graph printed as trails, through the
// validator's own parse and reach code (`docs/clue-graph.md`). No model.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { clueGraphTrails, reachClues, validateClueGraph, type ClueGraphCase } from "@my2/shared";

const GREENHOUSE = "blueprints/clue-graph/greenhouse-prizewinner.json";
const DRAGON_CROWN = "blueprints/clue-graph/dragon-crown.json";
// Regenerate with `node scripts/print-clue-graph-trails.mjs <GREENHOUSE> > <EXPECTED>` and read the diff.
const EXPECTED = "tests/api/unit/fixtures/clue-graph-greenhouse-trails.txt";

const load = (file: string): ClueGraphCase => validateClueGraph(JSON.parse(fs.readFileSync(file, "utf8")));

/** The text of one conclusion's section. */
function section(trails: string, id: string): string {
  const start = trails.indexOf(`## \`${id}\``);
  const next = trails.indexOf("\n## ", start + 1);
  return trails.slice(start, next === -1 ? undefined : next);
}

describe("clueGraphTrails", () => {
  const greenhouse = load(GREENHOUSE);
  const trails = clueGraphTrails(greenhouse);

  it("prints the greenhouse graph as the checked-in trails", () => {
    expect(trails).toBe(fs.readFileSync(EXPECTED, "utf8"));
  });

  it("has a section for every conclusion: each culprit route and each clearing", () => {
    for (const [id, conclusion] of Object.entries(greenhouse.conclusions)) {
      expect(trails).toContain(`## \`${id}\``);
      expect(section(trails, id)).toContain(conclusion.text);
    }
    expect(section(trails, "culprit_toby")).toContain("names the culprit, Toby");
    expect(section(trails, "culprit_toby")).toContain("### Trail 3 of 3");
    expect(section(trails, "thorne_cleared")).toContain("clears Mr. Thorne");
    expect(section(trails, "mia_cleared")).toContain("clears Mia");
  });

  it("shows how a retraction and a gated clue open", () => {
    const route = section(trails, "culprit_toby");
    expect(route).toContain("- `toby_blames_thorne` (statement, false; Toby, The Potting Shed)");
    expect(route).toContain("  - taken back by: `toby_drops_burglar`");
    expect(route).toContain("  - takes back: `toby_blames_thorne`");
    expect(route).toContain("  - reached: show clue_welly_prints or clue_key_in_water_butt");
    expect(route).toContain("  - reached: asked once toby_drops_burglar and toby_not_mia are out");
    expect(trails).toContain("  - line of questioning: They promise to be fair to Toby");
    expect(trails).toContain("  - why it is said: A burglar keeps eyes off him.");
  });

  it.each([GREENHOUSE, DRAGON_CROWN])("prints each clue's way in as the validator reaches it: %s", (file) => {
    const graph = load(file);
    const by = new Map(reachClues(graph).map((entry) => [entry.id, entry.by]));
    const printed = clueGraphTrails(graph);
    let steps = 0;
    for (const match of printed.matchAll(/^- `([^`]+)` \(.*\n {2}- reached: (.*)$/gm)) {
      expect(match[2]).toBe(by.get(match[1]));
      expect(printed).toContain(graph.clues[match[1]].fact);
      steps++;
    }
    expect(steps).toBeGreaterThan(0);
  });

  it("shows a hidden spot's clue after the clue that reveals it", () => {
    const graph = load(DRAGON_CROWN);
    const hidden = Object.values(graph.locations).flatMap((place) => place.spots.filter((spot) => spot.revealed_by));
    expect(hidden.length).toBeGreaterThan(0);
    const printed = clueGraphTrails(graph);
    for (const spot of hidden) {
      const reveals = `\`${spot.revealed_by}\``;
      const found = Object.entries(graph.clues).find(([, clue]) => clue.kind === "evidence" && clue.source.spot === spot.name)!;
      const afterReveal = printed.split("\n").map((line) => line.includes(`- \`${found[0]}\``)).lastIndexOf(true);
      expect(afterReveal).toBeGreaterThan(printed.split("\n").findIndex((line) => line.startsWith(`- ${reveals}`)));
    }
  });
});

describe("the trails command", () => {
  function run(args: string[]) {
    return spawnSync(process.execPath, ["scripts/print-clue-graph-trails.mjs", ...args], { encoding: "utf8", timeout: 5000 });
  }
  function validate(args: string[]) {
    return spawnSync(process.execPath, ["scripts/validate-clue-graph.mjs", ...args], { encoding: "utf8", timeout: 5000 });
  }

  it("prints the trails of a file", () => {
    expect(run([DRAGON_CROWN])).toMatchObject({ status: 0, stdout: clueGraphTrails(load(DRAGON_CROWN)) });
  });

  it("exits as the validator does, with its message, on an invalid file, an unreadable one and misuse", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "clue-graph-trails-"));
    const file = path.join(dir, "case.json");
    try {
      const broken = { ...load(GREENHOUSE), format: "clue-graph/1" };
      fs.writeFileSync(file, JSON.stringify(broken));
      const invalid = run([file]);
      expect(invalid).toMatchObject({ status: 1, stdout: "" });
      expect(invalid.stderr).toContain('Format "clue-graph/1" is not read');
      expect(invalid.stderr).toBe(validate([file]).stderr);

      const unbudgeted = load(GREENHOUSE);
      unbudgeted.metadata.time_budget = 4;
      fs.writeFileSync(file, JSON.stringify(unbudgeted));
      expect(run([file])).toMatchObject({ status: 1, stdout: "", stderr: validate([file]).stderr });

      fs.writeFileSync(file, "{");
      expect(run([file])).toMatchObject({ status: 2, stderr: validate([file]).stderr });
      expect(run([path.join(dir, "missing.json")])).toMatchObject({ status: 2, stderr: expect.stringContaining("ENOENT") });
      expect(run([])).toMatchObject({ status: 3, stderr: "usage: print-clue-graph-trails.mjs <case.json>\n" });
      expect(run([file, "extra"])).toMatchObject({ status: 3 });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
