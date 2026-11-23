// `./dev eval judge blueprint` and `./dev eval validate`, run in-process on
// stub bindings: a clue-graph case goes through the real command, registry,
// runner and result schema, and the judge is eval-snapshot-stub.mjs answering
// from a table. No model is called.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "eval-snapshot-stub.mjs");
const ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const JUDGES = ["cg_soundness", "cg_truth_agreement", "cg_character_grounding", "cg_step_sense"];
const CASE = JSON.parse(fs.readFileSync(path.join(process.cwd(), "blueprints", "clue-graph", "greenhouse-prizewinner.json"), "utf8")) as Record<string, unknown> & {
  clues: Record<string, unknown>;
};

let dir = "";
let out: string[] = [];
let err: string[] = [];

function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

/** Answers every judge with a pass and no findings, whatever the fixture table says. */
function passingAnswers(): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const id of JUDGES) answers[`blueprint.${id}`] = { ...ANSWERS[`blueprint.${id}`], findings: [], verdict: "pass" };
  return answers;
}

function stubConfig(answers: Record<string, unknown>, extra: Record<string, unknown> = {}): string {
  const answersFile = write("answers.json", answers);
  return write("config.json", {
    "blueprint-judge": {
      cmd: process.execPath,
      args: [STUB, "-", answersFile, "blueprint.{id}", "{{system_prompt_file}}", "{{user_message_file}}"],
      extract_path: "result",
      timeout_ms: 60_000,
      retries: 0,
      ...extra,
    },
  });
}

async function eval_(argv: string[]): Promise<number> {
  return runEval(argv, { root: process.cwd(), out: (t) => out.push(t), err: (t) => err.push(t), env: {} }, COMMANDS);
}

function results(): string[] {
  const found: string[] = [];
  const walk = (folder: string) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "result.json") found.push(full);
    }
  };
  if (fs.existsSync(path.join(dir, "out"))) walk(path.join(dir, "out"));
  return found;
}

async function theResult(): Promise<Result> {
  const files = results();
  expect(files).toHaveLength(1);
  return readResult(files[0]);
}

