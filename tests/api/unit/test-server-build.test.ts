import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildWebApp } from "../../../scripts/lib/test-server.mjs";

type RunOptions = { env: Record<string, string | undefined> };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-guard-"));
  roots.push(root);
  return root;
}

describe("buildWebApp", () => {
  it("builds with the run's config root, so the developer's is never resolved", () => {
    const configRoot = tempRoot();
    let seen: RunOptions | undefined;

    buildWebApp("/repo", configRoot, (_command: string, _args: string[], options: RunOptions) => {
      seen = options;
      return { status: 0 };
    });

    expect(seen?.env.MYSTERY_CONFIG_ROOT).toBe(configRoot);
  });

  it("fails when the build opened a database", () => {
    const configRoot = tempRoot();
    // What the hook did before it skipped the engine while building.
    const openDatabaseWhileBuilding = (_command: string, _args: string[], options: RunOptions) => {
      const dir = path.join(options.env.MYSTERY_CONFIG_ROOT ?? "", "database", "main");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "game.db"), "");
      return { status: 0 };
    };

    expect(() => buildWebApp("/repo", configRoot, openDatabaseWhileBuilding)).toThrow(
      /Building the web app opened a database/,
    );
  });

  it("fails when the build fails", () => {
    expect(() => buildWebApp("/repo", tempRoot(), () => ({ status: 1 }))).toThrow(
      /Failed to build the web app/,
    );
  });
});
