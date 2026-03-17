import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { formatVerificationCliOutput } from "../../../scripts/verify-blueprint.mjs";
import { verifyBlueprintPath } from "../../../scripts/lib/blueprints/verify-blueprint.mjs";

describe("verify blueprint", () => {
  it("writes a deterministic report for a valid blueprint", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "verify-blueprint-"));
    const blueprintPath = path.join(tmpDir, "cookie-caper.1.blueprint.json");
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
    expect(result.reportPath).toContain("cookie-caper.1.verification.json");
    expect(result.report.solve_path).not.toBeNull();
    expect(result.report.solve_path?.actions.length).toBe(
      result.report.computed_metrics.required_actions,
    );
    expect(result.report.solve_path?.starting_location_key).toBeTruthy();
    expect(result.report.solve_path?.collected_evidence_keys.length).toBeGreaterThan(0);
    expect(formatVerificationCliOutput(result)).toBe(`PASS ${result.reportPath}`);
  });

  it("writes a failing verification report for malformed output", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "verify-blueprint-invalid-"));
    const blueprintPath = path.join(tmpDir, "cookie-caper.2.blueprint.json");
    await writeFile(blueprintPath, "not-json", "utf-8");

    const result = await verifyBlueprintPath(blueprintPath);
    expect(result.report.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(result.report.blocking_findings[0]?.rule_id).toBe("schema.parse");
    expect(result.reportPath).toContain("cookie-caper.2.verification.json");
    expect(result.report.solve_path ?? null).toBeNull();
    expect(formatVerificationCliOutput(result)).toBe(`FAIL ${result.reportPath}`);
  });
});
