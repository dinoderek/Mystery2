// `ai.json` and the resolver over it: the file's schema, named AIs and their
// keys, and the order `default` follows — run override, stored choice, mock.
// That order is why the settings page carries an override banner, so it is
// asserted rather than assumed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AIConfigError,
  createLocalAIProfileStore,
  loadAIConfig,
  parseAIConfig,
  readAIConfig,
  resolveAIProfile,
  resolveNamedAI,
  type AIConfig,
} from "../../../packages/game-engine/src/ai-config.ts";
import { createLocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import type { AISettingsStore } from "../../../packages/game-engine/src/context.ts";
import { createAISettingsStore } from "../../../packages/game-engine/src/db/ai-settings.ts";
import { openDatabase, type Db } from "../../../packages/game-engine/src/db/client.ts";

/** The operator's file, exactly as the shape was agreed. */
const OPERATOR_FILE = {
  ais: {
    luna6: { backend: "openrouter", model: "openai/gpt-6-luna" },
    paid: { backend: "openrouter", model: "openai/gpt-5.6-luna" },
    free: { backend: "openrouter", model: "arcee-ai/trinity-large-preview:free" },
    claude: { backend: "claude-cli", model: "sonnet" },
  },
};

let root: string;
const openDatabases: Db[] = [];

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-ai-config-"));
});

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()!.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function writeConfig(value: unknown): void {
  fs.writeFileSync(path.join(root, "ai.json"), typeof value === "string" ? value : JSON.stringify(value));
}

function load(env: Record<string, string | undefined> = {}) {
  return loadAIConfig({ repoRoot: root, env });
}

/** A settings store holding `choice`, in a database of its own. */
function storedChoice(choice: string): AISettingsStore {
  const db = openDatabase({ path: path.join(root, `settings-${openDatabases.length}.db`) });
  openDatabases.push(db);
  const settings = createAISettingsStore(db);
  settings.setChoice(choice);
  return settings;
}

/** A settings store with nothing chosen. */
function nothingChosen(): AISettingsStore {
  const db = openDatabase({ path: path.join(root, `settings-${openDatabases.length}.db`) });
  openDatabases.push(db);
  return createAISettingsStore(db);
}

function rejection(value: unknown): string {
  try {
    parseAIConfig(value);
  } catch (error) {
    expect(error).toBeInstanceOf(AIConfigError);
    return (error as Error).message;
  }
  throw new Error("expected the configuration to be rejected");
}

describe("the ai.json schema", () => {
  it("accepts the operator's file as written", () => {
    expect(parseAIConfig(OPERATOR_FILE)).toEqual(OPERATOR_FILE);
  });

  it("accepts a key in clear on an openrouter entry", () => {
    const config = parseAIConfig({ ais: { free: { backend: "openrouter", model: "m", key: "sk-in-file" } } });
    expect(config.ais.free.key).toBe("sk-in-file");
  });

  it("rejects an unknown backend, naming the AI and the field", () => {
    expect(rejection({ ais: { free: { backend: "anthropic", model: "m" } } })).toMatch(
      /AI "free", field "backend" must be "openrouter" or "claude-cli", not "anthropic"/,
    );
  });

  it("rejects a missing or empty model, naming the AI and the field", () => {
    expect(rejection({ ais: { paid: { backend: "openrouter" } } })).toMatch(/AI "paid", field "model" is missing/);
    expect(rejection({ ais: { paid: { backend: "openrouter", model: " " } } })).toMatch(/AI "paid", field "model" is empty/);
  });

  it("rejects an entry named mock or default, which are built in", () => {
    expect(rejection({ ais: { mock: { backend: "claude-cli", model: "sonnet" } } })).toMatch(/AI "mock" is built in and cannot be an entry/);
    expect(rejection({ ais: { default: { backend: "claude-cli", model: "sonnet" } } })).toMatch(/AI "default" is built in/);
  });

  it("rejects a name that cannot be typed on a command line", () => {
    expect(rejection({ ais: { "my ai": { backend: "claude-cli", model: "sonnet" } } })).toMatch(/AI "my ai" has a name with characters/);
  });

  it("rejects a non-object ais, and a file without one", () => {
    expect(rejection({ ais: ["free"] })).toMatch(/field "ais" must be an object, not array/);
    expect(rejection({ ais: "free" })).toMatch(/field "ais" must be an object, not string/);
    expect(rejection({})).toMatch(/field "ais" is missing/);
  });

  it("rejects a mistyped field rather than ignoring it", () => {
    expect(rejection({ ais: { free: { backend: "openrouter", model: "m", keys: "sk" } } })).toMatch(
      /AI "free" has unknown field "keys"/,
    );
  });

  it("reports every problem at once", () => {
    const message = rejection({
      ais: { a: { backend: "x", model: "m" }, b: { backend: "openrouter" } },
    });
    expect(message).toMatch(/AI "a", field "backend"/);
    expect(message).toMatch(/AI "b", field "model"/);
  });
});

