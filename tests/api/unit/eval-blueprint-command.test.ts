// `./dev eval judge blueprint` and `./dev eval validate`, run in-process on
// stub bindings: a fixture blueprint goes through the real command, registry,
// runner and result schema, and the judge is eval-snapshot-stub.mjs answering
// from a table. No model is called.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { slugify } from "../../../evaluation/core/run-folder.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import type { Result } from "../../../evaluation/core/result.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STUB = path.join(HERE, "eval-snapshot-stub.mjs");
const ANSWERS = JSON.parse(fs.readFileSync(path.join(HERE, "fixtures", "eval-snapshot-answers.json"), "utf8")) as Record<
  string,
  Record<string, unknown>
>;
const DIMENSIONS = [
  "solve_depth",
  "fairness",
  "timeline_coherence",
  "knowledge_coherence",
  "character_grounding",
  "path_payoff",
  "clue_graph",
  "age_appropriate",
];
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
let err: string[] = [];

function write(name: string, value: unknown): string {
  const file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
  return file;
}

/** Answers every dimension with a pass, whatever the fixture table says. */
function passingAnswers(): Record<string, unknown> {
  const answers: Record<string, unknown> = {};
  for (const id of DIMENSIONS) answers[`blueprint.${id}`] = { ...ANSWERS[`blueprint.${id}`], verdict: "pass" };
  return answers;
}

