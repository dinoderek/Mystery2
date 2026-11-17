// The candidate judges: merged or broad alternatives to judges of the default
// battery, which run only when a run names them.
//
// They run here through `judge blueprint` and `judge game` on the `judge-stub`
// binding as the example config defines it, steered by
// RUNTIME_JUDGE_STUB_VERDICT, so no model is called. What they are sent is
// pinned by the prompt snapshots (eval-snapshots.test.ts).

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { loadJudge } from "../../../evaluation/core/judge-loader.ts";
import { getJudgeEntry, judgesFor, SUBJECT_KINDS } from "../../../evaluation/core/registry.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result, Verdict } from "../../../evaluation/core/result.ts";
import { resolveVerdict } from "../../../evaluation/judges/index.ts";
import { FINDINGS_TABLE, findingsRow, kindedFindings } from "../../../evaluation/lib/truth/findings.ts";
import { BLUEPRINT_KINDS, GAME_KINDS } from "../../../evaluation/lib/truth/kinds.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";
import { makeRawTrace } from "./trace-fixtures.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;

const BLUEPRINT_CANDIDATES = ["solve_depth_fairness", "knowledge_timeline_coherence", "blueprint_broad"];
const CANDIDATES = [...BLUEPRINT_CANDIDATES, "gm_broad"];

/** The truth-set kinds each candidate's findings may name. */
const CANDIDATE_KINDS: Record<string, readonly string[]> = {
  solve_depth_fairness: ["solve_depth", "fairness"],
  knowledge_timeline_coherence: ["knowledge_coherence", "timeline_coherence"],
  blueprint_broad: BLUEPRINT_KINDS,
  gm_broad: GAME_KINDS,
};

const BRIEF = {
  brief: "Someone took the cookies from the kitchen before snack time.",
  targetAge: 8,
  timeBudget: 12,
  culprits: 1,
  suspects: 1,
  witnesses: 0,
  locations: 2,
  redHerringTrails: 1,
};

let dir = "";
let out: string[] = [];

function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}

/** `judge-stub` from the example config, bound as both judge bindings. */
function stubConfig(): string {
  const example = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "evaluation", "config.example.json"), "utf8"));
  const stub = example["judge-stub"];
  return write("config.json", { "blueprint-judge": stub, "game-judge": stub });
}

function resultsUnder(folder: string): string[] {
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return resultsUnder(full);
    return entry.name === "result.json" ? [full] : [];
  });
}

/** Runs one judge command and reads back the one result it wrote. */
async function judge(subject: "blueprint" | "game", extra: string[]): Promise<{ code: number; result: Result }> {
  const outputRoot = path.join(dir, `out-${fs.readdirSync(dir).length}`);
  const file = subject === "blueprint" ? path.join(dir, "blueprint.json") : path.join(dir, "trace.json");
  const brief = subject === "blueprint" ? ["--brief", path.join(dir, "brief.json")] : [];
  const argv = ["judge", subject, file, ...brief, "--config", stubConfig(), "--output-root", outputRoot, "--quiet", ...extra];
  const code = await runEval(argv, { root: REPO_ROOT, out: (t) => out.push(t), err: (t) => out.push(t), env: {} }, COMMANDS);
  const files = resultsUnder(outputRoot);
  expect(files, out.join("\n")).toHaveLength(1);
  return { code, result: await readResult(files[0]) };
}

function judgeVerdicts(result: Result): Record<string, string> {
  return Object.fromEntries(result.verdicts.filter((v) => v.tier === "judge").map((v) => [v.id, v.status]));
}

function subjectOf(id: string): "blueprint" | "game" {
  return getJudgeEntry(id).subjects.includes("blueprint") ? "blueprint" : "game";
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-candidates-"));
  out = [];
  vi.stubEnv("EVAL_HEARTBEAT_MS", "60000");
  write("blueprint.json", { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, target_age: 18 } });
  write("brief.json", BRIEF);
  write("trace.json", makeRawTrace());
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the default battery", () => {
  it("of each subject is the list it had, with no candidate in it", () => {
    expect(judgesFor("blueprint").map((j) => j.id)).toEqual([
      "solve_depth",
      "fairness",
      "timeline_coherence",
      "knowledge_coherence",
      "character_grounding",
      "path_payoff",
      "clue_graph",
      "age_appropriate",
    ]);
    expect(judgesFor("game").map((j) => j.id)).toEqual(["gm_roleplay", "gm_clue_discipline", "gm_fabrication", "gm_spoiler"]);
    expect(judgesFor("turn").map((j) => j.id)).toEqual([
      "gm_roleplay",
      "gm_clue_discipline",
      "gm_fabrication",
      "gm_spoiler",
      "age_appropriate_turn",
    ]);
  });

  it("leaves out exactly the candidates, which a run may name", () => {
    const named = (subject: (typeof SUBJECT_KINDS)[number]) =>
      judgesFor(subject, { candidates: true })
        .map((j) => j.id)
        .filter((id) => !judgesFor(subject).some((j) => j.id === id));
    expect(named("blueprint")).toEqual(BLUEPRINT_CANDIDATES);
    expect(named("game")).toEqual(["gm_broad"]);
    expect(named("turn")).toEqual(["gm_broad"]);
    for (const id of CANDIDATES) {
      expect(getJudgeEntry(id)).toMatchObject({ candidate: true, verdict: "major_findings" });
    }
  });

  it("passes on judge-stub, each dimension answered with its own clean verdict, on the fixture blueprint", async () => {
    const { code, result } = await judge("blueprint", []);
    expect(code, out.join("\n")).toBe(0);
    expect(judgeVerdicts(result)).toEqual(Object.fromEntries(judgesFor("blueprint").map((j) => [j.id, "pass"])));
    expect(result.summary.passed).toBe(true);
  });

  it("runs without a candidate, which is absent from the result rather than skipped", async () => {
    const blueprint = await judge("blueprint", ["--judges", "fairness"]);
    expect(Object.keys(judgeVerdicts(blueprint.result))).toEqual(judgesFor("blueprint").map((j) => j.id));
    const game = await judge("game", []);
    expect(judgeVerdicts(game.result)).toEqual(Object.fromEntries(judgesFor("game").map((j) => [j.id, "pass"])));
  });
});

