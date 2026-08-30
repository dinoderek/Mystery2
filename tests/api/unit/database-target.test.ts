// Which database a checkout talks to.
//
// The rule this file exists to protect: two worktrees must never resolve to
// the same file. `MIGRATIONS` is forward-only and keyed on `PRAGMA
// user_version`, so a shared database that one branch upgrades is a database
// every other branch can no longer open.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  MAIN_DATABASE,
  PROD_DATABASE,
  isValidDatabaseName,
  listDatabases,
  resolveDatabaseDir,
  resolveDatabaseFile,
  resolveDatabaseName,
  resolveDatabasesRoot,
} from "../../../lib/database-target.mjs";

// Not a git worktree, so nothing here depends on where the suite is checked out.
const REPO_ROOT = "/repo";

describe("resolveDatabaseName", () => {
  it("uses MYSTERY_DATABASE when it is set", () => {
    expect(resolveDatabaseName(REPO_ROOT, { MYSTERY_DATABASE: PROD_DATABASE })).toBe("prod");
  });

  it("falls back to main outside a worktree", () => {
    expect(resolveDatabaseName(REPO_ROOT, {})).toBe(MAIN_DATABASE);
  });

  it("ignores a blank MYSTERY_DATABASE rather than resolving to an empty name", () => {
    expect(resolveDatabaseName(REPO_ROOT, { MYSTERY_DATABASE: "   " })).toBe(MAIN_DATABASE);
  });

  it("refuses a name that would reach outside the databases directory", () => {
    for (const name of ["..", "../prod", "a/b", ".", "a\\b"]) {
      expect(() => resolveDatabaseName(REPO_ROOT, { MYSTERY_DATABASE: name })).toThrow(
        /Invalid database name/,
      );
    }
  });

  it("names this worktree after its directory, so two checkouts differ", () => {
    // The real derivation, run against this checkout. Whether the suite runs
    // from a worktree or the main clone, the name has to be a usable segment.
    const name = resolveDatabaseName(process.cwd(), {});
    expect(isValidDatabaseName(name)).toBe(true);
    expect(name).not.toBe(PROD_DATABASE);
  });
});

describe("path resolution", () => {
  it("groups the databases under the config root when one is set", () => {
    const env = { MYSTERY_CONFIG_ROOT: "/shared/mystery" };

    expect(resolveDatabasesRoot(REPO_ROOT, env)).toBe(path.join("/shared/mystery", "database"));
    expect(resolveDatabaseDir("prod", REPO_ROOT, env)).toBe(
      path.join("/shared/mystery", "database", "prod"),
    );
    expect(resolveDatabaseFile("prod", REPO_ROOT, env)).toBe(
      path.join("/shared/mystery", "database", "prod", "game.db"),
    );
  });

  it("keeps them in the repo when there is no config root", () => {
    expect(resolveDatabaseFile("main", REPO_ROOT, {})).toBe(
      path.join("/repo", "database", "main", "game.db"),
    );
  });

  it("gives every name its own directory", () => {
    const env = { MYSTERY_CONFIG_ROOT: "/shared/mystery" };

    expect(resolveDatabaseFile("prod", REPO_ROOT, env)).not.toBe(
      resolveDatabaseFile("main", REPO_ROOT, env),
    );
  });
});

describe("listDatabases", () => {
  let configRoot: string;

  beforeEach(() => {
    configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-db-list-"));
  });

  afterEach(() => {
    fs.rmSync(configRoot, { recursive: true, force: true });
  });

  it("is empty before anything has been created", () => {
    expect(listDatabases(configRoot, {})).toEqual([]);
  });

  it("reports each database, sorted, with whether its file exists yet", () => {
    const root = path.join(configRoot, "database");
    fs.mkdirSync(path.join(root, "prod"), { recursive: true });
    fs.mkdirSync(path.join(root, "main"), { recursive: true });
    fs.writeFileSync(path.join(root, "main", "game.db"), "");

    expect(listDatabases(configRoot, {})).toEqual([
      {
        name: "main",
        dir: path.join(root, "main"),
        file: path.join(root, "main", "game.db"),
        exists: true,
      },
      {
        name: "prod",
        dir: path.join(root, "prod"),
        file: path.join(root, "prod", "game.db"),
        exists: false,
      },
    ]);
  });

  it("ignores loose files beside the database directories", () => {
    const root = path.join(configRoot, "database");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "README"), "");

    expect(listDatabases(configRoot, {})).toEqual([]);
  });
});
