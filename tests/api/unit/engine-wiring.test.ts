import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "../../..");

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    env: GIT_ENV,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function read(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

describe("engine wiring", () => {
  it("tracks a settings file that enables the engine plugin from the engine marketplace", () => {
    const settings = JSON.parse(read(".claude/settings.json"));
    expect(settings.enabledPlugins).toEqual({ "engine@engine": true });
    expect(settings.extraKnownMarketplaces.engine).toEqual({
      source: { source: "github", repo: "dinoderek/engine" },
    });
  });

  it("has a pull request template with the four parts", () => {
    const template = read(".github/pull_request_template.md");
    const headings = template
      .split("\n")
      .filter((line) => line.startsWith("## "))
      .map((line) => line.slice(3).trim());
    expect(headings).toEqual([
      "Objective",
      "Tests",
      "Reviewer focus",
      "Deviations from the task",
    ]);
  });

  it("has a Workflow section in AGENTS.md and states the gate duration as about 20 seconds", () => {
    const agents = read("AGENTS.md");
    expect(agents).toMatch(/^## Workflow$/m);
    expect(agents).not.toContain("about a minute");
    expect(agents).toContain("about 20 seconds");
    expect(agents.split(/\s+/).filter(Boolean).length).toBeLessThan(1000);
  });

  describe("gitignore keeps .claude/settings.json and ignores the rest of .claude/", () => {
    let dir: string;

    beforeEach(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine-wiring-"));
      git(dir, "init", "-q");
      fs.copyFileSync(
        path.join(REPO_ROOT, ".gitignore"),
        path.join(dir, ".gitignore"),
      );
      fs.mkdirSync(path.join(dir, ".claude"));
      fs.copyFileSync(
        path.join(REPO_ROOT, ".claude/settings.json"),
        path.join(dir, ".claude/settings.json"),
      );
      git(dir, "add", ".gitignore", ".claude/settings.json");
      git(dir, "-c", "commit.gpgsign=false", "commit", "-q", "-m", "init");
    });

    afterEach(() => {
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it("leaves local settings and other files under .claude/ out of git status", () => {
      fs.writeFileSync(path.join(dir, ".claude/settings.local.json"), "{}\n");
      fs.writeFileSync(path.join(dir, ".claude/other.json"), "{}\n");
      expect(git(dir, "status", "--porcelain")).toBe("");
    });

    it("keeps .claude/settings.json tracked", () => {
      expect(git(dir, "ls-files", ".claude/settings.json")).toBe(
        ".claude/settings.json",
      );
      // `git check-ignore` exits 1 when the path is not ignored.
      const ignored = spawnSync(
        "git",
        ["check-ignore", "--no-index", ".claude/settings.json"],
        {
          cwd: dir,
          env: GIT_ENV,
        },
      );
      expect(ignored.status).toBe(1);
    });
  });
});