describe("a candidate named on its command", () => {
  it.each(CANDIDATES)("%s runs on judge-stub, the default battery skipped", async (id) => {
    const subject = subjectOf(id);
    const { code, result } = await judge(subject, ["--judges", id]);
    expect(code, out.join("\n")).toBe(0);
    expect(judgeVerdicts(result)).toEqual({
      ...Object.fromEntries(judgesFor(subject).map((j) => [j.id, "skipped"])),
      [id]: "pass",
    });
    const verdict = result.verdicts.find((v) => v.id === id);
    expect(verdict?.call?.binding).toBe(subject === "blueprint" ? "blueprint-judge" : "game-judge");
    expect(verdict?.findings).toEqual([]);
  });

  it.each(CANDIDATES)("%s fails on a major finding of its kind, whatever it says", async (id) => {
    const kind = CANDIDATE_KINDS[id][0];
    const finding = { severity: "major", kind, quote: "q", why: "w", refers_to: null, ...(id === "gm_broad" ? { sequence: 2 } : {}) };
    vi.stubEnv("RUNTIME_JUDGE_STUB_VERDICT", JSON.stringify({ findings: [finding], verdict: "pass", reasoning: "r" }));
    const { code, result } = await judge(subjectOf(id), ["--judges", id]);
    expect(code).toBe(2);
    const verdict = result.verdicts.find((v) => v.id === id) as Verdict;
    expect(verdict.status).toBe("fail");
    expect(verdict.details).toMatchObject({ major_count: 1, minor_count: 0, model_verdict: "pass", verdict_disagreement: true });
    expect(kindedFindings(verdict, null)).toEqual([
      { sequence: id === "gm_broad" ? 2 : null, kinds: [kind], severity: "major", judge_kind: kind, quote: "q", why: "w", refers_to: null },
    ]);
  });

  it.each(CANDIDATES)("%s refuses an answer whose finding has no kind, or a kind it may not name", async (id) => {
    const kindless = { severity: "minor", quote: "q", why: "w", sequence: 1 };
    const stray = { ...kindless, kind: id === "gm_broad" ? "solve_depth" : "spoiler" };
    for (const finding of [kindless, stray]) {
      vi.stubEnv("RUNTIME_JUDGE_STUB_VERDICT", JSON.stringify({ findings: [finding], verdict: "pass", reasoning: "r" }));
      const { code, result } = await judge(subjectOf(id), ["--judges", id]);
      expect(code).toBe(2);
      const verdict = result.verdicts.find((v) => v.id === id);
      expect(verdict?.status).toBe("error");
      expect(verdict?.reason).toMatch(/schema validation: findings\.0\.kind/);
    }
  });

  it("is refused by the other subject's command, which names what it may run and writes nothing", async () => {
    const refused = async (argv: string[]) => {
      out = [];
      const outputRoot = path.join(dir, "refused");
      const ctx = { root: REPO_ROOT, out: (t: string) => out.push(t), err: (t: string) => out.push(t), env: {} };
      const code = await runEval([...argv, "--config", stubConfig(), "--output-root", outputRoot], ctx, COMMANDS);
      expect(resultsUnder(outputRoot)).toEqual([]);
      return code;
    };
    expect(await refused(["judge", "game", path.join(dir, "trace.json"), "--judges", "blueprint_broad"])).toBe(1);
    expect(out.join("\n")).toMatch(/--judges takes game judge ids from: .*gm_broad \(not: blueprint_broad\)/);
    const blueprint = ["judge", "blueprint", path.join(dir, "blueprint.json"), "--brief", path.join(dir, "brief.json")];
    expect(await refused([...blueprint, "--judges", "gm_broad"])).toBe(1);
    expect(out.join("\n")).toMatch(/--judges needs dimension ids from: .*blueprint_broad \(got gm_broad\)/);
  });
});

