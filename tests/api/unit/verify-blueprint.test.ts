import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifyBlueprintPath } from "../../../scripts/lib/blueprints/verify-blueprint.mjs";

describe("verify blueprint", () => {
  it("writes a deterministic report for a valid blueprint", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "verify-blueprint-"));
    const blueprintPath = path.join(tmpDir, "candidate-01.blueprint.json");
    await writeFile(
      blueprintPath,
      await readFile(
        path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
        "utf-8",
      ),
      "utf-8",
    );

    const result = await verifyBlueprintPath(blueprintPath);
    expect(result.report.status).toBe("pass");
    expect(result.reportPath).toContain("candidate-01.deterministic-report.json");
  });
});
