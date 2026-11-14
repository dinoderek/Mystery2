import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  USAGE,
  buildRunCommand,
  buildTestCommand,
  main,
} from "../../../scripts/dev-cli.mjs";
import {
  checkNodeVersion,
  dependenciesStale,
  isPortFree,
} from "../../../scripts/lib/dev-doctor.mjs";
import {
  DevError,
  createWorktree,
  fetchOrigin,
  REF_LOCK_FAILURE,
  releaseWorktree,
  worktreePathFor,
} from "../../../scripts/lib/dev-worktree.mjs";
import { GATE_STEPS, selectSteps } from "../../../scripts/lib/gate-steps.mjs";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function commit(cwd: string, file: string, message: string): string {
  fs.writeFileSync(path.join(cwd, file), message);
  git(cwd, "add", file);
  git(cwd, "commit", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}

/** A throwaway clone of a throwaway bare origin; never the real repository. */
let sandbox: string;
let origin: string;
let clone: string;
let configRoot: string;

beforeEach(() => {
  // realpath: git reports /private/var where the temp dir says /var.
  sandbox = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "dev-cli-")));
  origin = path.join(sandbox, "origin.git");
  clone = path.join(sandbox, "clone");
  configRoot = path.join(sandbox, "config");

  git(sandbox, "init", "--bare", "-b", "main", origin);
  git(sandbox, "clone", origin, clone);
  git(clone, "checkout", "-b", "main");
  commit(clone, "README.md", "first");
  git(clone, "push", "-u", "origin", "main");
  git(clone, "remote", "set-head", "origin", "main");
});

afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

/** An install that records where it ran instead of running npm. */
function recordingInstall() {
  const ran: string[] = [];
  return { ran, install: (dir: string) => (ran.push(dir), 0) };
}

