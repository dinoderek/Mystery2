import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

function normalizeSharedSchema(text: string): string {
  return text.trim();
}

function normalizeDenoSchema(text: string): string {
  return text
    .replace(
      /^\/\/ Generated from packages\/shared\/src\/blueprint-schema\.ts for Supabase Edge Functions\.\n\/\/ Keep this file in sync with the shared schema using scripts\/sync-blueprint-schema\.mjs\.\n\n/u,
      "",
    )
    .replace('import { z } from "npm:zod";', 'import { z } from "zod";')
    .trim();
}

describe("blueprint schema sync", () => {
  it("keeps the Deno adapter schema in sync with the shared schema source", async () => {
    const [sharedSource, denoSource] = await Promise.all([
      readFile("packages/shared/src/blueprint-schema.ts", "utf-8"),
      readFile("supabase/functions/_shared/blueprints/blueprint-schema.ts", "utf-8"),
    ]);

    expect(normalizeDenoSchema(denoSource)).toBe(normalizeSharedSchema(sharedSource));
  });
});
