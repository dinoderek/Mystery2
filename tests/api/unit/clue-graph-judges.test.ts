// The four judges of a clue-graph case (`evaluation/dimensions/cg-*.md`): which
// blueprints get them, what each is sent, what answers they accept, the
// player's view the step judge reads, and the broken copies they are scored on.
// The exact prompts are pinned by the snapshot tests; no model is called.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MIN_READING_AGE } from "../../../packages/shared/src/age-profile.ts";
import { validateClueGraph } from "../../../packages/shared/src/clue-graph-validator.ts";
import type { ClueGraphCase } from "../../../packages/shared/src/clue-graph-schema.ts";
import { CLUE_GRAPH_BREAKS, brokenCopy } from "../../../evaluation/blueprint/clue-graph-breaks.ts";
import { clueWaves, playerView } from "../../../evaluation/blueprint/player-view.ts";
import { briefIssues, runClueGraphChecks } from "../../../evaluation/checks/clue-graph-case.ts";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { validateJudgeAnswer } from "../../../evaluation/core/judge-output.ts";
import { composeJudgeSystemPrompt } from "../../../evaluation/core/judge-prompt.ts";
import { checksFor, judgesFor } from "../../../evaluation/core/registry.ts";
import { readResult } from "../../../evaluation/core/result.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.cwd();
const STUB = path.join(HERE, "eval-snapshot-stub.mjs");
const ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const CASE_JUDGES = ["cg_soundness", "cg_truth_agreement", "cg_character_grounding", "cg_step_sense"];
const STORIES = ["dragon-crown", "greenhouse-prizewinner"];

function story(id: string): ClueGraphCase {
  return validateClueGraph(JSON.parse(fs.readFileSync(path.join(ROOT, "blueprints", "clue-graph", `${id}.json`), "utf8")));
}

const greenhouse = story("greenhouse-prizewinner");
const dragon = story("dragon-crown");

describe("which blueprints get the clue-graph judges", () => {
  it("gives a case its own check and four judges, and nothing else", () => {
    expect(judgesFor("blueprint", { candidates: true }).map((j) => j.id)).toEqual(CASE_JUDGES);
    expect(checksFor("blueprint").map((c) => c.id)).toEqual(["clue_graph_valid"]);
  });

  it("fails every one on a major finding, and sends only the step judge the player's view", () => {
    for (const judge of judgesFor("blueprint")) {
      expect(judge.verdict, judge.id).toBe("major_findings");
      expect(judge.playerView === true, judge.id).toBe(judge.id === "cg_step_sense");
      expect(judge.prompt).toMatchObject({ preamble: "evaluation/prompts/clue-graph-judge-system.md" });
    }
  });
});

describe("the case check", () => {
  it("passes a valid case and lists each issue of an invalid one by its path", () => {
    expect(runClueGraphChecks({ blueprintCandidate: greenhouse })).toEqual([
      { id: "clue_graph_valid", kind: "mechanical", status: "pass", details: null },
    ]);
    const broken = structuredClone(greenhouse) as { clues: Record<string, { source: Record<string, string> }> };
    broken.clues.clue_boot_prints.source.location = "moon";
    const [check] = runClueGraphChecks({ blueprintCandidate: broken });
    expect(check.status).toBe("fail");
    expect((check.details as { issues: string[] }).issues).toEqual(
      expect.arrayContaining([expect.stringMatching(/^clues\.clue_boot_prints\.source\.location: .*moon/)]),
    );
  });
});

