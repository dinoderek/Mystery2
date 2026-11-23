/**
 * The root's `playwright` and the browser suite's `@playwright/test` move
 * together: root-level browser helpers launch the Chromium the browser suite
 * installs, and each Playwright version
 * looks for its own build of it.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";

function devDependency(manifest: string, name: string): string {
  const parsed = JSON.parse(fs.readFileSync(path.join(repoRoot(), manifest), "utf8"));
  const version = parsed.devDependencies?.[name] ?? parsed.dependencies?.[name];
  if (typeof version !== "string") throw new Error(`${manifest} pins no ${name}`);
  return version;
}

describe("the Playwright versions", () => {
  it("are the same in package.json and web/package.json", () => {
    const root = devDependency("package.json", "playwright");
    const web = devDependency("web/package.json", "@playwright/test");
    expect(root, `playwright ${root} in package.json and @playwright/test ${web} in web/package.json must be the same version`).toBe(web);
  });
});
