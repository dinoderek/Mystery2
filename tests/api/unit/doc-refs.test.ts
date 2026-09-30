import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkPath, extractRefs } from "../../../scripts/lib/doc-refs.mjs";

/**
 * The doc reference check is only worth having if it never cries wolf: a
 * model id or an enum written with slashes must not read as a missing file,
 * or people learn to ignore it.
 */

describe("extractRefs", () => {
  it("finds scripts everywhere, and paths and links only outside fences", () => {
    const md = [
      "Run `npm run check:doc-refs` and see `docs/ui.md` or [testing](testing.md#gate).",
      "```bash",
      "npm -w web run test:e2e",
      "├── prompts/generator-prompt.md",
      "```",
      "`npm run -s db:copy -- prod`",
    ].join("\n");

    expect(extractRefs(md)).toEqual([
      { kind: "script", workspace: null, value: "check:doc-refs", line: 1 },
      { kind: "path", value: "docs/ui.md", line: 1 },
      { kind: "link", value: "testing.md", line: 1 },
      { kind: "script", workspace: "web", value: "test:e2e", line: 3 },
      { kind: "script", workspace: null, value: "db:copy", line: 6 },
    ]);
  });

  it("skips spans that cannot be a single path", () => {
    const md =
      "`win|lose` `src/endpoints/<name>.ts` `docs/*.md` `~/mysteryevals/` " +
      "`/abs/path` `https://x.y/z` `test-results/.../summary.log` `talk to <name>`";
    expect(extractRefs(md)).toEqual([]);
  });

  it("drops a line suffix and an anchor", () => {
    const md = "`docs/game.md:12` `docs/game.md#talking`";
    expect(extractRefs(md).map((r) => r.value)).toEqual(["docs/game.md", "docs/game.md"]);
  });
});

describe("checkPath", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "doc-refs-"));
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "ui.md"), "");
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("is not a path when the first segment exists nowhere", () => {
    expect(checkPath("anthropic/claude-sonnet-4", [root])).toBeNull();
  });

  it("is broken when the first segment exists but the file does not", () => {
    expect(checkPath("docs/gone.md", [root])).toEqual({
      exists: false,
      candidates: [path.join(root, "docs", "gone.md")],
    });
  });

  it("exists when any base resolves it", () => {
    const other = path.join(root, "other");
    fs.mkdirSync(path.join(other, "docs"), { recursive: true });
    expect(checkPath("docs/ui.md", [other, root])?.exists).toBe(true);
  });
});