describe("each judge's prompt and answer", () => {
  it.each(CASE_JUDGES)("%s is its brief on the clue-graph preamble, stating what code checks", async (id) => {
    const definition = await loadJudge(id);
    const system = composeJudgeSystemPrompt(definition, null);
    expect(system.startsWith("# Clue-graph case evaluator")).toBe(true);
    expect(system).toContain("Do not re-judge any of these");
    expect(system).toContain(definition.text);
    expect(system).toContain("Output JSON Schema (authoritative)");
  });

  it.each(CASE_JUDGES)("%s accepts the stored answer on greenhouse and rejects a malformed one", async (id) => {
    const definition = await loadJudge(id);
    const good = ANSWERS[`blueprint.${id}`];
    expect(validateJudgeAnswer(definition, good, greenhouse)).toEqual({ ok: true, data: good });

    const noVerdict = { ...good, verdict: "maybe" };
    expect(validateJudgeAnswer(definition, noVerdict, greenhouse)).toMatchObject({ ok: false, stage: "shape" });

    const badSeverity = { ...good, findings: [{ severity: "fatal", kind: "x", ids: ["toby"], explanation: "no" }] };
    expect(validateJudgeAnswer(definition, badSeverity, greenhouse)).toMatchObject({ ok: false, stage: "shape" });

    const firstKind = (definition.schema as unknown as { shape: { findings: { element: { shape: { kind: { options: string[] } } } } } })
      .shape.findings.element.shape.kind.options[0];
    const madeUpId = { ...good, findings: [{ severity: "minor", kind: firstKind, ids: ["no_such_clue"], explanation: "Cites nothing real." }] };
    const answer = validateJudgeAnswer(definition, madeUpId, greenhouse);
    expect(answer).toMatchObject({ ok: false, stage: "ids" });
    expect((answer as { messages: string[] }).messages.join("\n")).toMatch(/no_such_clue/);
  });

  it("lets a finding cite the opening, which a step can lead from", async () => {
    const definition = await loadJudge("cg_step_sense");
    const good = ANSWERS["blueprint.cg_step_sense"];
    const finding = { severity: "minor", kind: "weak_way", ids: ["clue_hale_key_last_seen", "opening"], explanation: "The opening only hints." };
    expect(validateJudgeAnswer(definition, { ...good, findings: [finding] }, greenhouse)).toMatchObject({ ok: true });
  });

  it.each([
    ["cg_soundness", "conclusions", "conclusion_id"],
    ["cg_character_grounding", "characters", "character_id"],
    ["cg_step_sense", "steps", "clue_id"],
  ])("%s must cover every %s of the case", async (id, list, key) => {
    const definition = await loadJudge(id);
    const good = ANSWERS[`blueprint.${id}`] as Record<string, Array<Record<string, string>>>;
    const missing = good[list][0][key];
    const short = { ...good, [list]: good[list].slice(1) };
    const answer = validateJudgeAnswer(definition, short, greenhouse);
    expect(answer).toMatchObject({ ok: false, stage: "ids" });
    expect((answer as { messages: string[] }).messages.join("\n")).toContain(`"${missing}"`);
  });
});

describe("the case check and the step-sense judge, with no case age", () => {
  const brief = { brief: "A missing crown.", size: dragon.metadata.size ?? "small" };

  it("holds a case to its brief's size alone, and passes a case with no age", () => {
    expect(dragon.metadata).not.toHaveProperty("target_age");
    expect(briefIssues(brief, dragon).filter((issue) => issue.startsWith("metadata.target_age"))).toEqual([]);
    expect(briefIssues({ ...brief, targetAge: 8 }, dragon)).toEqual([expect.stringContaining("targetAge")]);
  });

  it("asks step sense about the youngest reader", () => {
    const prompt = fs.readFileSync(path.join(HERE, "../../../evaluation/dimensions/cg-step-sense.md"), "utf8");
    expect(prompt).toContain(`\`player_view.reading_age\`, ${MIN_READING_AGE}`);
    expect(prompt).not.toContain("target_age");
    expect(playerView(dragon).reading_age).toBe(MIN_READING_AGE);
  });
});

