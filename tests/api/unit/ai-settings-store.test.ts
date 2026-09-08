// The AI settings store, over a real SQLite file.
//
// Three things are only true because this store makes them true, so they are
// asserted here rather than trusted: `env` rows belong to the filesystem and
// cannot be edited from the UI, a reseed removes a label the files stopped
// naming, and live narration is never left selected with nothing to call.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { openDatabase, type Db } from "../../../packages/game-engine/src/db/client.ts";
import {
  createAISettingsStore,
  EnvRowLockedError,
  InvalidLabelError,
} from "../../../packages/game-engine/src/db/ai-settings.ts";
import type { AISettingsStore } from "../../../packages/game-engine/src/context.ts";

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

/** Selects a working live configuration, so a test can then break it. */
function selectLive(): void {
  settings.putKey("mine", "sk-mine");
  settings.putModel("mine", "vendor/model");
  settings.updateSettings({
    ai_mode: "openrouter",
    ai_key_label: "mine",
    ai_model_label: "mine",
  });
}

describe("the settings row", () => {
  it("starts as mock with nothing selected", () => {
    expect(settings.getSettings()).toMatchObject({
      ai_mode: "mock",
      ai_key_label: null,
      ai_model_label: null,
    });
  });

  it("creates the row on first read rather than returning a phantom", () => {
    settings.getSettings();

    expect(db.prepare("select count(*) as n from app_settings").get()).toEqual({ n: 1 });
  });

  it("refuses live narration with nothing to call", () => {
    expect(() => settings.updateSettings({ ai_mode: "openrouter" })).toThrow(
      InvalidLabelError,
    );
    expect(settings.getSettings().ai_mode).toBe("mock");
  });

  it("refuses live narration with a key but no model", () => {
    settings.putKey("mine", "sk-mine");

    expect(() =>
      settings.updateSettings({ ai_mode: "openrouter", ai_key_label: "mine" }),
    ).toThrow(/model/i);
  });

  it("refuses a selection that names nothing", () => {
    expect(() => settings.updateSettings({ ai_key_label: "nope" })).toThrow(
      /No API key/,
    );
  });

  it("keeps the choice across a reopen", () => {
    selectLive();
    db.close();

    db = openDatabase({ path: path.join(tempDir, "game.db") });
    settings = createAISettingsStore(db);

    expect(settings.resolve()).toMatchObject({
      mode: "openrouter",
      stored_mode: "openrouter",
    });
  });
});

describe("keys and models", () => {
  it("stores and replaces a user key under a normalised label", () => {
    settings.putKey("  Work  ", "sk-one");
    settings.putKey("WORK", "sk-two");

    expect(settings.listKeys()).toHaveLength(1);
    expect(settings.getKey("work")).toMatchObject({
      label: "work",
      api_key: "sk-two",
      source: "user",
    });
  });

  it("rejects an empty label and an empty value", () => {
    expect(() => settings.putKey("   ", "sk")).toThrow(InvalidLabelError);
    expect(() => settings.putKey("work", "  ")).toThrow(InvalidLabelError);
  });

  it("deletes a user row and reports whether there was one", () => {
    settings.putModel("mine", "vendor/model");

    expect(settings.deleteModel("mine")).toBe(true);
    expect(settings.deleteModel("mine")).toBe(false);
  });
});

describe("rows the environment owns", () => {
  beforeEach(() => {
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });
  });

  it("marks them as env-sourced", () => {
    expect(settings.getKey("free")?.source).toBe("env");
    expect(settings.getModel("free")?.source).toBe("env");
  });

  it("refuses an edit that the next restart would silently undo", () => {
    expect(() => settings.putKey("free", "sk-mine")).toThrow(EnvRowLockedError);
    expect(() => settings.putModel("free", "vendor/other")).toThrow(EnvRowLockedError);
    expect(settings.getKey("free")?.api_key).toBe("sk-free");
  });

  it("refuses a delete that the next restart would undo", () => {
    expect(() => settings.deleteKey("free")).toThrow(EnvRowLockedError);
    expect(() => settings.deleteModel("free")).toThrow(EnvRowLockedError);
  });

  it("lets a user row of the same label win over the environment", () => {
    // Order matters: the user row is written first, then a reseed tries to
    // reclaim the label. What the player typed has to survive.
    settings.replaceEnvRows({ keys: [], models: [] });
    settings.putKey("free", "sk-typed");
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-from-file" }],
      models: [],
    });

    expect(settings.getKey("free")).toMatchObject({
      api_key: "sk-typed",
      source: "user",
    });
  });
});

