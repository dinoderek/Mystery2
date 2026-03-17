import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { verifyBlueprintPath } from "../../../scripts/lib/blueprints/verify-blueprint.mjs";

describe("blueprint verify flow", () => {
  it("returns a failing status and non-zero exit code when blocking findings exist", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "verify-flow-"));
    const raw = JSON.parse(
      await readFile(
        path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
        "utf-8",
      ),
    );
    raw.metadata.time_budget = 1;
    const blueprintPath = path.join(tmpDir, "cookie-caper.1.blueprint.json");
    await writeFile(blueprintPath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");

    const result = await verifyBlueprintPath(blueprintPath);
    expect(result.report.status).toBe("fail");
    expect(result.exitCode).toBe(1);
  });
});
