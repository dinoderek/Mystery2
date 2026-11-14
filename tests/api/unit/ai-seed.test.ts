// What a harness that starts a server of its own writes as that server's
// `ai.json`: exactly the AIs it was asked for, read from the config root it is
// pointed at, checked before any server starts.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AIConfigError, readAIConfig } from "../../../packages/game-engine/src/ai-config.ts";
import { pickAIs, seedAIs, writeAIConfig } from "../../../scripts/lib/ai-seed.mjs";

let root = "";
let target = "";

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "ai-seed-source-"));
  target = fs.mkdtempSync(path.join(os.tmpdir(), "ai-seed-target-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(target, { recursive: true, force: true });
});

const env = () => ({ MYSTERY_CONFIG_ROOT: root });

function writeFile(name: string, text: string): void {
  fs.writeFileSync(path.join(root, name), text);
}

function writeAIs(ais: unknown): void {
  writeFile("ai.json", JSON.stringify({ ais }));
}

const FILE = {
  free: { backend: "openrouter", model: "vendor/free", key: "sk-in-file" },
  paid: { backend: "openrouter", model: "vendor/paid" },
  claude: { backend: "claude-cli", model: "sonnet" },
};

describe("pickAIs", () => {
  it("returns exactly the named entries, each OpenRouter one with the key it will use", () => {
    writeAIs(FILE);
    expect(pickAIs({ repoRoot: root, env: { ...env(), OPENROUTER_API_KEY: "sk-env" }, names: ["free", "paid", "claude"] })).toEqual({
      ais: {
        free: { backend: "openrouter", model: "vendor/free", key: "sk-in-file" },
        paid: { backend: "openrouter", model: "vendor/paid", key: "sk-env" },
        claude: { backend: "claude-cli", model: "sonnet" },
      },
    });
    expect(Object.keys(pickAIs({ repoRoot: root, env: env(), names: ["claude"] }).ais)).toEqual(["claude"]);
  });

  it("takes a key an entry lacks from .env.local when the environment has none", () => {
    writeAIs(FILE);
    writeFile(".env.local", "OPENROUTER_API_KEY=sk-base\n");
    expect(pickAIs({ repoRoot: root, env: env(), names: ["paid"] }).ais.paid.key).toBe("sk-base");
  });

  it("skips mock and default, which need no entry", () => {
    expect(pickAIs({ repoRoot: root, env: env(), names: ["mock", "default"] })).toEqual({ ais: {} });
  });

  it("reads nothing from the config root when only mock or default is named", () => {
    writeFile("ai.json", "{ not json");
    writeFile(".env.local", "OPENROUTER_API_KEY=sk-base\n");
    expect(pickAIs({ repoRoot: root, env: env(), names: ["mock", "default"] })).toEqual({ ais: {} });
    expect(pickAIs({ repoRoot: root, env: env(), names: [] })).toEqual({ ais: {} });
    expect(seedAIs({ repoRoot: root, env: env(), names: ["mock"] })).toBeUndefined();
    expect(() => pickAIs({ repoRoot: root, env: env(), names: ["free"] })).toThrow(/not valid JSON/);
  });

  it("names an AI the file does not have, and the file it looked in", () => {
    writeAIs(FILE);
    const ask = () => pickAIs({ repoRoot: root, env: env(), names: ["luna"] });
    expect(ask).toThrow(AIConfigError);
    expect(ask).toThrow(/AI "luna" is not in .*ai\.json. Name one of: mock, free, paid, claude/);
  });

  it("names an OpenRouter AI with no key anywhere", () => {
    writeAIs(FILE);
    expect(() => pickAIs({ repoRoot: root, env: env(), names: ["paid"] })).toThrow(/AI "paid" uses openrouter but has no key/);
  });

  it("never reads the .env.ai.* files", () => {
    writeAIs(FILE);
    writeFile(".env.ai.paid.local", "AI_PROVIDER=openrouter\nAI_MODEL=vendor/other\nOPENROUTER_API_KEY=sk-mode-file\n");
    writeFile(".env.ai.local", "OPENROUTER_KEY_PAID=sk-labelled\nAI_MODEL_PAID=vendor/labelled\n");
    expect(() => pickAIs({ repoRoot: root, env: { ...env(), AI_MODEL: "vendor/env" }, names: ["paid"] })).toThrow(/has no key/);
  });

  it("leaves a run override exported in the shell to the server it would reach", () => {
    writeAIs(FILE);
    expect(() => pickAIs({ repoRoot: root, env: { ...env(), AI_PROFILE: "no-such-ai" }, names: ["claude"] })).not.toThrow();
  });

  it("fails on a malformed ai.json, naming the AI and the field", () => {
    writeAIs({ free: { backend: "openrouter" } });
    expect(() => pickAIs({ repoRoot: root, env: env(), names: ["free"] })).toThrow(/AI "free", field "model" is missing/);
  });
});

describe("writeAIConfig", () => {
  it("writes a file the server's own reader accepts, readable by its owner only", () => {
    const config = { ais: { free: { backend: "openrouter", model: "vendor/free", key: "sk-test" } } };
    writeAIConfig(target, config);
    expect(readAIConfig(path.join(target, "ai.json"))).toEqual(config);
    if (process.platform !== "win32") expect(fs.statSync(path.join(target, "ai.json")).mode & 0o077).toBe(0);
  });

  it("refuses a configuration the schema refuses, writing nothing", () => {
    expect(() => writeAIConfig(target, { ais: { mock: { backend: "claude-cli", model: "x" } } })).toThrow(AIConfigError);
    expect(() => writeAIConfig(target, { ais: { x: { backend: "gemini", model: "x" } } })).toThrow(/"backend" must be/);
    expect(fs.existsSync(path.join(target, "ai.json"))).toBe(false);
  });
});

describe("seedAIs", () => {
  it("writes the temporary root's ai.json with the requested entry and no other", () => {
    writeAIs(FILE);
    const seed = seedAIs({ repoRoot: root, env: env(), names: ["free"] });
    seed?.(target);
    expect(readAIConfig(path.join(target, "ai.json"))).toEqual({
      ais: { free: { backend: "openrouter", model: "vendor/free", key: "sk-in-file" } },
    });
  });

  it("writes nothing for mock, which a root without ai.json already has", () => {
    writeAIs(FILE);
    expect(seedAIs({ repoRoot: root, env: env(), names: ["mock"] })).toBeUndefined();
    expect(seedAIs({ repoRoot: root, env: env(), names: [] })).toBeUndefined();
  });

  it("fails when called, before it is given a root to write, for a missing name or key", () => {
    writeAIs(FILE);
    expect(() => seedAIs({ repoRoot: root, env: env(), names: ["luna"] })).toThrow(/AI "luna"/);
    expect(() => seedAIs({ repoRoot: root, env: env(), names: ["paid"] })).toThrow(/AI "paid"/);
    expect(fs.readdirSync(target)).toEqual([]);
  });
});