describe("reseeding from the environment", () => {
  it("drops a label the files no longer name", () => {
    settings.replaceEnvRows({
      keys: [
        { label: "free", api_key: "sk-free" },
        { label: "paid", api_key: "sk-paid" },
      ],
      models: [{ label: "free", model_id: "vendor/free" }],
    });

    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [],
    });

    expect(settings.listKeys().map((key) => key.label)).toEqual(["free"]);
    expect(settings.listModels()).toEqual([]);
  });

  it("leaves user rows alone", () => {
    settings.putKey("mine", "sk-mine");
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [],
    });
    settings.replaceEnvRows({ keys: [], models: [] });

    expect(settings.listKeys().map((key) => key.label)).toEqual(["mine"]);
  });

  it("keeps a selection whose label survives the reseed", () => {
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });
    settings.updateSettings({
      ai_mode: "openrouter",
      ai_key_label: "free",
      ai_model_label: "free",
    });

    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-rotated" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });

    expect(settings.resolve()).toMatchObject({
      mode: "openrouter",
      key: expect.objectContaining({ api_key: "sk-rotated" }),
    });
  });
});

describe("resolving a selection that dangles", () => {
  it("falls back to mock and names what went missing", () => {
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });
    settings.updateSettings({
      ai_mode: "openrouter",
      ai_key_label: "free",
      ai_model_label: "free",
    });

    // The operator removed the key from the file and restarted.
    settings.replaceEnvRows({
      keys: [],
      models: [{ label: "free", model_id: "vendor/free" }],
    });

    expect(settings.resolve()).toMatchObject({
      mode: "mock",
      stored_mode: "openrouter",
      key: null,
      missing_key_label: "free",
      missing_model_label: null,
    });
  });

  it("stops reporting the missing label once mock is what was chosen", () => {
    // Under mock the dangling selection is causing nothing, so warning that
    // narration "fell back to mock" would be a warning about nothing — and one
    // the player could not clear without also clearing a selection they may
    // want back when the label returns.
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });
    settings.updateSettings({
      ai_mode: "openrouter",
      ai_key_label: "free",
      ai_model_label: "free",
    });
    settings.replaceEnvRows({ keys: [], models: [] });

    expect(settings.resolve().missing_key_label).toBe("free");

    settings.updateSettings({ ai_mode: "mock" });

    expect(settings.resolve()).toMatchObject({
      mode: "mock",
      missing_key_label: null,
      missing_model_label: null,
    });
    // The selection itself is kept, so the choice comes back with the label.
    expect(settings.getSettings().ai_key_label).toBe("free");
  });

  it("can still be repaired from the settings page", () => {
    // The lockout this guards: validating the *inherited* selection as well as
    // the one being set. With both labels gone, switching back to mock was
    // refused for naming a key that no longer existed — leaving the only screen
    // that can fix the problem unable to.
    settings.replaceEnvRows({
      keys: [{ label: "free", api_key: "sk-free" }],
      models: [{ label: "free", model_id: "vendor/free" }],
    });
    settings.updateSettings({
      ai_mode: "openrouter",
      ai_key_label: "free",
      ai_model_label: "free",
    });
    settings.replaceEnvRows({ keys: [], models: [] });

    expect(() => settings.updateSettings({ ai_mode: "mock" })).not.toThrow();
    expect(settings.getSettings().ai_mode).toBe("mock");
    expect(() => settings.updateSettings({ ai_key_label: null })).not.toThrow();
  });

  it("still refuses a fresh request for live narration it cannot serve", () => {
    // The other half: tolerating an inherited broken state must not tolerate a
    // new one. Asking for live with nothing to call is still rejected.
    settings.putKey("mine", "sk-mine");
    settings.replaceEnvRows({ keys: [], models: [] });

    expect(() =>
      settings.updateSettings({ ai_mode: "openrouter", ai_key_label: "mine" }),
    ).toThrow(/key and a model/i);
  });

  it("steps the stored mode back to mock when a deliberate delete breaks it", () => {
    selectLive();

    settings.deleteModel("mine");

    // Different from the reseed case above: the player did this on purpose, so
    // the stored row is corrected rather than left pointing at nothing.
    expect(settings.getSettings()).toMatchObject({
      ai_mode: "mock",
      ai_model_label: null,
    });
    expect(settings.resolve().mode).toBe("mock");
  });
});