describe("the player's view", () => {
  const view = playerView(dragon);
  const step = (id: string) => view.steps.find((s) => s.clue_id === id);

  it("puts every clue in the earliest wave it can be held, from the opening", () => {
    expect(view.waves.flat().sort()).toEqual(Object.keys(dragon.clues).sort());
    expect(view.waves[0]).toEqual(expect.arrayContaining(["pike_roof", "clue_gold_on_steps", "sam_alibi_nina"]));
    expect(view.waves[0]).not.toContain("clue_crown_behind_dragon");
    expect(clueWaves(dragon)).toEqual(view.waves);
    expect(view.reading_age).toBe(MIN_READING_AGE);
  });

  it("makes a step of each ask, gate and hidden spot, leading with what is held before it", () => {
    expect(step("clue_pike_saw_bundle")).toEqual({
      clue_id: "clue_pike_saw_bundle",
      wave: 1,
      way: "ask",
      from: { character: "pike" },
      about: "the art room window",
      leads: [{ id: "pike_roof", role: "prompt", fact: dragon.clues.pike_roof.fact }],
    });
    expect(step("clue_crown_behind_dragon")).toMatchObject({
      way: "hidden_spot",
      from: { location: "art_room", spot: "behind the big paper dragon" },
      leads: [{ id: "clue_pike_saw_bundle", role: "pointer" }],
    });
    expect(step("nina_admits_practising")?.leads.map((lead) => `${lead.role}:${lead.id}`)).toEqual([
      "show:clue_script_cards",
      "hint:react_nina_cards",
    ]);
    expect(step("leo_confession")?.leads.map((lead) => lead.role)).toEqual(["after", "after"]);
    expect(step("abara_nina_wish")?.leads).toEqual([{ id: "opening", role: "prompt", fact: dragon.opening.facts.join(" ") }]);
  });

  it("leaves out free clues: first words, tells and visible spots", () => {
    for (const id of ["pike_roof", "react_leo_seat", "clue_gold_on_steps"]) expect(step(id), id).toBeUndefined();
  });

  it("counts a tell seen with a held statement as in hand", () => {
    const upset = playerView(greenhouse).steps.find((s) => s.clue_id === "clue_hale_toby_upset");
    expect(upset?.leads.map((lead) => `${lead.role}:${lead.id}`)).toEqual([
      "after:hale_toby_fine",
      "show:clue_snapped_bench",
      "hint:react_hale_gloves",
    ]);
  });
});

describe("the broken copies", () => {
  it.each(STORIES)("%s has one break for each judge, and its copy is still a valid case", (id) => {
    const original = story(id);
    expect(CLUE_GRAPH_BREAKS[id].map((entry) => entry.judge)).toEqual(CASE_JUDGES);
    const copy = brokenCopy(original) as ClueGraphCase;
    expect(() => validateClueGraph(copy)).not.toThrow();
    expect(copy.metadata).toEqual(original.metadata);
  });

  it.each(STORIES)("%s changes exactly the value at each break", (id) => {
    const original = story(id);
    const copy = brokenCopy(original);
    const valueAt = (root: unknown, at: readonly (string | number)[]) =>
      at.reduce<unknown>((node, key) => (node as Record<string | number, unknown> | undefined)?.[key], root);
    for (const entry of CLUE_GRAPH_BREAKS[id]) {
      expect(valueAt(copy, entry.at), entry.at.join(".")).toEqual(entry.value);
      expect(valueAt(original, entry.at), entry.at.join(".")).not.toEqual(entry.value);
    }
    const restored = structuredClone(copy);
    for (const entry of CLUE_GRAPH_BREAKS[id]) {
      const parent = valueAt(restored, entry.at.slice(0, -1)) as Record<string | number, unknown> | unknown[];
      const last = entry.at[entry.at.length - 1];
      const before = valueAt(original, entry.at);
      if (before === undefined && Array.isArray(parent)) parent.splice(Number(last), 1);
      else (parent as Record<string | number, unknown>)[last] = before;
    }
    expect(restored).toEqual(original);
  });

  it("refuses a case it has no breaks for", () => {
    expect(() => brokenCopy({ metadata: { id: "lighthouse" } })).toThrow(/no breaks for case "lighthouse"/);
  });
});

