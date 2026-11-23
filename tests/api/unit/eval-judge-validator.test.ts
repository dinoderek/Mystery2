// The id checks a judge's registry entry declares, run on a stored answer for
// a clue-graph case, and the workspace validator executable that runs them.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { checkAnswerIds } from "../../../evaluation/core/judge-id-checks.ts";
import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { validateJudgeAnswer } from "../../../evaluation/core/judge-output.ts";
import { getJudgeEntry } from "../../../evaluation/core/registry.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<string, Record<string, unknown>>;
const greenhouse = JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints", "clue-graph", "greenhouse-prizewinner.json"), "utf8")) as Record<string, unknown>;

type Answer = { conclusions: Array<Record<string, unknown>>; characters: Array<Record<string, unknown>> };

async function issues(id: string, change: (answer: Answer) => void): Promise<string[]> {
  const definition = await loadJudge(id);
  const answer = structuredClone(ANSWERS[`blueprint.${id}`]) as unknown as Answer;
  expect(validateJudgeAnswer(definition, answer, greenhouse)).toMatchObject({ ok: true });
  change(answer);
  const result = validateJudgeAnswer(definition, answer, greenhouse);
  expect(result).toMatchObject({ ok: false, stage: "ids" });
  return result.ok ? [] : result.messages;
}

describe("reference and coverage regressions", () => {
  it("rejects a repeated conclusion", async () => {
    const found = await issues("cg_soundness", (answer) => {
      answer.conclusions.push(answer.conclusions[0]);
    });
    expect(found).toEqual([expect.stringMatching(/^conclusions\[\d+\]\.conclusion_id ".*" appears more than once$/)]);
  });

  it("rejects an unknown character", async () => {
    const found = await issues("cg_character_grounding", (answer) => {
      answer.characters[0].character_id = "ghost";
    });
    expect(found).toEqual(expect.arrayContaining([expect.stringContaining('characters[0].character_id "ghost" is not a case character id')]));
  });

  it("requires every character of the case in the verdict", async () => {
    const found = await issues("cg_character_grounding", (answer) => {
      answer.characters = [];
    });
    expect(found.length).toBeGreaterThan(0);
    for (const message of found) expect(message).toMatch(/^characters\[\]\.character_id is missing an entry for case character id "/);
  });

  it("runs no rule on an answer when the entry declares none", () => {
    expect(checkAnswerIds([], {}, greenhouse)).toEqual([]);
    expect(getJudgeEntry("cg_truth_agreement").idChecks).toHaveLength(1);
  });

  it("reads a subject that is not a case as one with no ids", () => {
    const rules = getJudgeEntry("cg_truth_agreement").idChecks ?? [];
    expect(checkAnswerIds(rules, { findings: [{ ids: ["opening"] }] }, null)).toEqual([]);
    expect(checkAnswerIds(rules, { findings: [{ ids: ["ghost"] }] }, undefined)).toEqual([expect.stringContaining('"ghost"')]);
  });
});

describe("the workspace validator executable", () => {
  it("accepts a valid verdict and rejects a made-up id with a reference diagnostic on stderr", () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-judge-validator-"));
    try {
      fs.writeFileSync(path.join(workspace, "dimension-id"), "cg_character_grounding\n");
      fs.writeFileSync(path.join(workspace, "case.json"), JSON.stringify(greenhouse));
      const answer = structuredClone(ANSWERS["blueprint.cg_character_grounding"]) as unknown as Answer;
      const run = () => spawnSync(process.execPath, [path.resolve("evaluation/judge-harness/scripts/validate-judge-output.ts"), "verdict.json"], { cwd: workspace, encoding: "utf8" });
      fs.writeFileSync(path.join(workspace, "verdict.json"), JSON.stringify(answer));
      const valid = run();
      expect(valid.status).toBe(0);
      expect(valid.stderr).toBe("");
      expect(valid.stdout).toContain("OK: verdict.json (cg_character_grounding)");

      answer.characters[0].character_id = "ghost";
      fs.writeFileSync(path.join(workspace, "verdict.json"), JSON.stringify(answer));
      const invalid = run();
      expect(invalid.status).toBe(1);
      expect(invalid.stdout).toBe("");
      expect(invalid.stderr).toContain("INVALID cg_character_grounding verdict.json");
      expect(invalid.stderr).toContain('ids/characters[0].character_id "ghost" is not a case character id');
    } finally {
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  });
});
