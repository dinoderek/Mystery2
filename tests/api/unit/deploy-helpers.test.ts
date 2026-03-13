import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertRequiredDeployEnvVars,
  buildDefaultAIProfileConfig,
  buildCommandPlan,
  DEPLOY_ENVIRONMENTS,
  discoverEdgeFunctions,
  formatPlanLine,
  loadBootstrapUsers,
  parseDeployArgs,
  shouldBootstrapUsers,
  shouldSeedBlueprints,
  validateTargetsShape,
} from "../../../scripts/deploy-helpers.mjs";

interface CommandStep {
  id: string;
  title: string;
  command: string[];
}

function makeTarget(envName: string) {
  return {
    pagesProjectName: `mystery-${envName}`,
    pagesBranch: envName,
    supabaseProjectRef: `${envName}-ref`,
    expectedFrontendUrl: `https://${envName}.example.com`,
    expectedSupabaseUrl: `https://${envName}-ref.supabase.co`,
  };
}

function makeRequiredEnv() {
  return {
    CLOUDFLARE_API_TOKEN: "token",
    CLOUDFLARE_ACCOUNT_ID: "account",
    SUPABASE_ACCESS_TOKEN: "supabase-access-token",
    SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
    AI_DEFAULT_PROFILE_ID: "default",
    AI_DEFAULT_PROFILE_PROVIDER: "mock",
    AI_DEFAULT_PROFILE_MODEL: "mock/runtime-default",
    VITE_SUPABASE_URL: "https://dev-ref.supabase.co",
    VITE_SUPABASE_ANON_KEY: "anon-key",
  };
}

describe("parseDeployArgs", () => {
  it("parses all supported options", () => {
    const parsed = parseDeployArgs([
      "--env",
      "dev",
      "--preflight",
      "--dry-run",
      "--skip-users",
      "--skip-seed",
    ]);

    expect(parsed).toEqual({
      env: "dev",
      preflight: true,
      dryRun: true,
      skipUsers: true,
      skipSeed: true,
      imageDir: null,
      allowMissingImages: true,
    });
  });

  it("supports equals env syntax", () => {
    const parsed = parseDeployArgs(["--env=prod"]);
    expect(parsed.env).toBe("prod");
    expect(parsed.imageDir).toBeNull();
  });

  it("parses image deploy flags", () => {
    const parsed = parseDeployArgs([
      "--env",
      "dev",
      "--image-dir",
      "generated/blueprint-images",
      "--strict-images",
    ]);

    expect(parsed).toMatchObject({
      env: "dev",
      imageDir: "generated/blueprint-images",
      allowMissingImages: false,
    });
  });

  it("rejects missing env", () => {
    expect(() => parseDeployArgs(["--dry-run"])).toThrow(
      "Missing required --env",
    );
  });

  it("rejects invalid env", () => {
    expect(() => parseDeployArgs(["--env", "qa"])).toThrow("Invalid --env value");
  });

  it("rejects unknown flags", () => {
    expect(() => parseDeployArgs(["--env", "dev", "--nope"])).toThrow(
      "Unknown argument",
    );
  });
});

describe("target and env validation", () => {
  it("accepts complete target mappings", () => {
    const targets = {
      dev: makeTarget("dev"),
      staging: makeTarget("staging"),
      prod: makeTarget("prod"),
    };

    expect(() => validateTargetsShape(targets)).not.toThrow();
  });

  it("fails when target env mapping is missing", () => {
    const targets = {
      dev: makeTarget("dev"),
      staging: makeTarget("staging"),
    };

    expect(() => validateTargetsShape(targets as Record<string, unknown>)).toThrow(
      "Missing target mapping for environment: prod",
    );
  });

  it("fails when required deploy vars are missing", () => {
    const env = { ...makeRequiredEnv(), AI_DEFAULT_PROFILE_MODEL: "" };

    expect(() => assertRequiredDeployEnvVars(env as Record<string, string>)).toThrow(
      "Missing required deploy environment variables",
    );
  });
});

describe("default ai profile config", () => {
  it("builds mock profile config", () => {
    const profile = buildDefaultAIProfileConfig(makeRequiredEnv());
    expect(profile).toEqual({
      id: "default",
      provider: "mock",
      model: "mock/runtime-default",
      openrouter_api_key: null,
    });
  });

  it("requires openrouter key for openrouter provider", () => {
    const env = {
      ...makeRequiredEnv(),
      AI_DEFAULT_PROFILE_PROVIDER: "openrouter",
      AI_DEFAULT_PROFILE_MODEL: "google/gemini-3-flash-preview",
    };
    expect(() => buildDefaultAIProfileConfig(env)).toThrow(
      "AI_DEFAULT_PROFILE_OPENROUTER_API_KEY",
    );
  });
});