describe("a blueprint candidate's judge workspace", () => {
  function workspace(id: string): string {
    const target = path.join(dir, "workspace", id);
    const setup = spawnSync("bash", [path.join(REPO_ROOT, "evaluation", "judge-harness", "setup-workspace.sh"), target, id], {
      encoding: "utf8",
    });
    expect(setup.status, setup.stderr).toBe(0);
    return target;
  }

  it.each(BLUEPRINT_CANDIDATES)("%s links its brief and schema, as a dimension's are", (id) => {
    const target = workspace(id);
    const entry = getJudgeEntry(id);
    if (entry.prompt.kind !== "files") throw new Error(`${id} has no brief`);
    expect(fs.realpathSync(path.join(target, "dimension.md"))).toBe(fs.realpathSync(path.join(REPO_ROOT, entry.prompt.brief)));
    expect(fs.realpathSync(path.join(target, "schema", "output-schema.ts"))).toBe(
      fs.realpathSync(path.join(REPO_ROOT, entry.prompt.schema)),
    );
    expect(fs.readFileSync(path.join(target, "dimension-id"), "utf8").trim()).toBe(id);
  });

  it("gives the broad candidate the narrator doc character_grounding gets, and a merged one none", () => {
    const doc = (id: string) => fs.existsSync(path.join(workspace(id), "docs", "runtime-consumption.md"));
    expect(doc("character_grounding")).toBe(true);
    expect(doc("blueprint_broad")).toBe(true);
    expect(doc("solve_depth_fairness")).toBe(false);
  });
});

describe("the candidates' schemas and table rows", () => {
  it.each(CANDIDATES)("%s's schema takes exactly the kinds its row gives", async (id) => {
    const row = findingsRow(id);
    expect(row).toEqual({ side: subjectOf(id), kinds: CANDIDATE_KINDS[id], read: "own_kind" });
    const { schema } = await loadJudge(id);
    const kindEnum = (schema as z.AnyZodObject).shape.findings.element.shape.kind as z.ZodEnum<[string, ...string[]]>;
    expect([...kindEnum.options].sort()).toEqual([...row.kinds].sort());
  });

  it("gives every candidate a row, and maps each stub answer to its own kinds", () => {
    for (const id of CANDIDATES) expect(FINDINGS_TABLE[id], id).toBeDefined();
    const mapped = (key: string, id: string, turn: number | null) => {
      const answer = ANSWERS[key];
      const status = resolveVerdict(answer).status;
      // The judges' words are read the same for every row; the truth set's tests check them.
      return kindedFindings({ id, status, findings: answer.findings as unknown[] }, turn).map(({ sequence, kinds, severity, judge_kind }) => ({ sequence, kinds, severity, judge_kind }));
    };
    expect(mapped("blueprint.solve_depth_fairness", "solve_depth_fairness", null)).toEqual([
      { sequence: null, kinds: ["fairness"], severity: "major", judge_kind: "fairness" },
      { sequence: null, kinds: ["solve_depth"], severity: "minor", judge_kind: "solve_depth" },
    ]);
    expect(mapped("blueprint.knowledge_timeline_coherence", "knowledge_timeline_coherence", null)).toEqual([
      { sequence: null, kinds: ["timeline_coherence"], severity: "minor", judge_kind: "timeline_coherence" },
    ]);
    expect(mapped("blueprint.blueprint_broad", "blueprint_broad", null)).toEqual([
      { sequence: null, kinds: ["knowledge_coherence"], severity: "major", judge_kind: "knowledge_coherence" },
      { sequence: null, kinds: ["age_appropriate"], severity: "minor", judge_kind: "age_appropriate" },
    ]);
    expect(mapped("trace.gm_broad", "gm_broad", null)).toEqual([
      { sequence: 6, kinds: ["fabrication"], severity: "major", judge_kind: "fabrication" },
      { sequence: 4, kinds: ["spoiler"], severity: "minor", judge_kind: "spoiler" },
    ]);
    // A judge of one turn points every finding at the turn it judged.
    expect(mapped("runtime.gm_broad", "gm_broad", 12)).toEqual([
      { sequence: 12, kinds: ["not_age_fit"], severity: "minor", judge_kind: "not_age_fit" },
    ]);
  });

  it("refuses a stored finding of a kind the candidate's row does not give, and adds none to a bare fail", () => {
    const findings = [{ sequence: 1, severity: "major", kind: "clue_graph" }];
    expect(() => kindedFindings({ id: "solve_depth_fairness", status: "fail", findings }, null)).toThrow(
      'a finding of "solve_depth_fairness" names kind "clue_graph", not one of solve_depth, fairness',
    );
    expect(kindedFindings({ id: "gm_broad", status: "fail", findings: [] }, null)).toEqual([]);
  });
});
