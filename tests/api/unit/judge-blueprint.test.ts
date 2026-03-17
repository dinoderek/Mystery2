import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  loadBlueprintVerifierEnv,
  parseJudgeBlueprintArgs,
} from "../../../scripts/judge-blueprint.mjs";
import { judgeBlueprintPath } from "../../../scripts/lib/blueprints/judge-blueprint.mjs";

describe("judge blueprint", () => {
  it("uses blueprint-verifier model env by default", () => {
    expect(
      parseJudgeBlueprintArgs(
        ["--blueprint-path", "/tmp/blueprint.json"],
        { OPENROUTER_BLUEPRINT_VERIFIER_MODEL: "openai/custom-judge-model" },
      ),
    ).toMatchObject({
      blueprintPath: "/tmp/blueprint.json",
      model: "openai/custom-judge-model",
    });
  });

  it("loads verifier settings from .env.local with shell overrides", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "judge-blueprint-env-"));

    await writeFile(
      path.join(tmpDir, ".env.local"),
      [
        'OPENROUTER_API_KEY="root-key"',
        'OPENROUTER_BLUEPRINT_VERIFIER_MODEL="root-model"',
      ].join("\n"),
      "utf-8",
    );

    const env = await loadBlueprintVerifierEnv(tmpDir, {
      OPENROUTER_BLUEPRINT_VERIFIER_MODEL: "shell-model",
    });

    expect(env.OPENROUTER_API_KEY).toBe("root-key");
    expect(env.OPENROUTER_BLUEPRINT_VERIFIER_MODEL).toBe("shell-model");
  });

  it("writes an AI judge report on valid provider output", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "judge-blueprint-"));
    const blueprintPath = path.join(tmpDir, "candidate-01.blueprint.json");
    await writeFile(
      blueprintPath,
      await readFile(
        path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
        "utf-8",
      ),
      "utf-8",
    );

    const result = await judgeBlueprintPath({
      blueprintPath,
      model: "test-model",
      apiKey: "test-key",
      requestJsonImpl: async () => ({
        judge_version: "v1",
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        dimension_scores: {
          coherence_fairness: 4,
          spoiler_safety: 5,
          age_fit: 4,
          image_readiness: 4,
        },
        blocking_findings: [],
        advisory_findings: [],
        promotion_recommendation: "promote",
        citations: [{ path: "evidence[0]", note: "Strong clue." }],
      }),
    });

    expect(result.reportPath).toContain("candidate-01.ai-judge-report.json");
    expect(result.report.dimension_scores.spoiler_safety).toBe(5);
  });
});
