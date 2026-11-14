import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { checkAnswerIds } from "../../../evaluation/core/judge-id-checks.ts";
import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { validateJudgeAnswer } from "../../../evaluation/core/judge-output.ts";
import { getJudgeEntry } from "../../../evaluation/core/registry.ts";
import type { JudgeOutput as SolveAnswer } from "../../../evaluation/dimensions/solve-depth.schema.ts";
import { validBlueprintV2 as blueprint } from "./fixtures/blueprint-v2.fixture.ts";

const culprit = blueprint.world.characters.find((c) => c.is_culprit)!;
const innocent = blueprint.world.characters.find((c) => !c.is_culprit)!;

function solveAnswer(): SolveAnswer {
  return {
    paths: blueprint.solution_paths.map((p) => ({ id: p.id, reaches_culprit: true, necessary_clues: [...p.location_clue_ids, ...p.character_clue_ids], length: 3, reasoning: "r" })),
    elimination_paths: blueprint.suspect_elimination_paths.map((p) => ({ id: p.id, suspect_id: innocent.id, necessary_clues: [...p.location_clue_ids, ...p.character_clue_ids], length: 2, reasoning: "r" })),
    uncovered_suspects: [],
    solvable: true,
    shortest_path_id: blueprint.solution_paths[0].id,
    min_length: 3,
    min_required: 3,
    verdict: "pass",
    reasoning: "r",
  };
}

async function solveIssues(change: (answer: SolveAnswer) => void): Promise<string[]> {
  const definition = await loadJudge("solve_depth");
  const answer = solveAnswer();
  expect(validateJudgeAnswer(definition, answer, blueprint)).toMatchObject({ ok: true });
  change(answer);
  const result = validateJudgeAnswer(definition, answer, blueprint);
  expect(result).toMatchObject({ ok: false, stage: "ids" });
  return result.ok ? [] : result.messages;
}

describe("solve-depth reference and coverage regressions", () => {
  it("rejects an empty shortest_path_id", async () => {
    expect(await solveIssues((a) => { a.shortest_path_id = ""; })).toEqual([
      expect.stringContaining('shortest_path_id "" is not a enumerated path id'),
    ]);
  });

  it("accepts a null or missing shortest path, and an empty or missing elimination suspect", () => {
    const rules = getJudgeEntry("solve_depth").idChecks ?? [];
    for (const shortest of [null, undefined]) {
      for (const suspect of ["", null, undefined]) {
        const answer = solveAnswer();
        const partial = { ...answer, shortest_path_id: shortest, elimination_paths: answer.elimination_paths.map((p) => ({ ...p, suspect_id: suspect })) };
        expect(checkAnswerIds(rules, partial, blueprint)).toEqual([]);
      }
    }
  });

  it("rejects a repeated solution path", async () => {
    expect(await solveIssues((a) => { a.paths.push(a.paths[0]); })).toEqual([
      expect.stringContaining(`paths[${blueprint.solution_paths.length}].id "${blueprint.solution_paths[0].id}" appears more than once`),
    ]);
  });

  it("rejects an unknown elimination path", async () => {
    expect(await solveIssues((a) => { a.elimination_paths[0].id = "ghost"; })).toEqual(expect.arrayContaining([
      expect.stringContaining('elimination_paths[0].id "ghost" is not a blueprint suspect elimination path id'),
    ]));
  });

  it("rejects a repeated elimination path", async () => {
    expect(await solveIssues((a) => { a.elimination_paths.push(a.elimination_paths[0]); })).toEqual([
      expect.stringContaining(`elimination_paths[1].id "${blueprint.suspect_elimination_paths[0].id}" appears more than once`),
    ]);
  });

  it("requires every authored elimination path in the verdict", async () => {
    expect(await solveIssues((a) => { a.elimination_paths = []; })).toEqual([
      `elimination_paths[].id is missing an entry for blueprint suspect elimination path id "${blueprint.suspect_elimination_paths[0].id}"`,
    ]);
  });

  it("rejects an unknown elimination suspect", async () => {
    expect(await solveIssues((a) => { a.elimination_paths[0].suspect_id = "ghost"; })).toEqual([
      expect.stringContaining('elimination_paths[0].suspect_id "ghost" is not a blueprint character id'),
    ]);
  });

  it("rejects an unknown elimination clue", async () => {
    expect(await solveIssues((a) => { a.elimination_paths[0].necessary_clues = ["ghost"]; })).toEqual([
      expect.stringContaining('elimination_paths[0].necessary_clues[0] "ghost" is not a blueprint clue id'),
    ]);
  });

  it.each(["ghost", culprit.id])("rejects %s as an uncovered non-culprit", async (id) => {
    expect(await solveIssues((a) => { a.uncovered_suspects = [id]; })).toEqual([
      expect.stringContaining(`uncovered_suspects[0] "${id}" is not a non-culprit character id`),
    ]);
  });
});

describe("character-grounding coverage regressions", () => {
  it.each(["duplicate", "missing"])("rejects a %s character", async (change) => {
    const definition = await loadJudge("character_grounding");
    const answer = {
      characters: blueprint.world.characters.map((c) => ({ character_id: c.id, first_name: c.first_name, topics: [], passes: true })),
      verdict: "pass",
      reasoning: "r",
    };
    expect(validateJudgeAnswer(definition, answer, blueprint)).toMatchObject({ ok: true });
    const first = answer.characters[0];
    if (change === "duplicate") answer.characters.push(first);
    else answer.characters.shift();
    const result = validateJudgeAnswer(definition, answer, blueprint);
    expect(result).toMatchObject({ ok: false, stage: "ids" });
    expect(!result.ok && result.messages).toEqual([
      change === "duplicate"
        ? `characters[${blueprint.world.characters.length}].character_id "${first.character_id}" appears more than once`
        : `characters[].character_id is missing an entry for blueprint character id "${first.character_id}"`,
    ]);
  });
});

describe("the workspace validator executable", () => {
  it("accepts a valid verdict and rejects an empty shortest path with a reference diagnostic on stderr", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-judge-validator-"));
    try {
      fs.writeFileSync(path.join(workspace, "dimension-id"), "solve_depth\n");
      fs.writeFileSync(path.join(workspace, "blueprint.json"), JSON.stringify(blueprint));
      fs.writeFileSync(path.join(workspace, "context.json"), "{}");
      const answer = solveAnswer();
      const run = () => spawnSync(process.execPath, [path.resolve("evaluation/judge-harness/scripts/validate-judge-output.ts"), "verdict.json"], { cwd: workspace, encoding: "utf8" });
      fs.writeFileSync(path.join(workspace, "verdict.json"), JSON.stringify(answer));
      const valid = run();
      expect(valid.status).toBe(0);
      expect(valid.stderr).toBe("");
      expect(valid.stdout).toContain("OK: verdict.json (solve_depth)");

      answer.shortest_path_id = "";
      fs.writeFileSync(path.join(workspace, "verdict.json"), JSON.stringify(answer));
      const invalid = run();
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain("INVALID solve_depth verdict.json — 1 reference/coverage issue(s)");
      expect(invalid.stderr).toContain('ids/shortest_path_id "" is not a enumerated path id');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
