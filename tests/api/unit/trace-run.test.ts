import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateDimension,
  projectTurnsForJudge,
  runTraceJudge,
} from "../../../evaluation/trace/run.mjs";
import { loadTraceJudgeSystemPrompt } from "../../../evaluation/trace/lib/load.mjs";
import { createRunTimer } from "../../../evaluation/pipeline/timing.mjs";
import { reconstructTrace } from "../../../evaluation/trace/lib/reconstruct.mjs";
import { schema as gmFabricationSchema } from "../../../evaluation/trace/dimensions/gm-fabrication.schema.ts";
import { makeRawTrace } from "./trace-fixtures";

const MOCK_JUDGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "trace-mock-judge.mjs");

function judgeStep(retries = 0) {
  return {
    cmd: "node",
    args: [MOCK_JUDGE, "{{system_prompt_file}}", "{{user_message_file}}"],
    extract_path: "result",
    timeout_ms: 30000,
    retries,
  };
}

async function tmpDir() {
  return fs.mkdtemp(path.join(os.tmpdir(), "trace-run-test-"));
}

const originalMode = process.env.MOCK_JUDGE_MODE;
afterEach(() => {
  if (originalMode === undefined) delete process.env.MOCK_JUDGE_MODE;
  else process.env.MOCK_JUDGE_MODE = originalMode;
});

describe("projectTurnsForJudge", () => {
  it("keeps only game-master turns and carries the narration", () => {
    const { turns } = reconstructTrace(makeRawTrace());
    const projected = projectTurnsForJudge(turns);
    type ProjTurn = { role_name: string | null; sequence: number; narration: string };
    expect(projected.every((t: ProjTurn) => t.role_name !== null)).toBe(true);
    expect(projected.find((t: ProjTurn) => t.sequence === 2)?.narration).toMatch(/muddy footprint/);
    expect(projected.some((t: ProjTurn) => t.sequence === 1)).toBe(false); // start dropped
  });
});

describe("evaluateDimension (mock judge CLI)", () => {
  it("returns a passing dimension for a passing verdict", async () => {
    process.env.MOCK_JUDGE_MODE = "pass";
    const dir = await tmpDir();
    const { turns } = reconstructTrace(makeRawTrace());
    const result = await evaluateDimension({
      dimRef: { id: "gm_fabrication" },
      blueprint: makeRawTrace().blueprint,
      judgeTurns: projectTurnsForJudge(turns),
      judgeSystemBase: await loadTraceJudgeSystemPrompt(),
      judgeStep: judgeStep(),
      logDir: path.join(dir, "logs"),
      runDir: dir,
      timer: createRunTimer(),
    });
    expect(result.overall).toBe("pass");
    expect(result.judge.raw.verdict).toBe("pass");
  });

  it("returns a failing dimension for a failing verdict", async () => {
    process.env.MOCK_JUDGE_MODE = "fail";
    const dir = await tmpDir();
    const { turns } = reconstructTrace(makeRawTrace());
    const result = await evaluateDimension({
      dimRef: { id: "gm_fabrication" },
      blueprint: makeRawTrace().blueprint,
      judgeTurns: projectTurnsForJudge(turns),
      judgeSystemBase: await loadTraceJudgeSystemPrompt(),
      judgeStep: judgeStep(),
      logDir: path.join(dir, "logs"),
      runDir: dir,
      timer: createRunTimer(),
    });
    expect(result.overall).toBe("fail");
    expect(result.judge.raw.findings[0].sequence).toBe(6);
  });
});

describe("runTraceJudge retry semantics", () => {
  it("reports schema_fail when the model output violates the schema", async () => {
    process.env.MOCK_JUDGE_MODE = "invalid";
    const dir = await tmpDir();
    const outcome = await runTraceJudge({
      step: "judge-gm_fabrication",
      config: judgeStep(0),
      systemPrompt: "sys",
      userMessage: "{}",
      logDir: path.join(dir, "logs"),
      schema: gmFabricationSchema,
      env: {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error.stage).toBe("judge_parse");
    expect(outcome.attempts).toHaveLength(1);
  });

  it("retries schema failures up to the budget", async () => {
    process.env.MOCK_JUDGE_MODE = "invalid";
    const dir = await tmpDir();
    const outcome = await runTraceJudge({
      step: "judge-gm_fabrication",
      config: judgeStep(1),
      systemPrompt: "sys",
      userMessage: "{}",
      logDir: path.join(dir, "logs"),
      schema: gmFabricationSchema,
      env: {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.attempts).toHaveLength(2);
    expect(outcome.attempts.every((a: { outcome: string }) => a.outcome === "schema_fail")).toBe(true);
  });

  it("reports cli_fail when the judge process crashes", async () => {
    process.env.MOCK_JUDGE_MODE = "crash";
    const dir = await tmpDir();
    const outcome = await runTraceJudge({
      step: "judge-gm_fabrication",
      config: judgeStep(0),
      systemPrompt: "sys",
      userMessage: "{}",
      logDir: path.join(dir, "logs"),
      schema: gmFabricationSchema,
      env: {},
    });
    expect(outcome.ok).toBe(false);
    expect(outcome.error.stage).toBe("judge");
    expect(outcome.attempts[0].outcome).toBe("cli_fail");
  });
});