describe("reading ai.json", () => {
  it("treats a missing file as an empty configuration", () => {
    expect(readAIConfig(path.join(root, "ai.json"))).toEqual({ ais: {} });
  });

  it("rejects a file that is not JSON, naming it", () => {
    writeConfig("{ not json");
    expect(() => readAIConfig(path.join(root, "ai.json"))).toThrow(/ai\.json is not valid JSON/);
  });

  it("reads it from the config root", () => {
    const configRoot = fs.mkdtempSync(path.join(root, "config-"));
    fs.writeFileSync(path.join(configRoot, "ai.json"), JSON.stringify(OPERATOR_FILE));
    expect(loadAIConfig({ repoRoot: root, env: { MYSTERY_CONFIG_ROOT: configRoot } }).config).toEqual(OPERATOR_FILE);
  });
});

describe("resolving a named AI", () => {
  const config: AIConfig = parseAIConfig({
    ais: {
      own: { backend: "openrouter", model: "vendor/own", key: "sk-own" },
      shared: { backend: "openrouter", model: "vendor/shared" },
      claude: { backend: "claude-cli", model: "haiku" },
    },
  });

  it("returns mock for mock, with nothing configured", () => {
    expect(resolveNamedAI("mock", { ais: {} }, { env: {}, baseEnv: {} })).toEqual({
      id: "mock",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    });
  });

  it("returns an entry's backend and model", () => {
    expect(resolveNamedAI("claude", config, { env: {}, baseEnv: {} })).toEqual({
      id: "claude",
      provider: "claude-cli",
      model: "haiku",
      openrouter_api_key: null,
    });
  });

  it("takes the entry's key over OPENROUTER_API_KEY", () => {
    const sources = { env: { OPENROUTER_API_KEY: "sk-env" }, baseEnv: { OPENROUTER_API_KEY: "sk-file" } };
    expect(resolveNamedAI("own", config, sources)?.openrouter_api_key).toBe("sk-own");
  });

  it("takes OPENROUTER_API_KEY from the environment over .env.local", () => {
    const sources = { env: { OPENROUTER_API_KEY: "sk-env" }, baseEnv: { OPENROUTER_API_KEY: "sk-file" } };
    expect(resolveNamedAI("shared", config, sources)).toMatchObject({ model: "vendor/shared", openrouter_api_key: "sk-env" });
  });

  it("falls back to .env.local in the config root", () => {
    fs.writeFileSync(path.join(root, ".env.local"), "OPENROUTER_API_KEY=sk-file\n");
    writeConfig({ ais: { shared: { backend: "openrouter", model: "vendor/shared" } } });
    expect(resolveAIProfile("shared", load())?.openrouter_api_key).toBe("sk-file");
  });

  it("errors naming the AI when an openrouter entry has no key anywhere", () => {
    expect(() => resolveNamedAI("shared", config, { env: {}, baseEnv: {} })).toThrow(AIConfigError);
    expect(() => resolveNamedAI("shared", config, { env: {}, baseEnv: {} })).toThrow(/AI "shared" uses openrouter but has no key/);
  });

  it("returns not-found for a name the file does not have", () => {
    expect(resolveNamedAI("nope", config, { env: {}, baseEnv: {} })).toBeNull();
    // Not an inherited property either.
    expect(resolveNamedAI("toString", config, { env: {}, baseEnv: {} })).toBeNull();
  });
});

