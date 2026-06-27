import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";

describe("blueprint schema sync", () => {
  it("Deno adapter V2 schema exports the same type name as the shared source", async () => {
    const denoSource = await readFile(
      "supabase/functions/_shared/blueprints/blueprint-schema-v2.ts",
      "utf-8",
    );

    expect(denoSource).toContain("export const BlueprintV2Schema");
    expect(denoSource).toContain("export type BlueprintV2");
  });

  it("shared V2 schema parses the canonical mock blueprint", async () => {
    const raw = JSON.parse(
      await readFile("supabase/seed/blueprints/mock-blueprint.json", "utf-8"),
    );

    expect(() => BlueprintV2Schema.parse(raw)).not.toThrow();
  });

  it("Deno age-profile copy is byte-identical to the shared source", async () => {
    const [shared, deno] = await Promise.all([
      readFile("packages/shared/src/age-profile.ts", "utf-8"),
      readFile("supabase/functions/_shared/age-profile.ts", "utf-8"),
    ]);

    // age-profile.ts has no imports, so the edge (Deno) copy must match exactly.
    // Keep them in sync — edit the shared source and copy it across.
    expect(deno).toBe(shared);
  });
});
