// `./dev generate` writing clue-graph cases, run in-process on stub bindings:
// briefs go through the real command, runner, registry, case validator and
// result schema. The generator is a stub agent answering each round from a
// list, and the judges a stub answering from the case it is sent; no model is
// called, and `--install` only ever writes into a temporary config root.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildClueGraphGenerationChatInput } from "../../../packages/blueprint-generator/src/index.ts";
import { MAX_TARGET_AGE, MIN_TARGET_AGE, renderGenerationGuidance } from "../../../packages/shared/src/age-profile.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { CLUE_GRAPH_REPAIR, parseBackends, parseFormat, parseRepair } from "../../../evaluation/generate/commands.ts";
import { REPORTS_NOTICE } from "../../../evaluation/generate/repair.ts";
import { main } from "../../../scripts/dev-cli.mjs";
import { countWords } from "../../../scripts/lib/word-budgets.mjs";
import { floors, sizedCase } from "./fixtures/clue-graph-sized.ts";
import { generatorBrief } from "./fixtures/generator-brief.ts";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const SETUP = path.join(REPO_ROOT, "evaluation/generator-harness/setup-workspace.sh");

/** A small case at its size's floors, which the validator passes. */
const good = sizedCase(floors("small"), "small");
/** The same case one gated clue short of its size. */
const thin = sizedCase({ ...floors("small"), gated_clues: 2 }, "small");
const brief = { brief: "A missing cake at a village fete.", targetAge: good.metadata.target_age, size: "small" };

let dir = "";
let out: string[] = [];
let err: string[] = [];

function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

/**
 * A config whose generator answers round n with `answers[n]` (exiting 1 past
 * the end) and keeps every message, system prompt and format it is sent under
 * `calls/<round>`, and whose judges pass every case unless named in
 * `failing`, which they fail with one major finding.
 */