describe("./dev usage", () => {
  it("prints the usage naming every verb, exits 0, and runs nothing", async () => {
    const out: string[] = [];
    const executed: unknown[] = [];
    const before = fs.readdirSync(sandbox);

    const status = await main([], {
      root: clone,
      out: (text: string) => out.push(text),
      execute: (command: unknown) => (executed.push(command), 0),
    });

    expect(status).toBe(0);
    expect(executed).toEqual([]);
    expect(fs.readdirSync(sandbox)).toEqual(before);
    for (const verb of ["doctor", "run", "test", "worktree create", "worktree release"]) {
      expect(out.join("\n")).toContain(verb);
    }
  });

  it("is what the executable prints on stdout, with exit 0", () => {
    const result = spawnSync(path.join(REPO_ROOT, "dev"), [], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("worktree create");
    expect(result.stdout).toContain("worktree release");
    expect(result.stdout.trim()).toBe(USAGE.trim());
  });

  it("prints the usage and exits non-zero for an unknown verb", async () => {
    const err: string[] = [];
    const status = await main(["frobnicate"], { root: clone, err: (text: string) => err.push(text) });
    expect(status).not.toBe(0);
    expect(err.join("\n")).toContain("worktree create");
  });

  it("rejects a worktree action it does not know, or one with no branch", async () => {
    const err = (text: string) => text;
    expect(await main(["worktree"], { root: clone, err })).toBe(2);
    expect(await main(["worktree", "create"], { root: clone, err })).toBe(2);
    expect(await main(["worktree", "remove", "x"], { root: clone, err })).toBe(2);
  });
});

describe("./dev eval", () => {
  const fake = (name: string) => ({ name, summary: `does ${name}`, help: `help for ${name}`, run: async () => 0 });

  it("lists the evaluation commands when given none, and exits 0", async () => {
    const out: string[] = [];
    const status = await main(["eval"], {
      root: clone,
      out: (text: string) => out.push(text),
      evalCommands: [fake("judge blueprint"), fake("play")],
    });
    expect(status).toBe(0);
    expect(out.join("\n")).toContain("judge blueprint  does judge blueprint");
    expect(out.join("\n")).toContain("play             does play");
  });

  it("exits 1 for an evaluation command it does not know", async () => {
    const err: string[] = [];
    const status = await main(["eval", "frobnicate"], {
      root: clone,
      err: (text: string) => err.push(text),
      evalCommands: [fake("play")],
    });
    expect(status).toBe(1);
    expect(err.join("\n")).toContain('Unknown eval command "frobnicate"');
  });

  it("loads only Node builtins and scripts/lib at the top, so ./dev runs before dependencies are installed", () => {
    const source = fs.readFileSync(path.join(REPO_ROOT, "scripts", "dev-cli.mjs"), "utf8");
    const imports = [...source.matchAll(/^import\s[^;]*?from\s+"([^"]+)"/gms)].map((match) => match[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const specifier of imports) expect(specifier).toMatch(/^(node:|\.\/lib\/)/);
  });

  it("runs from the executable, loading the evaluation code under Node's own type stripping", () => {
    const listed = spawnSync(path.join(REPO_ROOT, "dev"), ["eval"], { encoding: "utf8" });
    expect(listed.status).toBe(0);
    expect(listed.stdout).toContain("Usage: ./dev eval <command>");
    expect(listed.stderr).toBe("");

    const unknown = spawnSync(path.join(REPO_ROOT, "dev"), ["eval", "frobnicate"], { encoding: "utf8" });
    expect(unknown.status).toBe(1);
  });
});

describe("./dev test and ./dev run", () => {
  it("hands the steps to the existing gate runner", () => {
    expect(buildTestCommand("/r", [])).toEqual({
      command: process.execPath,
      args: ["/r/scripts/run-test-gate.mjs"],
      cwd: "/r",
    });
    expect(buildTestCommand("/r", ["lint", "doc-refs"]).args).toEqual([
      "/r/scripts/run-test-gate.mjs",
      "lint",
      "doc-refs",
    ]);
  });

  it("hands the mode and database to the existing game starter", () => {
    expect(buildRunCommand("/r", ["free", "--db", "scratch"]).args).toEqual([
      "/r/scripts/dev.mjs",
      "free",
      "--db",
      "scratch",
    ]);
  });

  it("runs what it built and returns that command's status", async () => {
    const seen: Array<{ args: string[]; cwd: string }> = [];
    const execute = (command: { args: string[]; cwd: string }) => (seen.push(command), 3);

    expect(await main(["test", "lint"], { root: "/r", execute })).toBe(3);
    expect(await main(["run", "--db", "x"], { root: "/r", execute })).toBe(3);
    expect(seen.map((command) => command.args.slice(1))).toEqual([["lint"], ["--db", "x"]]);
    expect(seen.every((command) => command.cwd === "/r")).toBe(true);
  });

  it("selects only the named gate steps, and refuses a name it does not know", () => {
    expect(selectSteps(GATE_STEPS, [])).toBe(GATE_STEPS);
    expect(selectSteps(GATE_STEPS, ["doc-refs", "lint"]).map((step: { name: string }) => step.name)).toEqual([
      "lint",
      "doc-refs",
    ]);
    expect(() => selectSteps(GATE_STEPS, ["lint", "nope"])).toThrow(/Unknown gate step: nope/);
  });

  it("selects every check by name, including the doc checks and gate-coverage", () => {
    for (const name of ["curated-docs", "doc-refs", "word-budgets", "gate-coverage"]) {
      expect(selectSteps(GATE_STEPS, [name]).map((step: { name: string }) => step.name)).toEqual([name]);
    }
  });
});

describe("./dev worktree create's fetch", () => {
  /** Moves origin on, so the clone's next fetch has to update its ref, and holds that ref's lock. */
  function lockOriginMain() {
    const other = path.join(sandbox, "other");
    git(sandbox, "clone", origin, other);
    const tip = commit(other, "later.txt", "later");
    git(other, "push", "origin", "HEAD:main");
    const lock = path.join(clone, ".git", "refs", "remotes", "origin", "main.lock");
    fs.writeFileSync(lock, "");
    return { tip, lock };
  }

  it("retries when another fetch holds a ref lock, and succeeds once it is released", () => {
    const { tip, lock } = lockOriginMain();
    const waits: number[] = [];

    fetchOrigin(clone, { wait: (attempt: number) => (waits.push(attempt), fs.rmSync(lock)) });

    expect(waits).toEqual([1]);
    expect(git(clone, "rev-parse", "origin/main")).toBe(tip);
  });

  it("gives up after a bounded number of tries while the lock stays", () => {
    lockOriginMain();
    const waits: number[] = [];

    expect(() => fetchOrigin(clone, { wait: (attempt: number) => waits.push(attempt) })).toThrow(
      /git fetch origin failed \(after 3 tries\): .*(cannot lock ref|reference already exists)/s,
    );
    expect(waits).toEqual([1, 2]);
  });

  it.each([
    ["older git", "error: cannot lock ref 'refs/remotes/origin/main': is at abc but expected def"],
    ["older git, lock file", "fatal: Unable to create '/r/.git/refs/remotes/origin/main.lock': File exists."],
    ["newer git (2.53)", "error: fetching ref refs/remotes/origin/main failed: reference already exists"],
  ])("recognises a lost ref race as git words it: %s", (_git, message) => {
    expect(REF_LOCK_FAILURE.test(message)).toBe(true);
  });

  it("does not take other fetch failures for a ref lock", () => {
    expect(REF_LOCK_FAILURE.test("fatal: '/x/missing.git' does not appear to be a git repository")).toBe(false);
    expect(REF_LOCK_FAILURE.test("error: fetching ref refs/heads/x failed: some other reason")).toBe(false);
  });

  it("does not retry a failure that is not a ref lock", () => {
    git(clone, "remote", "set-url", "origin", path.join(sandbox, "missing.git"));
    const waits: number[] = [];

    expect(() => fetchOrigin(clone, { wait: (attempt: number) => waits.push(attempt) })).toThrow(DevError);
    expect(waits).toEqual([]);
  });
});

describe("./dev worktree create", () => {
  it("puts a new branch beside the clone, cut from origin's current default branch", () => {
    // Origin moves on after the clone was made: create has to fetch.
    const other = path.join(sandbox, "other");
    git(sandbox, "clone", origin, other);
    const tip = commit(other, "later.txt", "later");
    git(other, "push", "origin", "HEAD:main");

    const { ran, install } = recordingInstall();
    const target = createWorktree("task/Mystery2-76", { cwd: clone, log: () => {}, install });

    expect(target).toBe(path.join(sandbox, "clone-worktrees", "task-Mystery2-76"));
    expect(target).toBe(worktreePathFor(clone, "task/Mystery2-76"));
    expect(git(target, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task/Mystery2-76");
    expect(git(target, "rev-parse", "HEAD")).toBe(tip);
    expect(git(clone, "branch", "--list", "task/Mystery2-76")).toContain("task/Mystery2-76");
    // The new branch does not track the default branch, so a push cannot land there.
    expect(
      spawnSync("git", ["config", "--get", "branch.task/Mystery2-76.remote"], { cwd: clone }).status,
    ).not.toBe(0);
    expect(ran).toEqual([target]);
  });

  it("checks an existing local branch out as it is", () => {
    git(clone, "branch", "task/old");
    git(clone, "checkout", "task/old");
    const local = commit(clone, "work.txt", "local work");
    git(clone, "checkout", "main");

    const { install } = recordingInstall();
    const target = createWorktree("task/old", { cwd: clone, log: () => {}, install });

    expect(git(target, "rev-parse", "HEAD")).toBe(local);
    expect(git(target, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task/old");
  });

  it("checks out a branch only origin has, from origin", () => {
    const other = path.join(sandbox, "other");
    git(sandbox, "clone", origin, other);
    git(other, "checkout", "-b", "task/remote");
    const pushed = commit(other, "r.txt", "remote work");
    git(other, "push", "origin", "task/remote");

    const { install } = recordingInstall();
    const target = createWorktree("task/remote", { cwd: clone, log: () => {}, install });

    expect(git(target, "rev-parse", "HEAD")).toBe(pushed);
  });

  it("works from inside one of the clone's worktrees, and finds the same path", () => {
    const { install } = recordingInstall();
    const first = createWorktree("task/a", { cwd: clone, log: () => {}, install });
    const second = createWorktree("task/b", { cwd: first, log: () => {}, install });
    expect(path.dirname(second)).toBe(path.dirname(first));
  });

  it("is safe to run again: the worktree stays, and dependencies are not reinstalled once fresh", () => {
    const installs: string[] = [];
    const install = (dir: string) => {
      installs.push(dir);
      fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
      fs.writeFileSync(path.join(dir, "node_modules", ".package-lock.json"), "{}");
      return 0;
    };

    const first = createWorktree("task/again", { cwd: clone, log: () => {}, install });
    const second = createWorktree("task/again", { cwd: clone, log: () => {}, install });

    expect(second).toBe(first);
    expect(installs).toEqual([first]);
  });

  it("fails, leaving the worktree for a retry, when the install fails", () => {
    expect(() => createWorktree("task/bad-install", { cwd: clone, log: () => {}, install: () => 1 })).toThrow(
      DevError,
    );
    expect(fs.existsSync(worktreePathFor(clone, "task/bad-install"))).toBe(true);
  });

  it("refuses a branch name git would not accept", () => {
    const { install } = recordingInstall();
    for (const branch of ["", "-x", "a..b", "a b"]) {
      expect(() => createWorktree(branch, { cwd: clone, log: () => {}, install })).toThrow(DevError);
    }
  });

  it("will not make a worktree named for prod or main", () => {
    const { install } = recordingInstall();
    for (const branch of ["prod", "Main"]) {
      expect(() => createWorktree(branch, { cwd: clone, log: () => {}, install })).toThrow(/refusing/);
    }
  });

  it("refuses a path that is there but is not this clone's worktree", () => {
    fs.mkdirSync(worktreePathFor(clone, "task/squatter"), { recursive: true });
    const { install } = recordingInstall();
    expect(() => createWorktree("task/squatter", { cwd: clone, log: () => {}, install })).toThrow(/not a worktree/);
  });
});

describe("./dev worktree release", () => {
  function setUp(branch: string) {
    const { install } = recordingInstall();
    const target = createWorktree(branch, { cwd: clone, log: () => {}, install });
    const name = path.basename(target);
    // The development databases of three worktrees and the persistent one, in an explicit config root.
    for (const database of [name, "task-other", "prod", "main"]) {
      fs.mkdirSync(path.join(configRoot, "database", database), { recursive: true });
      fs.writeFileSync(path.join(configRoot, "database", database, "game.db"), "x");
    }
    return { target, name, env: { MYSTERY_CONFIG_ROOT: configRoot } };
  }

  it("removes the worktree and only its own database, and keeps the branch", () => {
    const { target, name, env } = setUp("task/gone");

    releaseWorktree("task/gone", { cwd: clone, env, log: () => {} });

    expect(fs.existsSync(target)).toBe(false);
    expect(fs.readdirSync(path.join(configRoot, "database")).sort()).toEqual(["main", "prod", "task-other"]);
    expect(fs.existsSync(path.join(configRoot, "database", name))).toBe(false);
    expect(git(clone, "branch", "--list", "task/gone")).toContain("task/gone");
  });

  it("succeeds when run again, and for a branch with no worktree, touching nothing", () => {
    const { env } = setUp("task/twice");
    releaseWorktree("task/twice", { cwd: clone, env, log: () => {} });
    releaseWorktree("task/twice", { cwd: clone, env, log: () => {} });

    // A database with that name but no worktree is not ours to delete.
    fs.mkdirSync(path.join(configRoot, "database", "task-never"), { recursive: true });
    releaseWorktree("task/never", { cwd: clone, env, log: () => {} });
    expect(fs.existsSync(path.join(configRoot, "database", "task-never"))).toBe(true);
  });

  it("refuses prod and main", () => {
    const { env } = setUp("task/safe");
    // Case too: on a case-insensitive file system `Prod` is the prod database.
    for (const name of ["prod", "main", "Prod", "MAIN"]) {
      expect(() => releaseWorktree(name, { cwd: clone, env, log: () => {} })).toThrow(/refusing/);
    }
    expect(fs.existsSync(path.join(configRoot, "database", "prod", "game.db"))).toBe(true);
    expect(fs.existsSync(path.join(configRoot, "database", "main", "game.db"))).toBe(true);
  });

  it("will not release the worktree of another branch that shares its path", () => {
    const { env } = setUp("task/a-b");
    expect(() => releaseWorktree("task-a/b", { cwd: clone, env, log: () => {} })).toThrow(/not task-a\/b/);
    expect(fs.existsSync(worktreePathFor(clone, "task/a-b"))).toBe(true);
    expect(fs.existsSync(path.join(configRoot, "database", "task-a-b", "game.db"))).toBe(true);
  });

  it("refuses a worktree with uncommitted changes, and leaves it and its database", () => {
    const { target, name, env } = setUp("task/dirty");
    fs.writeFileSync(path.join(target, "scratch.txt"), "unsaved");

    expect(() => releaseWorktree("task/dirty", { cwd: clone, env, log: () => {} })).toThrow(/not releasing/);

    expect(fs.existsSync(path.join(target, "scratch.txt"))).toBe(true);
    expect(fs.existsSync(path.join(configRoot, "database", name, "game.db"))).toBe(true);
  });
});

describe("./dev doctor checks", () => {
  it("compares the Node version with .nvmrc", () => {
    expect(checkNodeVersion("24\n", "24.13.1").ok).toBe(true);
    expect(checkNodeVersion("v24.13.1", "24.13.1").ok).toBe(true);
    expect(checkNodeVersion("24", "22.4.0").ok).toBe(false);
    expect(checkNodeVersion("24.13.2", "24.13.1").ok).toBe(false);
    // An alias cannot be compared, and is not passed.
    expect(checkNodeVersion("lts/*", "24.13.1").ok).toBe(false);
  });

  it("reports whether a port is free", async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as net.AddressInfo;
    try {
      expect(await isPortFree(port)).toBe(false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    expect(await isPortFree(port)).toBe(true);
  });

  it("calls dependencies stale when missing, or older than the lock file", () => {
    expect(dependenciesStale(sandbox)).toBe(true);

    const lock = path.join(sandbox, "package-lock.json");
    const installed = path.join(sandbox, "node_modules", ".package-lock.json");
    fs.mkdirSync(path.dirname(installed));
    fs.writeFileSync(lock, "{}");
    fs.writeFileSync(installed, "{}");
    const now = Date.now() / 1000;

    fs.utimesSync(lock, now - 100, now - 100);
    fs.utimesSync(installed, now, now);
    expect(dependenciesStale(sandbox)).toBe(false);

    fs.utimesSync(lock, now + 100, now + 100);
    expect(dependenciesStale(sandbox)).toBe(true);
  });
});
