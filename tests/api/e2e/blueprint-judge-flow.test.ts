import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { judgeBlueprintPath } from "../../../scripts/lib/blueprints/judge-blueprint.mjs";

describe("blueprint judge flow", () => {
  it("fails closed when provider output is invalid", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "judge-flow-"));
    const blueprintPath = path.join(tmpDir, "cookie-caper.1.blueprint.json");
    await writeFile(
      blueprintPath,
      await readFile(
        path.join(process.cwd(), "supabase", "seed", "blueprints", "mock-blueprint.json"),
        "utf-8",
      ),
      "utf-8",
    );

    await expect(() =>
      judgeBlueprintPath({
        blueprintPath,
        model: "test-model",
        apiKey: "test-key",
        requestJsonImpl: async () => ({ invalid: true }),
      })
    ).rejects.toThrow();
  });
});