describe("judge blueprint on a clue-graph case", () => {
  let dir = "";
  const out: string[] = [];
  const err: string[] = [];

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-clue-graph-"));
    out.length = 0;
    err.length = 0;
    fs.copyFileSync(path.join(ROOT, "blueprints", "clue-graph", "dragon-crown.json"), path.join(dir, "dragon-crown.json"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (argv: string[]) =>
    runEval(argv, { root: ROOT, out: (t) => out.push(t), err: (t) => err.push(t), env: {} }, COMMANDS);
  const caseArgv = (...extra: string[]) => ["judge", "blueprint", path.join(dir, "dragon-crown.json"), "--output-root", path.join(dir, "out"), ...extra];

  it("needs no brief, and runs the case check with the judges left out", async () => {
    expect(await run(caseArgv("--no-judges", "--quiet"))).toBe(0);
    const [resultFile] = fs.globSync("**/result.json", { cwd: path.join(dir, "out") });
    const result = await readResult(path.join(dir, "out", resultFile));
    expect(result.verdicts.map((v) => `${v.id}:${v.status}`)).toEqual([
      "clue_graph_valid:pass",
      ...CASE_JUDGES.map((id) => `${id}:skipped`),
    ]);
  });

  it("sends each judge the case, and the step judge the player's view", async () => {
    const answersFile = path.join(dir, "answers.json");
    const capture = path.join(dir, "captured");
    const answer = { conclusions: [], characters: [], steps: [], findings: [], verdict: "pass", reasoning: "ok" };
    fs.writeFileSync(answersFile, JSON.stringify(Object.fromEntries(CASE_JUDGES.map((id) => [`blueprint.${id}`, answer]))));
    const config = path.join(dir, "config.json");
    fs.writeFileSync(
      config,
      JSON.stringify({
        "blueprint-judge": {
          cmd: process.execPath,
          args: [STUB, capture, answersFile, "blueprint.{id}", "{{system_prompt_file}}", "{{user_message_file}}"],
          extract_path: "result",
          timeout_ms: 60_000,
          retries: 0,
        },
      }),
    );
    // The stub answers in no schema's shape, so each judge errors; only what it was sent is read here.
    expect(await run(caseArgv("--config", config, "--quiet"))).toBe(2);
    for (const id of CASE_JUDGES) {
      const message = JSON.parse(fs.readFileSync(path.join(capture, `blueprint.${id}.user.txt`), "utf8"));
      expect(Object.keys(message), id).toEqual(id === "cg_step_sense" ? ["dimension_id", "context", "case", "player_view"] : ["dimension_id", "context", "case"]);
      expect(message.case).toEqual(dragon);
    }
    const sent = JSON.parse(fs.readFileSync(path.join(capture, "blueprint.cg_step_sense.user.txt"), "utf8"));
    expect(sent.player_view).toEqual(playerView(dragon));
  });

  it("refuses a brief, and a judge a case does not have", async () => {
    await expect(run(caseArgv("--brief", path.join(dir, "brief.json")))).resolves.toBe(1);
    expect(err.join("\n")).toContain("--brief");
    err.length = 0;
    await expect(run(caseArgv("--judges", "solve_depth"))).resolves.toBe(1);
    expect(err.join("\n")).toMatch(/--judges needs judge ids from: cg_soundness/);
  });

  it("fails a file that is not a clue-graph case by naming what it lacks, and judges none of it", async () => {
    fs.writeFileSync(path.join(dir, "dragon-crown.json"), JSON.stringify({ id: "old", world: {} }));
    expect(await run(caseArgv("--quiet"))).toBe(2);
    const [resultFile] = fs.globSync("**/result.json", { cwd: path.join(dir, "out") });
    const result = await readResult(path.join(dir, "out", resultFile));
    expect(result.verdicts[0]).toMatchObject({ id: "clue_graph_valid", status: "fail" });
    expect(result.verdicts.slice(1).map((v) => v.status)).toEqual(["error", "error", "error", "error"]);
    expect(result.verdicts[1].reason).toMatch(/Case failed schema validation/);
  });

  it("validates a case with no model, and fails one that is not valid", async () => {
    expect(await run(["validate", path.join(dir, "dragon-crown.json"), "--output-root", path.join(dir, "out")])).toBe(0);
    fs.writeFileSync(path.join(dir, "dragon-crown.json"), JSON.stringify({ format: "clue-graph/2" }));
    expect(await run(["validate", path.join(dir, "dragon-crown.json"), "--output-root", path.join(dir, "out2")])).toBe(2);
  });
});
