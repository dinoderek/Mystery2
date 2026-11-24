import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { buildEntry, buildWebApp, createBuildDir, suiteBuildDir } from "../../../scripts/lib/test-server.mjs";

type RunOptions = { env?: Record<string, string | undefined> };
type Call = { args: string[]; options: RunOptions };

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "build-guard-"));
  roots.push(root);
  return root;
}

/** A checkout whose web app has been synced, as `npm ci` leaves it. */
function syncedRepo(): string {
  const repo = tempRoot();
  fs.mkdirSync(path.join(repo, "web", ".svelte-kit"), { recursive: true });
  fs.writeFileSync(path.join(repo, "web", ".svelte-kit", "tsconfig.json"), "{}");
  return repo;
}

function recorder(status = 0) {
  const calls: Call[] = [];
  const run = (_command: string, args: string[], options: RunOptions) => {
    calls.push({ args, options });
    return { status };
  };
  return { calls, run };
}

describe("buildWebApp", () => {
  it("builds with the run's config root, so the developer's is never resolved", () => {
    const configRoot = tempRoot();
    const { calls, run } = recorder();

    buildWebApp(syncedRepo(), configRoot, tempRoot(), run);

    expect(calls.at(-1)?.options.env?.MYSTERY_CONFIG_ROOT).toBe(configRoot);
  });

  it("builds into the folder it is given, so concurrent builds never share one", () => {
    const buildDir = tempRoot();
    const { calls, run } = recorder();

    buildWebApp(syncedRepo(), tempRoot(), buildDir, run);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(["-w", "web", "run", "build"]);
    expect(calls[0]?.options.env?.MYSTERY_WEB_BUILD_DIR).toBe(buildDir);
  });

  it("syncs a checkout that has never synced before building", () => {
    const { calls, run } = recorder();

    buildWebApp(tempRoot(), tempRoot(), tempRoot(), run);

    expect(calls.map((call) => call.args)).toEqual([
      ["-w", "web", "exec", "--", "svelte-kit", "sync"],
      ["-w", "web", "run", "build"],
    ]);
  });

  it("fails when the sync fails", () => {
    expect(() => buildWebApp(tempRoot(), tempRoot(), tempRoot(), recorder(1).run)).toThrow(
      /Failed to sync the web app/,
    );
  });

  it("fails when the build opened a database", () => {
    const configRoot = tempRoot();
    // What the hook did before it skipped the engine while building.
    const openDatabaseWhileBuilding = (_command: string, _args: string[], options: RunOptions) => {
      const dir = path.join(options.env?.MYSTERY_CONFIG_ROOT ?? "", "database", "main");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "game.db"), "");
      return { status: 0 };
    };

    expect(() => buildWebApp(syncedRepo(), configRoot, tempRoot(), openDatabaseWhileBuilding)).toThrow(
      /Building the web app opened a database/,
    );
  });

  it("fails when the build fails", () => {
    expect(() => buildWebApp(syncedRepo(), tempRoot(), tempRoot(), recorder(1).run)).toThrow(
      /Failed to build the web app/,
    );
  });
});

describe("createBuildDir", () => {
  it("makes a new folder under web/ for each build", () => {
    const repo = tempRoot();
    const first = createBuildDir(repo);
    const second = createBuildDir(repo);

    expect(first).not.toBe(second);
    for (const dir of [first, second]) {
      expect(path.dirname(dir)).toBe(path.join(repo, "web", ".test-builds"));
      expect(fs.statSync(dir).isDirectory()).toBe(true);
    }
  });

  it("removes builds an interrupted run left a day ago, and keeps recent ones", () => {
    const repo = tempRoot();
    const old = createBuildDir(repo);
    const recent = createBuildDir(repo);
    const day = 24 * 60 * 60 * 1000;
    const stale = new Date(Date.now() - day - 60_000);
    fs.utimesSync(old, stale, stale);

    createBuildDir(repo);

    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(recent)).toBe(true);
  });
});

describe("suiteBuildDir", () => {
  it("is the suite's build folder when it holds a build", () => {
    const dir = tempRoot();
    fs.mkdirSync(path.dirname(buildEntry(dir)), { recursive: true });
    fs.writeFileSync(buildEntry(dir), "");

    expect(suiteBuildDir({ MYSTERY_TEST_BUILD_DIR: dir })).toBe(dir);
  });

  it("fails when no suite build is named, or the folder holds none", () => {
    expect(() => suiteBuildDir({})).toThrow(/MYSTERY_TEST_BUILD_DIR/);
    expect(() => suiteBuildDir({ MYSTERY_TEST_BUILD_DIR: tempRoot() })).toThrow(/MYSTERY_TEST_BUILD_DIR/);
  });
});