describe("discoverEdgeFunctions", () => {
  it("finds function directories and excludes _shared", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-fns-"));
    await mkdir(path.join(tmpDir, "_shared"));
    await mkdir(path.join(tmpDir, "game-start"));
    await mkdir(path.join(tmpDir, "blueprints-list"));
    await writeFile(path.join(tmpDir, "README.md"), "ignore me", "utf-8");

    const functions = await discoverEdgeFunctions(tmpDir);
    expect(functions).toEqual(["blueprints-list", "game-start"]);
  });
});

describe("bootstrap and seed skip logic", () => {
  it("bootstraps users only in non-prod when enabled", () => {
    expect(shouldBootstrapUsers("dev", false)).toBe(true);
    expect(shouldBootstrapUsers("staging", false)).toBe(true);
    expect(shouldBootstrapUsers("prod", false)).toBe(false);
    expect(shouldBootstrapUsers("dev", true)).toBe(false);
  });

  it("seeds storage unless skipped", () => {
    expect(shouldSeedBlueprints(false)).toBe(true);
    expect(shouldSeedBlueprints(true)).toBe(false);
  });
});

describe("loadBootstrapUsers", () => {
  it("loads object-based users file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-users-"));
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.json");

    await writeFile(
      usersPath,
      JSON.stringify({ users: [{ email: "a@test.local", password: "secret1" }] }),
      "utf-8",
    );

    const users = await loadBootstrapUsers(usersPath);
    expect(users).toEqual([{ email: "a@test.local", password: "secret1" }]);
  });

  it("fails for invalid user shape", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-users-invalid-"));
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.json");

    await writeFile(usersPath, JSON.stringify({ users: [{ email: "", password: "123" }] }), "utf-8");

    await expect(loadBootstrapUsers(usersPath)).rejects.toThrow("Invalid bootstrap user");
  });
});

describe("buildCommandPlan", () => {
  it("builds exact dry-run command plan per environment", () => {
    const functionNames = ["blueprints-list", "game-start"];

    for (const envName of DEPLOY_ENVIRONMENTS) {
      const includeUsers = envName !== "prod";

      const steps = buildCommandPlan({
        envName,
        target: makeTarget(envName),
        functionNames,
        includePreflight: true,
        includeSeed: true,
        includeUsers,
        imageDir: null,
        allowMissingImages: true,
        hasDbPassword: false,
      }) as CommandStep[];

      expect(steps.map((step) => step.id)).toEqual([
        "preflight:lint",
        "preflight:typecheck",
        "preflight:test-unit",
        "frontend:build",
        "frontend:pages-deploy",
        "backend:link",
        "backend:db-push",
        "backend:configure-default-ai-profile",
        "backend:function:blueprints-list",
        "backend:function:game-start",
        "backend:seed-storage",
        ...(includeUsers ? [`backend:bootstrap-users:${envName}`] : []),
        "verify:smoke",
      ]);

      const pagesStep = steps.find((step) => step.id === "frontend:pages-deploy");
      expect(pagesStep?.command).toEqual([
        pagesStep?.command[0],
        "wrangler",
        "pages",
        "deploy",
        "web/build",
        "--project-name",
        `mystery-${envName}`,
        "--branch",
        envName,
      ]);

      const lines = steps.map((step) => formatPlanLine(step));
      expect(lines[0]).toContain("preflight:lint");
      expect(lines.at(-1)).toContain("verify:smoke");
    }
  });

  it("omits optional steps when skip flags are enabled", () => {
    const steps = buildCommandPlan({
      envName: "dev",
      target: makeTarget("dev"),
      functionNames: ["blueprints-list"],
      includePreflight: false,
      includeSeed: false,
      includeUsers: false,
      imageDir: null,
      allowMissingImages: true,
      hasDbPassword: false,
    }) as CommandStep[];

    expect(steps.map((step) => step.id)).not.toContain("preflight:lint");
    expect(steps.map((step) => step.id)).not.toContain("backend:seed-storage");
    expect(steps.some((step) => step.id.startsWith("backend:bootstrap-users"))).toBe(
      false,
    );
  });

  it("adds image sync flags to seed step when image dir is provided", () => {
    const steps = buildCommandPlan({
      envName: "dev",
      target: makeTarget("dev"),
      functionNames: ["blueprints-list"],
      includePreflight: false,
      includeSeed: true,
      includeUsers: false,
      imageDir: "generated/blueprint-images",
      allowMissingImages: false,
      hasDbPassword: false,
    }) as CommandStep[];

    const seedStep = steps.find((step) => step.id === "backend:seed-storage");
    expect(seedStep).toBeDefined();
    expect(seedStep?.command).toEqual([
      "node",
      "scripts/seed-storage.mjs",
      "--seed-images=always",
      "--image-dir",
      "generated/blueprint-images",
      "--strict-images",
    ]);
  });
});
