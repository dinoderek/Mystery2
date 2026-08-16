import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { MIRRORED_FILES } from "../../../scripts/sync-shared.mjs";

interface Mirror {
  from: string;
  to: string;
}

// Some shared modules exist as a verbatim copy under supabase/functions because
// the edge runtime container mounts only that directory and cannot import out
// to packages/shared. `npm run sync:shared` writes the copies; these tests are
// the backstop that fails when someone edits a copy directly or forgets to run
// the sync. The gate also runs `check:shared-sync` for the same reason — this
// test keeps the failure visible to anyone running only the unit suite.
describe("mirrored shared files", () => {
  const mirrors = MIRRORED_FILES as Mirror[];

  it("declares at least one mirror", () => {
    expect(mirrors.length).toBeGreaterThan(0);
  });

  it.each(mirrors)("$to is byte-identical to $from", async ({ from, to }) => {
    const [canonical, copy] = await Promise.all([
      readFile(from, "utf-8"),
      readFile(to, "utf-8"),
    ]);

    // If this fails: edit ONLY the canonical file, then `npm run sync:shared`.
    expect(copy).toBe(canonical);
  });

  it.each(mirrors)("$from stays import-free so the copy runs under Deno and Node", async ({ from }) => {
    const source = await readFile(from, "utf-8");

    // A bare `zod` specifier resolves in Node but not Deno (which needs
    // `npm:zod`), so a mirrored file must not import anything at all. A file
    // that grows an import needs a hand-written adapter, not a mirror.
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/^\s*export\s+\*\s+from\s/m);
  });
});