function judgeArgv(extra: string[] = [], file = path.join(dir, "case.json")): string[] {
  return ["judge", "blueprint", file, "--output-root", path.join(dir, "out"), ...extra];
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-blueprint-"));
  out = [];
  err = [];
  write("case.json", CASE);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("judge blueprint", () => {
  it("writes a valid result.json with the case beside it and exits 0 when everything passes", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--config", config, "--quiet"]))).toBe(0);

    const result = await theResult();
    expect(result.summary.passed).toBe(true);
    expect(result.run_error).toBeNull();
    expect(result.subject).toEqual({ kind: "blueprint", id: "case", path: "blueprint.json" });
    expect(result.run.command).toBe("judge blueprint");
    expect(Object.keys(result.run.bindings)).toEqual(["blueprint-judge"]);

    const tiers = (tier: string) => result.verdicts.filter((v) => v.tier === tier).map((v) => v.id);
    expect(tiers("mechanical")).toEqual(["clue_graph_valid"]);
    expect(tiers("judge")).toEqual(JUDGES);
    for (const verdict of result.verdicts.filter((v) => v.tier === "judge")) {
      expect(verdict.status).toBe("pass");
      expect(verdict.call?.prompt_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(verdict.call?.attempts).toHaveLength(1);
      expect(verdict.answer).toMatchObject({ verdict: "pass" });
    }
    expect(result.timing?.stages.map((s) => s.name)).toEqual(
      expect.arrayContaining(["write_blueprint", "mechanical", "blueprint_schema_validate", "dimensions"]),
    );

    const folder = path.dirname(results()[0]);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "blueprint.json"), "utf8"))).toEqual(CASE);
    expect(fs.existsSync(path.join(folder, "brief.json"))).toBe(false);
    expect(fs.existsSync(path.join(folder, "logs", "judge-cg_soundness.system.txt"))).toBe(true);
  });

  it("judges again the stored case", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--config", config, "--quiet"]))).toBe(0);
    const keep = path.join(dir, "kept", "the-stored-one");
    fs.cpSync(path.dirname(results()[0]), keep, { recursive: true });
    const stored = path.join(keep, "blueprint.json");
    fs.rmSync(path.join(dir, "out"), { recursive: true });
    expect(await eval_(judgeArgv(["--config", config, "--quiet"], stored)), err.join("\n")).toBe(0);
    expect((await theResult()).subject.id).toBe("the-stored-one");
  });

  it("exits 2 when a judge fails on a major finding", async () => {
    const answers = passingAnswers();
    const finding = { severity: "major", kind: "contradicts_timeline", ids: [Object.keys(CASE.clues)[0]], explanation: "It disagrees." };
    answers["blueprint.cg_truth_agreement"] = { ...ANSWERS["blueprint.cg_truth_agreement"], findings: [finding], verdict: "pass" };
    expect(await eval_(judgeArgv(["--config", stubConfig(answers), "--quiet"]))).toBe(2);

    const result = await theResult();
    expect(result.summary.passed).toBe(false);
    expect(result.verdicts.find((v) => v.id === "cg_truth_agreement")?.status).toBe("fail");
    expect(result.verdicts.filter((v) => v.status === "fail")).toHaveLength(1);
  });

  it("exits 2 and records an error for a judge whose model call fails, without stopping the others", async () => {
    const answers = passingAnswers();
    delete answers["blueprint.cg_step_sense"];
    expect(await eval_(judgeArgv(["--config", stubConfig(answers, { retries: 1 }), "--quiet"]))).toBe(2);

    const result = await theResult();
    const failed = result.verdicts.find((v) => v.id === "cg_step_sense");
    expect(failed?.status).toBe("error");
    expect(failed?.reason).toMatch(/failed after 2 attempt\(s\)/);
    expect(failed?.call?.attempts.map((a) => a.outcome)).toEqual(["exit", "exit"]);
    expect(result.verdicts.filter((v) => v.tier === "judge" && v.status === "pass")).toHaveLength(3);
    expect(result.run_error).toBeNull();
  });

  it("retries an answer that breaks the judge's schema, then records the error", async () => {
    const answers = passingAnswers();
    answers["blueprint.cg_soundness"] = { verdict: "pass" };
    expect(await eval_(judgeArgv(["--config", stubConfig(answers), "--quiet"]))).toBe(2);

    const failed = (await theResult()).verdicts.find((v) => v.id === "cg_soundness");
    expect(failed?.status).toBe("error");
    expect(failed?.call?.attempts[0].outcome).toBe("invalid");
    expect(failed?.reason).toContain("Judge output failed schema validation");
  });

  it("exits 2 for a file that is not a case: the check fails and every judge is an error", async () => {
    write("case.json", { ...CASE, format: "blueprint-v2" });
    expect(await eval_(judgeArgv(["--config", stubConfig(passingAnswers()), "--quiet"]))).toBe(2);

    const result = await theResult();
    expect(result.verdicts.find((v) => v.id === "clue_graph_valid")?.status).toBe("fail");
    for (const id of JUDGES) expect(result.verdicts.find((v) => v.id === id)?.status).toBe("error");
  });

  it("exits 1 when the case file is missing", async () => {
    const code = await eval_(judgeArgv(["--config", stubConfig(passingAnswers())], path.join(dir, "nothing.json")));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("cannot read case");
    expect(results()).toEqual([]);
  });

  it("exits 1, naming the binding, when the config has no judge binding", async () => {
    const config = write("empty-config.json", { "game-judge": { cmd: "true", timeout_ms: 1000 } });
    expect(await eval_(judgeArgv(["--config", config]))).toBe(1);
    expect(err.join("\n")).toContain('no binding "blueprint-judge"');
    expect(results()).toEqual([]);
  });

  it("exits 1, naming the binding, when the judge binding's command does not exist", async () => {
    const config = stubConfig(passingAnswers(), { cmd: "evaluation/config/wrappers/not-a-wrapper.sh" });
    expect(await eval_(judgeArgv(["--config", config]))).toBe(1);
    expect(err.join("\n")).toMatch(/binding "blueprint-judge".*cannot run/);
  });

  it("skips the judges only when --no-judges asks, and then needs no judge binding", async () => {
    const missing = path.join(dir, "missing-config.json");
    expect(await eval_(judgeArgv(["--no-judges", "--config", missing, "--quiet"]))).toBe(0);

    const result = await theResult();
    const judges = result.verdicts.filter((v) => v.tier === "judge");
    expect(judges.map((v) => v.status)).toEqual(JUDGES.map(() => "skipped"));
    expect(judges[0].reason).toBe("left out by --no-judges");
    expect(result.run.bindings).toEqual({});
  });

  it("runs only the judges --judges names, and skips the rest", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--judges", "cg_soundness,cg_step_sense", "--config", config, "--quiet"]))).toBe(0);

    const result = await theResult();
    const status = (id: string) => result.verdicts.find((v) => v.id === id)?.status;
    expect(status("cg_soundness")).toBe("pass");
    expect(status("cg_step_sense")).toBe("pass");
    expect(status("cg_truth_agreement")).toBe("skipped");
    expect(status("cg_character_grounding")).toBe("skipped");
  });

  it("refuses an unknown --judges id and the two flags together", async () => {
    expect(await eval_(judgeArgv(["--judges", "cg_soundness,vibes"]))).toBe(1);
    expect(err.join("\n")).toContain("vibes");
    err = [];
    expect(await eval_(judgeArgv(["--judges", "cg_soundness", "--no-judges"]))).toBe(1);
    expect(err.join("\n")).toContain("cannot be used together");
  });

  it("uses --model-override for the run's binding and records it", async () => {
    const config = stubConfig(passingAnswers(), { model: "opus" });
    expect(await eval_(judgeArgv(["--config", config, "--model-override", "blueprint-judge=sonnet", "--quiet"]))).toBe(0);
    const result = await theResult();
    expect(result.run.bindings["blueprint-judge"].model).toBe("sonnet");
    expect(result.verdicts.find((v) => v.id === "cg_soundness")?.call?.model).toBe("sonnet");
  });
});

