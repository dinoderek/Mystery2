// The live-AI runners: they call a model only for an AI they are named, and
// they read that AI from the config root they are pointed at, never from the
// `.env.ai.*` files or `AI_MODEL`. Nothing here starts a server or calls a model.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAIConfig } from "../../../packages/game-engine/src/ai-config.ts";
import { LiveRunError, planServerRun } from "../../../scripts/lib/live-run.mjs";
import { getLiveSuiteTitle, requireLiveAIName, resolveLiveAIName } from "../../testkit/src/live-ai.ts";

const REPO_ROOT = process.cwd();
let root = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "live-run-"));
  fs.writeFileSync(
    path.join(root, "ai.json"),
    JSON.stringify({
      ais: {
        free: { backend: "openrouter", model: "vendor/free", key: "sk-test-throwaway" },
        paid: { backend: "openrouter", model: "vendor/paid" },
        claude: { backend: "claude-cli", model: "sonnet" },
      },
    }),
  );
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const env = (more: Record<string, string> = {}) => ({ MYSTERY_CONFIG_ROOT: root, ...more });

describe("the server runner's plan", () => {
  it("writes the one named AI, key included, into the temporary server's root, and names it to the suite", () => {
    const plan = planServerRun({ repoRoot: root, env: env(), argv: ["integration", "free"] });
    expect(plan).toMatchObject({
      suite: "integration",
      name: "free",
      vitestTarget: "tests/api/integration/live-ai",
      suiteEnv: { AI_LIVE: "1", AI_LIVE_AI: "free", AI_LIVE_TEST_TIMEOUT_MS: "600000" },
    });

    const server = fs.mkdtempSync(path.join(os.tmpdir(), "live-run-server-"));
    try {
      plan.seed(server);
      expect(readAIConfig(path.join(server, "ai.json"))).toEqual({
        ais: { free: { backend: "openrouter", model: "vendor/free", key: "sk-test-throwaway" } },
      });
    } finally {
      fs.rmSync(server, { recursive: true, force: true });
    }
  });

  it("runs the end-to-end suite and takes the test timeout from the environment", () => {
    const plan = planServerRun({ repoRoot: root, env: env({ AI_LIVE_TEST_TIMEOUT_MS: "1000" }), argv: ["e2e", "claude"] });
    expect(plan.vitestTarget).toBe("tests/api/e2e/live-ai");
    expect(plan.suiteEnv).toMatchObject({ AI_LIVE_AI: "claude", AI_LIVE_TEST_TIMEOUT_MS: "1000" });
  });

  it.each([
    [["integration"], /names the AI it calls/],
    [["integration", "  "], /names the AI it calls/],
    [["integration", "mock"], /"mock" calls no model/],
    [["integration", "default"], /"default" calls no model/],
    [[], /Usage: node scripts\/run-live-ai\.mjs/],
    [["browser", "free"], /Usage: node scripts\/run-live-ai\.mjs/],
    [["integration", "free", "paid"], /Usage: node scripts\/run-live-ai\.mjs/],
  ])("refuses %j before any server starts", (argv, message) => {
    expect(() => planServerRun({ repoRoot: root, env: env(), argv })).toThrow(LiveRunError);
    expect(() => planServerRun({ repoRoot: root, env: env(), argv })).toThrow(message);
  });

  it("names an AI that is missing, or an OpenRouter one with no key anywhere", () => {
    expect(() => planServerRun({ repoRoot: root, env: env(), argv: ["integration", "luna"] })).toThrow(/AI "luna" is not in/);
    expect(() => planServerRun({ repoRoot: root, env: env(), argv: ["integration", "paid"] })).toThrow(/AI "paid" uses openrouter but has no key/);
  });

  it("does not read .env.ai.* or AI_MODEL", () => {
    fs.writeFileSync(path.join(root, ".env.ai.paid.local"), "AI_PROVIDER=openrouter\nAI_MODEL=vendor/other\nOPENROUTER_API_KEY=sk-mode-file\n");
    expect(() =>
      planServerRun({ repoRoot: root, env: env({ AI_MODEL: "vendor/env", AI_PROVIDER: "openrouter" }), argv: ["e2e", "paid"] }),
    ).toThrow(/has no key/);
  });
});

describe("the scripts", () => {
  function run(script: string, args: string[]) {
    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, "scripts", script), ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, MYSTERY_CONFIG_ROOT: root },
      timeout: 30_000,
    });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  }

  it("refuse to run without an AI name, before building or calling anything", () => {
    for (const [script, args] of [
      ["run-live-ai.mjs", ["integration"]],
      ["run-live-ai.mjs", []],
    ] as const) {
      const { status, output } = run(script, [...args]);
      expect(status, output).toBe(1);
      expect(output).toMatch(/Usage: node scripts\//);
      expect(output).not.toMatch(/Running|vite|build/i);
    }
  });

  it("refuse an AI that is not in ai.json, naming it", () => {
    for (const [script, args] of [
      ["run-live-ai.mjs", ["e2e", "luna"]],
    ] as const) {
      const { status, output } = run(script, [...args]);
      expect(status, output).toBe(1);
      expect(output).toContain('AI "luna" is not in');
    }
  });
});

describe("the suites' side", () => {
  it("name the AI the runner gave them, in their title and on each request", () => {
    expect(resolveLiveAIName({ AI_LIVE_AI: " free " })).toBe("free");
    expect(requireLiveAIName({ AI_LIVE_AI: "free" })).toBe("free");
    expect(getLiveSuiteTitle("live-ai integration")).toBe("live-ai integration [ai=none]");
  });

  it("read no model name from AI_MODEL, and fail a suite run by hand without an AI", () => {
    expect(resolveLiveAIName({ AI_MODEL: "vendor/ignored", AI_LIVE_LABEL: "paid" })).toBeNull();
    expect(() => requireLiveAIName({ AI_MODEL: "vendor/ignored" })).toThrow(/has none/);
  });
});
