// Reading labelled keys and models off the filesystem.
//
// Pure path-and-parse work, so it runs against a temporary config root with no
// database and no server. What it pins down is the mapping from files to
// labels, including the two legacy files a machine already has.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readAISettingsEnv } from "../../../packages/game-engine/src/ai-settings-env.ts";

let configRoot: string;

/** The environment that points the reader at the temporary config root. */
function env(): Record<string, string> {
  return { MYSTERY_CONFIG_ROOT: configRoot };
}

function writeConfig(name: string, contents: string): void {
  fs.writeFileSync(path.join(configRoot, name), contents, "utf-8");
}

beforeEach(() => {
  configRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-ai-env-"));
});

afterEach(() => {
  fs.rmSync(configRoot, { recursive: true, force: true });
});

describe("a machine with no configuration", () => {
  it("reads nothing rather than failing", () => {
    expect(readAISettingsEnv(configRoot, env())).toEqual({ keys: [], models: [] });
  });
});

describe(".env.ai.local", () => {
  it("turns each suffix into a lowercased label", () => {
    writeConfig(
      ".env.ai.local",
      [
        "OPENROUTER_KEY_PERSONAL=sk-personal",
        "OPENROUTER_KEY_Work_Spare=sk-work",
        "AI_MODEL_SONNET=anthropic/claude-sonnet-4",
      ].join("\n"),
    );

    const result = readAISettingsEnv(configRoot, env());

    expect(result.keys).toEqual([
      { label: "personal", api_key: "sk-personal" },
      { label: "work_spare", api_key: "sk-work" },
    ]);
    expect(result.models).toEqual([
      { label: "sonnet", model_id: "anthropic/claude-sonnet-4" },
    ]);
  });

  it("skips a variable with no label and one with no value", () => {
    writeConfig(
      ".env.ai.local",
      ["OPENROUTER_KEY_=sk-orphan", "AI_MODEL_=vendor/model", "OPENROUTER_KEY_REAL="].join(
        "\n",
      ),
    );

    expect(readAISettingsEnv(configRoot, env())).toEqual({ keys: [], models: [] });
  });

  it("ignores a bare AI_MODEL, which names no label", () => {
    writeConfig(".env.ai.local", "AI_MODEL=vendor/model");

    expect(readAISettingsEnv(configRoot, env()).models).toEqual([]);
  });
});

describe("the files a machine already has", () => {
  it("seeds the base key as `default`", () => {
    writeConfig(".env.local", "OPENROUTER_API_KEY=sk-base");

    expect(readAISettingsEnv(configRoot, env()).keys).toEqual([
      { label: "default", api_key: "sk-base" },
    ]);
  });

  it("seeds each mode file as a key and a model under its own name", () => {
    writeConfig(
      ".env.ai.free.local",
      ["AI_PROVIDER=openrouter", "AI_MODEL=vendor/free", "OPENROUTER_API_KEY=sk-free"].join(
        "\n",
      ),
    );
    writeConfig(
      ".env.ai.paid.local",
      ["AI_PROVIDER=openrouter", "AI_MODEL=vendor/paid", "OPENROUTER_API_KEY=sk-paid"].join(
        "\n",
      ),
    );

    const result = readAISettingsEnv(configRoot, env());

    expect(result.keys).toEqual([
      { label: "free", api_key: "sk-free" },
      { label: "paid", api_key: "sk-paid" },
    ]);
    expect(result.models).toEqual([
      { label: "free", model_id: "vendor/free" },
      { label: "paid", model_id: "vendor/paid" },
    ]);
  });

  it("lets the dedicated file override a label a mode file also used", () => {
    writeConfig(".env.ai.free.local", "OPENROUTER_API_KEY=sk-from-mode");
    writeConfig(".env.ai.local", "OPENROUTER_KEY_FREE=sk-from-dedicated");

    expect(readAISettingsEnv(configRoot, env()).keys).toEqual([
      { label: "free", api_key: "sk-from-dedicated" },
    ]);
  });
});