describe("validate", () => {
  it("exits 0 on a valid case and writes a result with only the case check", async () => {
    const alone = write("alone/case.json", CASE);
    expect(await eval_(["validate", alone, "--output-root", path.join(dir, "out")])).toBe(0);

    const result = await theResult();
    expect(result.verdicts.map((v) => [v.id, v.tier, v.status])).toEqual([["clue_graph_valid", "mechanical", "pass"]]);
    expect(result.run.bindings).toEqual({});
  });

  it("exits 2 for a case that fails the check, naming the faults", async () => {
    const alone = write("alone/case.json", { format: "clue-graph/2" });
    expect(await eval_(["validate", alone, "--output-root", path.join(dir, "out")])).toBe(2);
    expect(out.join("\n")).toContain("FAIL clue_graph_valid");
    expect((await theResult()).verdicts.map((v) => [v.id, v.status])).toEqual([["clue_graph_valid", "fail"]]);
  });

  it("exits 1 when the file is missing or is not JSON", async () => {
    expect(await eval_(["validate", path.join(dir, "nothing.json"), "--output-root", path.join(dir, "out")])).toBe(1);
    write("broken.json", "{not json");
    expect(await eval_(["validate", path.join(dir, "broken.json"), "--output-root", path.join(dir, "out")])).toBe(1);
    expect(err.join("\n")).toContain("is not JSON");
    expect(results()).toEqual([]);
  });
});