function stubConfig(answers: unknown[], failing: string[] = []): string {
  const answersFile = write("answers.json", answers);
  const calls = path.join(dir, "calls");
  const generator = write(
    "generator.mjs",
    `import fs from "node:fs";
     import path from "node:path";
     const [systemFile, userFile] = process.argv.slice(2);
     const message = JSON.parse(fs.readFileSync(userFile, "utf8"));
     const round = message.repair ? message.repair.round : 0;
     const folder = path.join(${JSON.stringify(calls)}, String(round));
     fs.mkdirSync(folder, { recursive: true });
     fs.writeFileSync(path.join(folder, "message.json"), JSON.stringify(message));
     fs.writeFileSync(path.join(folder, "system.md"), fs.readFileSync(systemFile, "utf8"));
     fs.writeFileSync(path.join(folder, "format"), process.env.EVAL_GENERATE_FORMAT ?? "");
     const answers = JSON.parse(fs.readFileSync(${JSON.stringify(answersFile)}, "utf8"));
     if (round >= answers.length) process.exit(1);
     process.stdout.write(JSON.stringify({ total_cost_usd: 1, result: JSON.stringify(answers[round]) }));`,
  );
  const judge = write(
    "judge.mjs",
    `import fs from "node:fs";
     const message = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
     const graph = message.case;
     const fails = ${JSON.stringify(failing)}.includes(message.dimension_id);
     const answer = {
       findings: fails ? [{ severity: "major", kind: "contradicts_timeline", ids: [Object.keys(graph.clues)[0]], explanation: "It disagrees with the timeline." }] : [],
       verdict: fails ? "fail" : "pass",
       reasoning: fails ? "One clue disagrees with the timeline." : "Sound.",
     };
     if (message.dimension_id === "cg_soundness") answer.conclusions = Object.keys(graph.conclusions).map((conclusion_id) => ({ conclusion_id, follows: "yes", note: "Follows." }));
     if (message.dimension_id === "cg_character_grounding") answer.characters = Object.keys(graph.characters).map((character_id) => ({ character_id, fits: true, note: "Fits." }));
     if (message.dimension_id === "cg_step_sense") answer.steps = message.player_view.steps.map((step) => ({ clue_id: step.clue_id, leads: "yes", note: "Leads." }));
     process.stdout.write(JSON.stringify({ result: JSON.stringify(answer) }));`,
  );
  const binding = (script: string, model: string) => ({
    cmd: process.execPath,
    args: [script, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    model,
    timeout_ms: 60_000,
    retries: 0,
  });
  return write("config.json", { "generator-agent": binding(generator, "agent-model"), "blueprint-judge": binding(judge, "judge-model") });
}

function call(round: number) {
  const folder = path.join(dir, "calls", String(round));
  return {
    message: JSON.parse(fs.readFileSync(path.join(folder, "message.json"), "utf8")) as {
      story_brief: unknown;
      instructions: string;
      repair?: { round: number; blueprint: unknown; notice: string; reports: Array<{ id: string; tier: string; details?: { issues: string[] }; answer?: unknown }> };
    },
    system: fs.readFileSync(path.join(folder, "system.md"), "utf8"),
    format: fs.readFileSync(path.join(folder, "format"), "utf8"),
  };
}

async function generate(extra: string[], env: NodeJS.ProcessEnv = {}): Promise<number> {
  const argv = [path.join(dir, "brief.json"), "--output-root", path.join(dir, "out"), "--quiet", ...extra];
  return main(["generate", ...argv], { root: process.cwd(), out: (t: string) => out.push(t), err: (t: string) => err.push(t), env });
}

async function onlyResult(): Promise<{ result: Result; folder: string }> {
  const found = fs.readdirSync(path.join(dir, "out"), { recursive: true, encoding: "utf8" }).filter((file) => file.endsWith("result.json") && !file.includes("rounds"));
  expect(found).toHaveLength(1);
  const file = path.join(dir, "out", found[0]);
  return { result: await readResult(file), folder: path.dirname(file) };
}

const installed = (root: string) => path.join(root, "blueprints", "clue-graph", `${good.metadata.id}.json`);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-clue-graph-generate-"));
  out = [];
  err = [];
  write("brief.json", brief);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("generate, clue graph", () => {
  it("is the default format: a brief gives a clue-graph job on the agent backend, which passes and installs", async () => {
    const root = path.join(dir, "root");
    expect(await generate(["--config", stubConfig([good]), "--install"], { MYSTERY_CONFIG_ROOT: root })).toBe(0);

    const first = call(0);
    expect(first.format).toBe("clue-graph");
    expect(first.message.story_brief).toEqual(brief);
    expect(first.message.instructions).toContain("./case.json");
    expect(first.system).toBe((await buildClueGraphGenerationChatInput(brief as never)).systemPrompt);

    const { result } = await onlyResult();
    expect(result.verdicts).toEqual([{ id: "clue_graph_valid", tier: "mechanical", status: "pass" }]);
    expect(result.rounds?.map((round) => round.round)).toEqual([0]);
    expect(result.production?.calls.map((each) => each.binding)).toEqual(["generator-agent"]);
    expect(JSON.parse(fs.readFileSync(installed(root), "utf8"))).toEqual(good);
  });

  it("quotes the validator's faults to the agent in the next round, and installs the repaired case", async () => {
    const root = path.join(dir, "root");
    expect(await generate(["--config", stubConfig([thin, good]), "--install"], { MYSTERY_CONFIG_ROOT: root })).toBe(0);

    const repair = call(1).message.repair!;
    expect(repair.blueprint).toEqual(thin);
    expect(repair.notice).toBe(REPORTS_NOTICE);
    expect(repair.reports).toEqual([
      { id: "clue_graph_valid", tier: "mechanical", details: { issues: [expect.stringMatching(/^clues: Has 2 .*a small case needs/)] } },
    ]);
    expect(call(1).format).toBe("clue-graph");

    const { result, folder } = await onlyResult();
    expect(result.rounds?.map((round) => round.summary.passed)).toEqual([false, true]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "blueprint.json"), "utf8"))).toEqual(thin);
    expect(JSON.parse(fs.readFileSync(installed(root), "utf8"))).toEqual(good);
  });

  it("holds the case to its brief's size and age", async () => {
    const elsewhere = { ...good, metadata: { ...good.metadata, size: "medium" as const, target_age: 9 } };
    expect(await generate(["--config", stubConfig([elsewhere]), "--repair", "0"])).toBe(2);
    const issues = (await onlyResult()).result.verdicts[0].details as { issues: string[] };
    expect(issues.issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^metadata\.target_age: the brief's targetAge is 8, the case has 9/),
        expect.stringMatching(/^metadata\.size: the brief's size is "small", the case has "medium"/),
      ]),
    );
  });

  it("quotes a judge's finding the same way, and after the last round keeps the case and installs nothing", async () => {
    const root = path.join(dir, "root");
    const config = stubConfig([good, good], ["cg_truth_agreement"]);
    expect(await generate(["--config", config, "--judge", "--repair", "1", "--install"], { MYSTERY_CONFIG_ROOT: root })).toBe(2);

    const report = call(1).message.repair!.reports.find((each) => each.id === "cg_truth_agreement");
    expect(report).toMatchObject({ tier: "judge", answer: { verdict: "fail", findings: [{ severity: "major", kind: "contradicts_timeline" }] } });

    const { result, folder } = await onlyResult();
    expect(result.rounds?.map((round) => round.summary.passed)).toEqual([false, false]);
    expect(result.verdicts.filter((verdict) => verdict.tier === "judge").map((verdict) => verdict.id).sort()).toEqual([
      "cg_character_grounding",
      "cg_soundness",
      "cg_step_sense",
      "cg_truth_agreement",
    ]);
    expect(fs.existsSync(path.join(folder, "rounds", "1", "blueprint.json"))).toBe(true);
    expect(fs.existsSync(path.join(root, "blueprints"))).toBe(false);
    expect(out.join("\n")).toContain("final case did not pass every check and judge");
  });

  it("runs two repair rounds by default, then stops with the case kept", async () => {
    const root = path.join(dir, "root");
    expect(await generate(["--config", stubConfig([thin, thin, thin]), "--install"], { MYSTERY_CONFIG_ROOT: root })).toBe(2);
    const { result } = await onlyResult();
    expect(result.rounds).toHaveLength(1 + CLUE_GRAPH_REPAIR.default);
    expect(result.subject.path).toBe(path.join("rounds", "2", "blueprint.json"));
    expect(fs.existsSync(installed(root))).toBe(false);
    expect(out.join("\n")).toContain("final case did not pass the validator");
  });

  it("keeps an answer that is not a case and repairs it, rather than generating again", async () => {
    expect(await generate(["--config", stubConfig([{ title: "not a case" }, good])])).toBe(0);
    const reports = call(1).message.repair!.reports;
    expect(reports[0].details?.issues).toEqual(expect.arrayContaining([expect.stringMatching(/^format: /)]));
  });

  it("refuses the api backend, a V2 brief and too many rounds, before it starts", async () => {
    expect(await generate(["--backend", "api"])).toBe(1);
    expect(err.join("\n")).toContain("the api backend writes only Blueprint V2");

    err = [];
    write("brief.json", generatorBrief);
    expect(await generate([])).toBe(1);
    expect(err.join("\n")).toContain("is a Blueprint V2 story brief: pass --format v2");

    expect(() => parseRepair(String(CLUE_GRAPH_REPAIR.max + 1), false, ["agent"], "clue-graph")).toThrow(`at most ${CLUE_GRAPH_REPAIR.max} rounds`);
    expect(parseRepair(undefined, false, ["agent"], "clue-graph")).toBe(CLUE_GRAPH_REPAIR.default);
    expect(parseRepair("0", false, ["agent"], "clue-graph")).toBe(0);
    expect(parseBackends(["api"], "v2")).toEqual(["api"]);
    expect(parseFormat(undefined)).toBe("clue-graph");
    expect(() => parseFormat("unknown")).toThrow("--format must be one of clue-graph, v2");
  });
});

