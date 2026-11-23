// The candidate judges: merged or broad alternatives to judges of the default
// battery, which run only when a run names them.
//
// They run here through `judge game` on the `judge-stub`
// binding as the example config defines it, steered by
// RUNTIME_JUDGE_STUB_VERDICT, so no model is called. What they are sent is
// pinned by the prompt snapshots (eval-snapshots.test.ts).

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
import { GAME_KINDS } from "../../../evaluation/judges/gm-broad.schema.ts";
import { makeRawTrace } from "./trace-fixtures.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

const CANDIDATES = ["gm_broad"];

/** The finding kinds each candidate may name. */
const CANDIDATE_KINDS: Record<string, readonly string[]> = { gm_broad: GAME_KINDS };

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
  const argv = ["judge", subject, file, "--config", stubConfig(), "--output-root", outputRoot, "--quiet", ...extra];
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
  write("blueprint.json", JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "blueprints", "clue-graph", "greenhouse-prizewinner.json"), "utf8")));
  write("trace.json", makeRawTrace());
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the default battery", () => {
  it("of each subject is the list it had, with no candidate in it", () => {
    expect(judgesFor("blueprint").map((j) => j.id)).toEqual(["cg_soundness", "cg_truth_agreement", "cg_character_grounding", "cg_step_sense"]);
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
    expect(named("blueprint")).toEqual([]);
    expect(named("game")).toEqual(["gm_broad"]);
    expect(named("turn")).toEqual(["gm_broad"]);
    for (const id of CANDIDATES) {
      expect(getJudgeEntry(id)).toMatchObject({ candidate: true, verdict: "major_findings" });
    }
  });

  it("runs without a candidate, which is absent from the result rather than skipped", async () => {
    const blueprint = await judge("blueprint", ["--judges", "cg_soundness"]);
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
    expect(verdict.findings).toEqual([finding]);
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
    expect(await refused(["judge", "game", path.join(dir, "trace.json"), "--judges", "cg_soundness"])).toBe(1);
    expect(out.join("\n")).toMatch(/--judges takes game judge ids from: .*gm_broad \(not: cg_soundness\)/);
    const blueprint = ["judge", "blueprint", path.join(dir, "blueprint.json")];
    expect(await refused([...blueprint, "--judges", "gm_broad"])).toBe(1);
    expect(out.join("\n")).toMatch(/--judges needs judge ids from: .*cg_step_sense \(got gm_broad\)/);
  });
});

describe("the candidates' schemas", () => {
  it.each(CANDIDATES)("%s's schema takes exactly its finding kinds", async (id) => {
    const { schema } = await loadJudge(id);
    const kindEnum = (schema as z.AnyZodObject).shape.findings.element.shape.kind as z.ZodEnum<[string, ...string[]]>;
    expect([...kindEnum.options].sort()).toEqual([...CANDIDATE_KINDS[id]].sort());
  });
});
