// AI profiles resolved from the environment instead of the `ai_profiles` table.
//
// The table's only real content was an OpenRouter key that the engine read
// back with a service-role client on every turn. These tests pin the
// replacement to the same three labels and the same env files `npm run seed:ai`
// reads, so `dev:ai:free` and `dev:ai:paid` keep meaning what they meant.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createLocalAIProfileStore,
  resolveAIProfile,
} from "../../../packages/game-engine/src/ai-profile.ts";

let repoRoot: string;

beforeEach(() => {
  repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-engine-ai-"));
});

afterEach(() => {
  fs.rmSync(repoRoot, { recursive: true, force: true });
});

function writeEnv(filename: string, lines: string[]) {
  fs.writeFileSync(path.join(repoRoot, filename), `${lines.join("\n")}\n`);
}

function resolve(id: string, env: Record<string, string | undefined> = {}) {
  return resolveAIProfile(id, { repoRoot, env });
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
  it("is mock when the process is not configured for a model", () => {
    expect(resolve("default")).toEqual({
      id: "default",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    });
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

  it("keeps the label 'default' so the session row still records provenance", () => {
    expect(
      resolve("default", { AI_PROVIDER: "mock", AI_MODEL: "mock/runtime-default" })?.id,
    ).toBe("default");
  });
});

describe("the AIProfileStore adapter", () => {
  it("exposes resolution through the contract's async getById", async () => {
    const store = createLocalAIProfileStore({ repoRoot, env: {} });

    expect(await store.getById("mock")).toMatchObject({ provider: "mock" });
    expect(await store.getById("free")).toBeNull();
  });
});
