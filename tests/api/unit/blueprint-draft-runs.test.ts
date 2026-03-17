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
  it("creates a timestamped run directory derived from output name only", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "draft-runs-"));
    const briefPath = path.join(tmpDir, "brief.md");
    await writeFile(briefPath, "# Brief", "utf-8");

    const run = await createDraftRun({
      briefPath,
      outputName: "Cookie Caper",
      draftsRoot: path.join(tmpDir, "blueprints", "drafts"),
      now: new Date("2026-03-17T12:00:00.000Z"),
    });

    expect(run.draftSlug).toBe("cookie-caper");
    expect(run.runDir).toContain(path.join("blueprints", "drafts", "cookie-caper"));
    expect(await readdir(run.runDir)).toEqual([]);
  });

  it("centralizes candidate artifact filenames", () => {
    expect(generatedBlueprintFilename("Cookie Caper", 1)).toBe("cookie-caper.1.blueprint.json");
    expect(generatedVerificationFilename("Cookie Caper", 1)).toBe("cookie-caper.1.verification.json");
    expect(generatedAIJudgeReportFilename("Cookie Caper", 1)).toBe("cookie-caper.1.ai-judge-report.json");
  });
});