describe("how default resolves", () => {
  const STORED = { ais: { stored: { backend: "openrouter", model: "stored/model", key: "sk-stored" } } };

  it("follows the run override first, over a stored live choice", () => {
    writeConfig({ ais: { ...STORED.ais, claude: { backend: "claude-cli", model: "sonnet" } } });
    expect(resolveAIProfile("default", load({ AI_PROFILE: "claude" }), storedChoice("stored"))).toEqual({
      id: "default",
      provider: "claude-cli",
      model: "sonnet",
      openrouter_api_key: null,
    });
  });

  it("lets a run override force mock over a stored live choice", () => {
    writeConfig(STORED);
    expect(resolveAIProfile("default", load({ AI_PROFILE: "mock" }), storedChoice("stored"))?.provider).toBe("mock");
  });

  it("follows the stored choice, named in the file, when there is no run override", () => {
    writeConfig(STORED);
    expect(resolveAIProfile("default", load(), storedChoice("stored"))).toEqual({
      id: "default",
      provider: "openrouter",
      model: "stored/model",
      openrouter_api_key: "sk-stored",
    });
  });

  it("follows a stored choice of mock", () => {
    writeConfig(STORED);
    expect(resolveAIProfile("default", load(), storedChoice("mock"))).toMatchObject({ id: "default", provider: "mock" });
  });

  it("is mock when nothing is chosen", () => {
    expect(resolveAIProfile("default", load())).toMatchObject({ id: "default", provider: "mock" });
    expect(resolveAIProfile("default", load(), nothingChosen())).toMatchObject({ id: "default", provider: "mock" });
  });

  it("errors, naming the AI, rather than becoming mock when the stored choice has gone from the file", () => {
    writeConfig(OPERATOR_FILE);
    expect(() => resolveAIProfile("default", load(), storedChoice("stored"))).toThrow(AIConfigError);
    expect(() => resolveAIProfile("default", load(), storedChoice("stored"))).toThrow(
      /The AI chosen on the settings page, "stored", is not in ai\.json/,
    );
  });

  it("errors, naming the AI, rather than becoming mock when the stored choice has no key anywhere", () => {
    writeConfig(OPERATOR_FILE);
    expect(() => resolveAIProfile("default", load(), storedChoice("free"))).toThrow(/AI "free" uses openrouter but has no key/);
  });

  it("leaves a game that names its AI alone, whatever is stored", () => {
    writeConfig(OPERATOR_FILE);
    expect(resolveAIProfile("mock", load(), storedChoice("gone"))).toMatchObject({ id: "mock", provider: "mock" });
  });

  it("errors rather than becoming mock when the run override names a missing AI", () => {
    writeConfig(OPERATOR_FILE);
    expect(() => load({ AI_PROFILE: "luna7" })).toThrow(/AI_PROFILE names AI "luna7", which is not in ai\.json\. Name one of: mock, luna6, paid, free, claude/);
  });

  it("errors rather than becoming mock when the run override names a broken AI", () => {
    writeConfig(OPERATOR_FILE);
    expect(() => load({ AI_PROFILE: "free" })).toThrow(/AI "free" uses openrouter but has no key/);
    expect(() => load({ AI_PROFILE: "default" })).toThrow(/AI_PROFILE=default names no AI/);
  });

  it("is unchanged by AI_PROVIDER and AI_MODEL in the environment", () => {
    writeConfig(OPERATOR_FILE);
    fs.writeFileSync(path.join(root, ".env.local"), "AI_PROVIDER=openrouter\nAI_MODEL=vendor/file\n");
    const env = { AI_PROVIDER: "claude-cli", AI_MODEL: "opus", OPENROUTER_API_KEY: "sk-env" };
    const loaded = load(env);
    expect(loaded.runOverride).toBeNull();
    expect(resolveAIProfile("default", loaded)?.provider).toBe("mock");
    expect(resolveAIProfile("claude", loaded)?.model).toBe("sonnet");
  });
});

describe("the AIProfileStore adapter", () => {
  it("exposes resolution through the contract's async getById", async () => {
    writeConfig(OPERATOR_FILE);
    const store = createLocalAIProfileStore(load({ OPENROUTER_API_KEY: "sk-env" }));

    expect(await store.getById("mock")).toMatchObject({ provider: "mock" });
    expect(await store.getById("free")).toMatchObject({ provider: "openrouter", model: "arcee-ai/trinity-large-preview:free" });
    expect(await store.getById("no-such-ai")).toBeNull();
    expect(await store.getById("  ")).toBeNull();
  });
});

describe("opening the engine", () => {
  function open(env: Record<string, string> = {}) {
    return createLocalEngine({ repoRoot: root, env, databasePath: path.join(root, "db", "game.db") });
  }

  it("refuses a malformed ai.json, naming the AI and the field, before opening the database", () => {
    writeConfig({ ais: { free: { backend: "openrouter" } } });
    expect(() => open()).toThrow(/AI "free", field "model" is missing/);
    expect(fs.existsSync(path.join(root, "db"))).toBe(false);
  });

  it("refuses a run override naming an AI it cannot resolve", () => {
    expect(() => open({ AI_PROFILE: "free" })).toThrow(/AI_PROFILE names AI "free"/);
  });

  it("carries the run override for the settings banner", () => {
    writeConfig(OPERATOR_FILE);
    const engine = open({ AI_PROFILE: "claude" });
    try {
      expect(engine.aiConfig.runOverride).toEqual({
        name: "claude",
        profile: { id: "claude", provider: "claude-cli", model: "sonnet", openrouter_api_key: null },
      });
    } finally {
      engine.close();
    }
  });

  it("starts with no ai.json and no override, on mock", async () => {
    const engine = open();
    try {
      expect(engine.aiConfig.runOverride).toBeNull();
      expect(await engine.aiProfiles.getById("default")).toMatchObject({ provider: "mock" });
    } finally {
      engine.close();
    }
  });
});
