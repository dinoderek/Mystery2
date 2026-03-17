import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  candidateAIJudgeReportFilename,
  candidateBlueprintFilename,
  candidateDeterministicReportFilename,
  candidateRawOutputFilename,
  createDraftRun,
} from "../../../scripts/lib/blueprints/draft-runs.mjs";

describe("blueprint draft runs", () => {
  it("creates a timestamped run directory and copies brief.md", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "draft-runs-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Brief", "utf-8");

    const run = await createDraftRun({
      briefPath,
      draftsRoot: path.join(tmpDir, "blueprints", "drafts"),
      now: new Date("2026-03-17T12:00:00.000Z"),
    });

    expect(run.runDir).toContain(path.join("blueprints", "drafts"));
    expect(await readFile(path.join(run.runDir, "brief.md"), "utf-8")).toBe("# Brief");
  });

  it("centralizes candidate artifact filenames", () => {
    expect(candidateBlueprintFilename(1)).toBe("candidate-01.blueprint.json");
    expect(candidateRawOutputFilename(1)).toBe("candidate-01.raw-model-output.txt");
    expect(candidateDeterministicReportFilename(1)).toBe("candidate-01.deterministic-report.json");
    expect(candidateAIJudgeReportFilename(1)).toBe("candidate-01.ai-judge-report.json");
  });
});