/** A blueprint old enough to read to that the age analyzer passes it. */
function readableBlueprint() {
  return { ...validBlueprintV2, metadata: { ...validBlueprintV2.metadata, target_age: 18 } };
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

function judgeArgv(extra: string[] = [], blueprint = path.join(dir, "blueprint.json")): string[] {
  return ["judge", "blueprint", blueprint, "--brief", path.join(dir, "brief.json"), "--output-root", path.join(dir, "out"), ...extra];
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-eval-blueprint-"));
  out = [];
  err = [];
  write("blueprint.json", readableBlueprint());
  write("brief.json", BRIEF);
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("judge blueprint", () => {
  it("writes a valid result.json with the blueprint beside it and exits 0 when everything passes", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--config", config, "--quiet"]))).toBe(0);

    const result = await theResult();
    expect(result.summary.passed).toBe(true);
    expect(result.run_error).toBeNull();
    expect(result.subject).toEqual({ kind: "blueprint", id: slugify(path.basename(dir)), path: "blueprint.json" });
    expect(result.run.command).toBe("judge blueprint");
    expect(Object.keys(result.run.bindings)).toEqual(["blueprint-judge"]);

    const tiers = (tier: string) => result.verdicts.filter((v) => v.tier === tier).map((v) => v.id);
    expect(tiers("mechanical")).toHaveLength(8);
    expect(tiers("analyzer")).toEqual(["clue_graph.analyzer", "age_appropriate.analyzer"]);
    expect(tiers("judge")).toEqual(DIMENSIONS);
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
    expect(JSON.parse(fs.readFileSync(path.join(folder, "blueprint.json"), "utf8"))).toEqual(readableBlueprint());
    expect(JSON.parse(fs.readFileSync(path.join(folder, "brief.json"), "utf8"))).toEqual(BRIEF);
    expect(fs.existsSync(path.join(folder, "logs", "judge-fairness.system.txt"))).toBe(true);
  });

  it("judges again the stored blueprint with the brief kept beside it", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--config", config, "--quiet"]))).toBe(0);
    const keep = path.join(dir, "kept", "the-stored-one");
    fs.cpSync(path.dirname(results()[0]), keep, { recursive: true });
    const stored = path.join(keep, "blueprint.json");
    fs.rmSync(path.join(dir, "out"), { recursive: true });
    const again = ["judge", "blueprint", stored, "--config", config, "--output-root", path.join(dir, "out"), "--quiet"];
    expect(await eval_(again), err.join("\n")).toBe(0);
    expect((await theResult()).subject.id).toBe("the-stored-one");
  });

  it("exits 2 when a judge fails", async () => {
    const answers = passingAnswers();
    answers["blueprint.fairness"] = ANSWERS["blueprint.fairness"];
    expect(await eval_(judgeArgv(["--config", stubConfig(answers), "--quiet"]))).toBe(2);

    const result = await theResult();
    expect(result.summary.passed).toBe(false);
    expect(result.verdicts.find((v) => v.id === "fairness")?.status).toBe("fail");
    expect(result.verdicts.filter((v) => v.status === "fail")).toHaveLength(1);
  });

  it("exits 2 when an analyzer fails even though its judge passes", async () => {
    write("blueprint.json", validBlueprintV2);
    expect(await eval_(judgeArgv(["--config", stubConfig(passingAnswers()), "--quiet"]))).toBe(2);

    const result = await theResult();
    expect(result.verdicts.find((v) => v.id === "age_appropriate.analyzer")?.status).toBe("fail");
    expect(result.verdicts.find((v) => v.id === "age_appropriate")?.status).toBe("pass");
  });

  it("exits 2 and records an error for a judge whose model call fails, without stopping the others", async () => {
    const answers = passingAnswers();
    delete answers["blueprint.path_payoff"];
    expect(await eval_(judgeArgv(["--config", stubConfig(answers, { retries: 1 }), "--quiet"]))).toBe(2);

    const result = await theResult();
    const failed = result.verdicts.find((v) => v.id === "path_payoff");
    expect(failed?.status).toBe("error");
    expect(failed?.reason).toMatch(/failed after 2 attempt\(s\)/);
    expect(failed?.call?.attempts.map((a) => a.outcome)).toEqual(["exit", "exit"]);
    expect(result.verdicts.filter((v) => v.tier === "judge" && v.status === "pass")).toHaveLength(7);
    expect(result.run_error).toBeNull();
  });

  it("retries an answer that breaks the judge's schema, then records the error", async () => {
    const answers = passingAnswers();
    answers["blueprint.fairness"] = { verdict: "pass" };
    expect(await eval_(judgeArgv(["--config", stubConfig(answers), "--quiet"]))).toBe(2);

    const failed = (await theResult()).verdicts.find((v) => v.id === "fairness");
    expect(failed?.status).toBe("error");
    expect(failed?.call?.attempts[0].outcome).toBe("invalid");
    expect(failed?.reason).toContain("Judge output failed schema validation");
  });

  it("exits 2 for a blueprint that fails the schema: the check fails and every judge is an error", async () => {
    write("blueprint.json", { ...validBlueprintV2, world: undefined });
    expect(await eval_(judgeArgv(["--config", stubConfig(passingAnswers()), "--quiet"]))).toBe(2);

    const result = await theResult();
    expect(result.verdicts.find((v) => v.id === "blueprint_schema_valid")?.status).toBe("fail");
    for (const id of DIMENSIONS) {
      expect(result.verdicts.find((v) => v.id === id)?.status).toBe("error");
    }
  });

  it("exits 1 when the blueprint file is missing", async () => {
    const code = await eval_(judgeArgv(["--config", stubConfig(passingAnswers())], path.join(dir, "nothing.json")));
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("cannot read blueprint");
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

  it("exits 1 when there is no brief to judge against", async () => {
    const alone = write("alone/blueprint.json", readableBlueprint());
    const argv = ["judge", "blueprint", alone, "--config", stubConfig(passingAnswers()), "--output-root", path.join(dir, "out")];
    expect(await eval_(argv)).toBe(1);
    expect(err.join("\n")).toContain("a brief is needed");
  });

  it("skips the judges only when --no-judges asks, and then needs no judge binding", async () => {
    const missing = path.join(dir, "missing-config.json");
    expect(await eval_(judgeArgv(["--no-judges", "--config", missing, "--quiet"]))).toBe(0);

    const result = await theResult();
    const judges = result.verdicts.filter((v) => v.tier === "judge");
    expect(judges.map((v) => v.status)).toEqual(DIMENSIONS.map(() => "skipped"));
    expect(judges[0].reason).toBe("left out by --no-judges");
    expect(result.verdicts.filter((v) => v.tier === "analyzer").map((v) => v.status)).toEqual(["pass", "pass"]);
    expect(result.run.bindings).toEqual({});
  });

  it("runs only the dimensions --judges names, and skips the rest", async () => {
    const config = stubConfig(passingAnswers());
    expect(await eval_(judgeArgv(["--judges", "fairness,clue_graph", "--config", config, "--quiet"]))).toBe(0);

    const result = await theResult();
    const status = (id: string) => result.verdicts.find((v) => v.id === id)?.status;
    expect(status("fairness")).toBe("pass");
    expect(status("clue_graph")).toBe("pass");
    expect(status("clue_graph.analyzer")).toBe("pass");
    expect(status("solve_depth")).toBe("skipped");
    expect(status("age_appropriate.analyzer")).toBe("skipped");
  });

  it("refuses an unknown --judges id and the two flags together", async () => {
    expect(await eval_(judgeArgv(["--judges", "fairness,vibes"]))).toBe(1);
    expect(err.join("\n")).toContain("vibes");
    err = [];
    expect(await eval_(judgeArgv(["--judges", "fairness", "--no-judges"]))).toBe(1);
    expect(err.join("\n")).toContain("cannot be used together");
  });

  it("uses --model-override for the run's binding and records it", async () => {
    const config = stubConfig(passingAnswers(), { model: "opus" });
    expect(await eval_(judgeArgv(["--config", config, "--model-override", "blueprint-judge=sonnet", "--quiet"]))).toBe(0);
    const result = await theResult();
    expect(result.run.bindings["blueprint-judge"].model).toBe("sonnet");
    expect(result.verdicts.find((v) => v.id === "fairness")?.call?.model).toBe("sonnet");
  });
});

describe("validate", () => {
  it("exits 0 on a valid blueprint and writes a result with only mechanical verdicts", async () => {
    const alone = write("alone/blueprint.json", readableBlueprint());
    const argv = ["validate", alone, "--output-root", path.join(dir, "out")];
    expect(await eval_(argv)).toBe(0);

    const result = await theResult();
    expect(result.verdicts.map((v) => v.id)).toEqual(["blueprint_schema_valid", "no_orphan_clues", "requires_satisfiable"]);
    expect(result.verdicts.every((v) => v.tier === "mechanical" && v.status === "pass")).toBe(true);
    expect(result.run.bindings).toEqual({});
    expect(fs.existsSync(path.join(path.dirname(results()[0]), "brief.json"))).toBe(false);
  });

  it("also checks the counts the brief asks for, when given one", async () => {
    const argv = ["validate", path.join(dir, "blueprint.json"), "--brief", path.join(dir, "brief.json"), "--output-root", path.join(dir, "out")];
    expect(await eval_(argv)).toBe(0);
    expect((await theResult()).verdicts.map((v) => v.id)).toContain("culprit_count_matches_brief");
  });

  it("exits 2 when a check fails", async () => {
    write("brief.json", { ...BRIEF, culprits: 2 });
    const argv = ["validate", path.join(dir, "blueprint.json"), "--brief", path.join(dir, "brief.json"), "--output-root", path.join(dir, "out")];
    expect(await eval_(argv)).toBe(2);
    expect(out.join("\n")).toContain("FAIL culprit_count_matches_brief");
    expect((await theResult()).summary.passed).toBe(false);
  });

  it("exits 2 for a blueprint that fails the schema", async () => {
    const alone = write("alone/blueprint.json", { schema_version: "v2" });
    const argv = ["validate", alone, "--output-root", path.join(dir, "out")];
    expect(await eval_(argv)).toBe(2);
    expect((await theResult()).verdicts.map((v) => [v.id, v.status])).toEqual([["blueprint_schema_valid", "fail"]]);
  });

  it("exits 1 when the file is missing or is not JSON", async () => {
    expect(await eval_(["validate", path.join(dir, "nothing.json"), "--output-root", path.join(dir, "out")])).toBe(1);
    write("broken.json", "{not json");
    expect(await eval_(["validate", path.join(dir, "broken.json"), "--output-root", path.join(dir, "out")])).toBe(1);
    expect(err.join("\n")).toContain("is not JSON");
    expect(results()).toEqual([]);
  });
});
