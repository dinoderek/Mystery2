// The stored AI choice, over a real SQLite file, and what the settings page
// makes of it.
//
// Choosing a live AI is asserted here rather than over the shared test server:
// the choice belongs to the installation, so a suite sharing a server with
// game-playing tests must never switch it to one
// (`tests/api/integration/ai-settings.test.ts` says why).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  AIChoiceError,
  chooseAI,
  describeAISettings,
  handleAIChoice,
} from "../../../packages/game-engine/src/ai-choice.ts";
import { loadAIConfig } from "../../../packages/game-engine/src/ai-config.ts";
import { createLocalEngine } from "../../../packages/game-engine/src/context-local.ts";
import type { AISettingsStore } from "../../../packages/game-engine/src/context.ts";
import { createAISettingsStore } from "../../../packages/game-engine/src/db/ai-settings.ts";
import { openDatabase, type Db } from "../../../packages/game-engine/src/db/client.ts";

const FILE = {
  ais: {
    luna6: { backend: "openrouter", model: "openai/gpt-6-luna", key: "sk-or-in-file-1234" },
    free: { backend: "openrouter", model: "vendor/free" },
    claude: { backend: "claude-cli", model: "sonnet" },
  },
};

let tempDir: string;
let db: Db;
let settings: AISettingsStore;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-ai-settings-"));
  db = openDatabase({ path: path.join(tempDir, "game.db") });
  settings = createAISettingsStore(db);
});

