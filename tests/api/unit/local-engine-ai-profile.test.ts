// AI profiles resolved from the environment and the settings database.
//
// These pin the four labels and the files behind them, which is what makes
// `npm run dev:ai:free` and `dev:ai:paid` mean something specific — and, for
// `default`, the order the three sources are consulted in. That order is the
// whole reason the settings page carries an override banner, so it is asserted
// rather than assumed.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalAIProfileStore,
  readDefaultAIOverride,
  resolveAIProfile,
} from "../../../packages/game-engine/src/ai-profile.ts";
import { createAISettingsStore } from "../../../packages/game-engine/src/db/ai-settings.ts";
import { openDatabase, type Db } from "../../../packages/game-engine/src/db/client.ts";
import type { AISettingsStore } from "../../../packages/game-engine/src/context.ts";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-ai-"));
});

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()!.close();
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeEnv(filename: string, lines: string[]) {
  fs.writeFileSync(path.join(repoRoot, filename), `${lines.join("\n")}\n`);
}

function resolve(
  id: string,
  env: Record<string, string | undefined> = {},
  settings?: AISettingsStore,
) {
  return resolveAIProfile(id, { repoRoot, env, settings });
}

/**
 * A settings store holding a working live choice, in a database of its own.
 *
 * Closing is left to the caller's `afterEach` via `openDatabases`, because a
 * test that throws still has to release the file.
 */
const openDatabases: Db[] = [];

function liveSettings(model = "stored/model", key = "sk-stored"): AISettingsStore {
  const db = openDatabase({ path: path.join(repoRoot, "settings.db") });
  openDatabases.push(db);

  const settings = createAISettingsStore(db);
  settings.putKey("stored", key);
  settings.putModel("stored", model);
  settings.updateSettings({
    ai_mode: "openrouter",
    ai_key_label: "stored",
    ai_model_label: "stored",
  });

  return settings;
}

describe("named profiles", () => {
  it("resolves mock without reading anything", () => {
    expect(resolve("mock")).toEqual({
      id: "mock",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    });
  });

  it("resolves free and paid from their env files", () => {
    writeEnv(".env.ai.free.local", [
      "AI_PROVIDER=openrouter",
      "AI_MODEL=some/free-model:free",
      "OPENROUTER_API_KEY=sk-free",
    ]);
    writeEnv(".env.ai.paid.local", [
      "AI_PROVIDER=openrouter",
      "AI_MODEL=some/paid-model",
      "OPENROUTER_API_KEY=sk-paid",
    ]);

    expect(resolve("free")).toEqual({
      id: "free",
      provider: "openrouter",
      model: "some/free-model:free",
      openrouter_api_key: "sk-free",
    });
    expect(resolve("paid")?.model).toBe("some/paid-model");
  });

  it("falls back to the key in .env.local", () => {
    writeEnv(".env.local", ["OPENROUTER_API_KEY=sk-shared"]);
    writeEnv(".env.ai.free.local", [
      "AI_PROVIDER=openrouter",
      "AI_MODEL=some/free-model:free",
    ]);

    expect(resolve("free")?.openrouter_api_key).toBe("sk-shared");
  });

  it("returns null when the profile is not configured on this machine", () => {
    expect(resolve("free")).toBeNull();
    expect(resolve("paid")).toBeNull();
  });

  it("returns null for an unknown or empty id", () => {
    expect(resolve("nonsense")).toBeNull();
    expect(resolve("   ")).toBeNull();
  });
});

describe("misconfiguration", () => {
  it("throws rather than silently degrading", () => {
    writeEnv(".env.ai.free.local", ["AI_PROVIDER=anthropic", "AI_MODEL=x"]);
    expect(() => resolve("free")).toThrow(/Invalid AI_PROVIDER/);

    writeEnv(".env.ai.free.local", ["AI_PROVIDER=openrouter"]);
    expect(() => resolve("free")).toThrow(/Missing AI_MODEL/);

    writeEnv(".env.ai.free.local", [
      "AI_PROVIDER=openrouter",
      "AI_MODEL=some/model",
    ]);
    expect(() => resolve("free")).toThrow(/Missing OPENROUTER_API_KEY/);
  });
});