describe("the clue-graph generator prompt", () => {
  it("is at most 1,500 words and carries no age guidance", async () => {
    const { systemPrompt } = await buildClueGraphGenerationChatInput(brief as never);
    expect(countWords(systemPrompt)).toBeLessThanOrEqual(1500);
    for (let age = MIN_TARGET_AGE; age <= MAX_TARGET_AGE; age += 1) {
      for (const line of renderGenerationGuidance(age).split("\n").filter((each) => each.trim().length > 20)) {
        expect(systemPrompt).not.toContain(line.trim());
      }
    }
    expect(systemPrompt).not.toContain("Age-appropriate writing");
  });
});

describe("the clue-graph workspace", () => {
  function workspace(caseValue: unknown, briefValue: unknown) {
    const target = path.join(dir, "workspace");
    const setup = spawnSync("bash", [SETUP, target, "clue-graph"], { encoding: "utf8" });
    expect(setup.status, setup.stderr).toBe(0);
    fs.writeFileSync(path.join(target, "brief.json"), JSON.stringify({ story_brief: briefValue, instructions: "x" }));
    fs.writeFileSync(path.join(target, "case.json"), JSON.stringify(caseValue));
    return target;
  }

  const run = (target: string, script: string) =>
    spawnSync(process.execPath, [path.join("scripts", script), "./case.json"], { cwd: target, encoding: "utf8" });

  it("holds the prompt, the model, examples and a validator command that runs", () => {
    const target = workspace(good, brief);
    for (const file of ["CLAUDE.md", "prompts/generator-prompt.md", "docs/clue-graph.md", "schema/clue-graph-schema.ts", "examples/dragon-crown.json"]) {
      expect(fs.existsSync(path.join(target, file)), file).toBe(true);
    }
    const passed = run(target, "validate-case.ts");
    expect(passed.status, passed.stderr).toBe(0);
    expect(run(target, "print-clue-graph-trails.mjs").stdout).toContain("trails");
  });

  it("checks a case elsewhere in the workspace against the workspace's brief", () => {
    const target = workspace(good, brief);
    const checked = spawnSync(process.execPath, ["scripts/validate-case.ts", "examples/dragon-crown.json"], { cwd: target, encoding: "utf8" });
    // The hand-written case has no size, so it does not fit a small brief.
    expect(checked.status).toBe(1);
    expect(checked.stderr).toContain("metadata.size: the brief's size is \"small\"");
  });

  it("fails a case its brief does not fit, naming the field", () => {
    const failed = run(workspace(good, { ...brief, size: "medium" }), "validate-case.ts");
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`metadata.size: the brief's size is "medium", the case has "small"`);
  });

  it("refuses an unknown format", () => {
    const setup = spawnSync("bash", [SETUP, path.join(dir, "other"), "unknown"], { encoding: "utf8" });
    expect(setup.status).toBe(1);
    expect(setup.stderr).toContain("unknown format: unknown");
  });
});
