import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createDraftRun,
  generatedAIJudgeReportFilename,
  generatedBlueprintFilename,
  generatedVerificationFilename,
} from "../../../scripts/lib/blueprints/draft-runs.mjs";

describe("blueprint draft runs", () => {
  it("uses the drafts root directly without creating subdirectories", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "draft-runs-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Brief", "utf-8");

    const run = await createDraftRun({
      briefPath,
      outputName: "Cookie Caper",
      draftsRoot: path.join(tmpDir, "blueprints", "drafts"),
    });

    expect(run.runDir).toBe(path.join(tmpDir, "blueprints", "drafts"));
    expect(await readdir(run.runDir)).toEqual([]);
  });

  it("centralizes candidate artifact filenames", () => {
    expect(generatedBlueprintFilename("Cookie Caper", 1)).toBe("cookie-caper.1.blueprint.json");
    expect(generatedVerificationFilename("Cookie Caper", 1)).toBe("cookie-caper.1.verification.json");
    expect(generatedAIJudgeReportFilename("Cookie Caper", 1)).toBe("cookie-caper.1.ai-judge-report.json");
  });
});