describe("the default profile", () => {
  it("is mock when nothing is configured at all", () => {
    expect(resolve("default")).toEqual({
      id: "default",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    });
  });

  it("is mock when there is a settings store with nothing chosen", () => {
    // How the mock test server runs: a temporary config root with no env files
    // and a database nobody has touched. Mock by absence, still.
    const db = openDatabase({ path: path.join(repoRoot, "empty.db") });
    openDatabases.push(db);

    expect(resolve("default", {}, createAISettingsStore(db))?.provider).toBe("mock");
  });

  it("follows the running process, which is what dev:ai:free sets", () => {
    // `npm run dev:ai:free` loads .env.ai.free.local into the process it
    // starts — no seeding step, no restart, no database round-trip.
    expect(
      resolve("default", {
        AI_PROVIDER: "openrouter",
        AI_MODEL: "some/free-model:free",
        OPENROUTER_API_KEY: "sk-free",
      }),
    ).toEqual({
      id: "default",
      provider: "openrouter",
      model: "some/free-model:free",
      openrouter_api_key: "sk-free",
    });
  });

  it("follows the stored choice when the process names none", () => {
    expect(resolve("default", {}, liveSettings())).toEqual({
      id: "default",
      provider: "openrouter",
      model: "stored/model",
      openrouter_api_key: "sk-stored",
    });
  });

  it("lets the process outrank the stored choice", () => {
    // The precedence the settings page warns about: a server started with an
    // override ignores what was chosen on the page.
    expect(
      resolve(
        "default",
        {
          AI_PROVIDER: "openrouter",
          AI_MODEL: "process/model",
          OPENROUTER_API_KEY: "sk-process",
        },
        liveSettings(),
      ),
    ).toMatchObject({ model: "process/model", openrouter_api_key: "sk-process" });
  });

  it("lets a process override force mock over a stored live choice", () => {
    expect(
      resolve(
        "default",
        { AI_PROVIDER: "mock", AI_MODEL: "mock/runtime-default" },
        liveSettings(),
      ),
    ).toMatchObject({ provider: "mock" });
  });

  it("still throws on a broken process override rather than falling back", () => {
    // A typo in an explicit override must not quietly become the stored choice,
    // or the operator would never find out the flag did nothing.
    expect(() =>
      resolve("default", { AI_PROVIDER: "openrouter", AI_MODEL: "x" }, liveSettings()),
    ).toThrow(/Missing OPENROUTER_API_KEY/);
  });

  it("is mock when the stored choice names a label that has gone", () => {
    const settings = liveSettings();
    settings.replaceEnvRows({ keys: [], models: [] });
    // Remove the user rows the selection points at.
    settings.deleteKey("stored");

    expect(resolve("default", {}, settings)?.provider).toBe("mock");
  });

  it("keeps the label 'default' so the session row still records provenance", () => {
    expect(
      resolve("default", { AI_PROVIDER: "mock", AI_MODEL: "mock/runtime-default" })?.id,
    ).toBe("default");
  });
});

// The banner on the settings page and the branch above read the same helper, so
// that the page can never claim the stored choice is in effect while it is not.
describe("readDefaultAIOverride", () => {
  it("reports nothing when the process names no configuration", () => {
    expect(readDefaultAIOverride({ repoRoot, env: {} })).toBeNull();
  });

  it("reports the provider and model the process forces", () => {
    expect(
      readDefaultAIOverride({
        repoRoot,
        env: { AI_PROVIDER: "openrouter", AI_MODEL: "process/model" },
      }),
    ).toEqual({ provider: "openrouter", model: "process/model" });
  });

  it("does not treat a bare API key as an override", () => {
    // A machine can keep a key in .env.local and still want the settings page
    // to decide. Only the two variables that select a configuration count.
    writeEnv(".env.local", ["OPENROUTER_API_KEY=sk-shared"]);

    expect(readDefaultAIOverride({ repoRoot, env: {} })).toBeNull();
  });

  it("reads through .env.local, the same layering the resolver uses", () => {
    writeEnv(".env.local", ["AI_PROVIDER=openrouter", "AI_MODEL=file/model"]);

    expect(readDefaultAIOverride({ repoRoot, env: {} })).toEqual({
      provider: "openrouter",
      model: "file/model",
    });
  });

  it("reports nothing for a half-specified override, which the resolver rejects", () => {
    expect(readDefaultAIOverride({ repoRoot, env: { AI_PROVIDER: "openrouter" } })).toBeNull();
  });
});

describe("the AIProfileStore adapter", () => {
  it("exposes resolution through the contract's async getById", async () => {
    const store = createLocalAIProfileStore({ repoRoot, env: {} });

    expect(await store.getById("mock")).toMatchObject({ provider: "mock" });
    expect(await store.getById("free")).toBeNull();
  });
});