afterEach(() => {
  db.close();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function load(value: unknown = FILE, env: Record<string, string> = {}) {
  fs.writeFileSync(path.join(tempDir, "ai.json"), JSON.stringify(value));
  return loadAIConfig({ repoRoot: tempDir, env });
}

describe("the stored choice", () => {
  it("is empty on a fresh database", () => {
    expect(settings.getChoice()).toBeNull();
  });

  it("round-trips, and a second choice replaces the first", () => {
    settings.setChoice("luna6");
    expect(settings.getChoice()).toBe("luna6");

    settings.setChoice("mock");
    expect(settings.getChoice()).toBe("mock");
    expect(db.prepare("select count(*) as n from app_settings").get()).toEqual({ n: 1 });
  });

  it("survives a reopen", () => {
    settings.setChoice("claude");
    db.close();
    db = openDatabase({ path: path.join(tempDir, "game.db") });

    expect(createAISettingsStore(db).getChoice()).toBe("claude");
  });

  it("is not seeded when the engine opens, whatever env files the config root holds", () => {
    // The files the settings tables used to be seeded from.
    fs.writeFileSync(path.join(tempDir, ".env.local"), "OPENROUTER_API_KEY=sk-or-base\n");
    fs.writeFileSync(path.join(tempDir, ".env.ai.free.local"), "OPENROUTER_API_KEY=sk-or-free\nAI_MODEL=vendor/free\n");
    fs.writeFileSync(path.join(tempDir, ".env.ai.local"), "OPENROUTER_KEY_WORK=sk-or-work\nAI_MODEL_WORK=vendor/work\n");
    const databasePath = path.join(tempDir, "engine", "game.db");

    const engine = createLocalEngine({ repoRoot: tempDir, env: {}, databasePath });
    try {
      expect(engine.aiSettings.getChoice()).toBeNull();
      const tables = engine.db
        .prepare("select name from sqlite_master where type = 'table' order by name")
        .all()
        .map((row) => row.name);
      expect(tables).toEqual(["app_settings", "game_events", "game_sessions", "players"]);
      expect(engine.db.prepare("select count(*) as n from app_settings").get()).toEqual({ n: 0 });
    } finally {
      engine.close();
    }
  });
});

describe("what the settings page shows", () => {
  it("lists mock and the file's AIs with backend and model, and no key", () => {
    const state = describeAISettings(load(), settings);

    expect(state.ais.map(({ name, backend, model }) => [name, backend, model])).toEqual([
      ["mock", "mock", "mock/runtime-default"],
      ["luna6", "openrouter", "openai/gpt-6-luna"],
      ["free", "openrouter", "vendor/free"],
      ["claude", "claude-cli", "sonnet"],
    ]);
    expect(JSON.stringify(state)).not.toContain("sk-or-in-file");
  });

  it("says which AI lacks what it needs, naming it", () => {
    const state = describeAISettings(load(), settings);

    expect(state.ais.find((ai) => ai.name === "free")?.problem).toMatch(/AI "free" uses openrouter but has no key/);
    expect(state.ais.filter((ai) => ai.problem === null).map((ai) => ai.name)).toEqual(["mock", "luna6", "claude"]);
  });

  it("names mock as the narrator while nothing is chosen", () => {
    expect(describeAISettings(load(), settings)).toMatchObject({
      chosen: null,
      override: null,
      narrator: { name: "mock", backend: "mock" },
      narrator_error: null,
    });
  });

  it("names the chosen AI as the narrator", () => {
    settings.setChoice("luna6");

    expect(describeAISettings(load(), settings)).toMatchObject({
      chosen: "luna6",
      narrator: { name: "luna6", backend: "openrouter", model: "openai/gpt-6-luna" },
    });
  });

  it("names the run override as the narrator, and carries it for the banner", () => {
    settings.setChoice("luna6");

    expect(describeAISettings(load(FILE, { AI_PROFILE: "claude" }), settings)).toMatchObject({
      chosen: "luna6",
      override: { name: "claude", backend: "claude-cli", model: "sonnet" },
      narrator: { name: "claude", backend: "claude-cli" },
    });
  });

  it("says nothing narrates, naming the AI, when the choice has gone from the file", () => {
    settings.setChoice("luna6");

    const state = describeAISettings(load({ ais: {} }), settings);

    expect(state.narrator).toBeNull();
    expect(state.narrator_error).toMatch(/"luna6", is not in ai\.json/);
  });

  it("says nothing narrates, naming the AI, when the chosen AI has lost its key", () => {
    settings.setChoice("luna6");

    const state = describeAISettings(load({ ais: { luna6: { backend: "openrouter", model: "m" } } }), settings);

    expect(state.narrator).toBeNull();
    expect(state.narrator_error).toMatch(/AI "luna6" uses openrouter but has no key/);
  });
});

describe("choosing", () => {
  it("stores mock or an AI of the file that has what it needs", () => {
    const loaded = load();

    chooseAI(loaded, settings, "luna6");
    expect(settings.getChoice()).toBe("luna6");
    chooseAI(loaded, settings, "claude");
    expect(settings.getChoice()).toBe("claude");
    chooseAI(loaded, settings, "mock");
    expect(settings.getChoice()).toBe("mock");
  });

  it("refuses a name that is not in the file, listing the ones that are", () => {
    settings.setChoice("mock");

    expect(() => chooseAI(load(), settings, "gone")).toThrow(AIChoiceError);
    expect(() => chooseAI(load(), settings, "gone")).toThrow(/no AI named "gone".*mock, luna6, free, claude/);
    expect(() => chooseAI(load(), settings, "default")).toThrow(AIChoiceError);
    expect(settings.getChoice()).toBe("mock");
  });

  it("refuses an AI that lacks what it needs, saying what", () => {
    expect(() => chooseAI(load(), settings, "free")).toThrow(/AI "free" uses openrouter but has no key/);
    expect(settings.getChoice()).toBeNull();
  });

  it("takes an AI whose key comes from the environment", () => {
    chooseAI(load(FILE, { OPENROUTER_API_KEY: "sk-or-env" }), settings, "free");
    expect(settings.getChoice()).toBe("free");
  });
});

describe("POST /api/ai-settings", () => {
  function post(body: unknown): Request {
    return new Request("http://test/api/ai-settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  it("stores the name and answers with the state the page shows", async () => {
    const response = await handleAIChoice(post({ name: " luna6 " }), load(), settings);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ chosen: "luna6", narrator: { name: "luna6" } });
    expect(settings.getChoice()).toBe("luna6");
  });

  it("answers 400 naming the field for a body without a name", async () => {
    for (const body of [{}, { name: "" }, "not json"]) {
      const response = await handleAIChoice(post(body), load(), settings);
      expect(response.status).toBe(400);
    }
    const missing = await handleAIChoice(post({}), load(), settings);
    expect(await missing.json()).toMatchObject({ details: { field: "name" } });
    expect(settings.getChoice()).toBeNull();
  });

  it("answers 400 saying why for a name it cannot choose", async () => {
    const unknown = await handleAIChoice(post({ name: "gone" }), load(), settings);
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toMatch(/no AI named "gone"/);

    const keyless = await handleAIChoice(post({ name: "free" }), load(), settings);
    expect(keyless.status).toBe(400);
    expect((await keyless.json()).error).toMatch(/AI "free" uses openrouter but has no key/);
    expect(settings.getChoice()).toBeNull();
  });
});
