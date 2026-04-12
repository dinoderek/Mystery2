import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_FUNCTION_DEPLOY_JOBS,
  assertRequiredDeployEnvVars,
  buildDefaultAIProfileConfig,
  buildCommandPlan,
  DEPLOY_ENVIRONMENTS,
  discoverEdgeFunctions,
  formatPlanLine,
  getBootstrapUsersExamplePath,
  getBootstrapUsersPath,
  isPlaceholderPassword,
  loadBootstrapUsers,
  parseDeployArgs,
  parseFunctionJobs,
  resolveFunctionDeployJobs,
  shouldBootstrapUsers,
  shouldSeedBlueprints,
  validateTargetsShape,
} from "../../../scripts/deploy-helpers.mjs";

interface CommandStep {
  id: string;
  title: string;
  command: string[];
  runtimeCommand?: string[];
}

interface CommandPlan {
  metadata: {
    parallelEnabled: boolean;
    functionCount: number;
    functionJobs: number;
  };
  serialPreDeploy: CommandStep[];
  parallelDeployLanes: {
    pages: CommandStep[];
    supabase: CommandStep[];
  };
  serialPostDeploy: CommandStep[];
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
      serial: false,
      functionJobs: null,
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

  it("parses serial and function job flags", () => {
    const parsed = parseDeployArgs([
      "--env=dev",
      "--serial",
      "--function-jobs",
      "6",
    ]);

    expect(parsed).toMatchObject({
      env: "dev",
      serial: true,
      functionJobs: 6,
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

  it("rejects invalid function job values", () => {
    expect(() => parseDeployArgs(["--env", "dev", "--function-jobs", "0"])).toThrow(
      "Invalid value for --function-jobs",
    );
  });
});

describe("function deploy job resolution", () => {
  it("parses integer function job values", () => {
    expect(parseFunctionJobs("4")).toBe(4);
  });

  it("rejects non-integer function job values", () => {
    expect(() => parseFunctionJobs("4.5")).toThrow(
      "Invalid value for --function-jobs",
    );
  });

  it("defaults and clamps parallel job counts", () => {
    expect(
      resolveFunctionDeployJobs({
        functionCount: 2,
        requestedJobs: null,
      }),
    ).toBe(Math.min(DEFAULT_FUNCTION_DEPLOY_JOBS, 2));

    expect(
      resolveFunctionDeployJobs({
        functionCount: 3,
        requestedJobs: 9,
      }),
    ).toBe(3);
  });

  it("forces serial job count to one", () => {
    expect(
      resolveFunctionDeployJobs({
        functionCount: 8,
        requestedJobs: 4,
        serial: true,
      }),
    ).toBe(1);
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
  it("resolves local bootstrap-user paths and matching examples", () => {
    const rootDir = "/tmp/repo";
    expect(getBootstrapUsersPath(rootDir, "dev", {})).toBe(
      path.join(rootDir, "deploy/bootstrap-users.dev.local.json"),
    );
    expect(getBootstrapUsersExamplePath(rootDir, "staging")).toBe(
      path.join(rootDir, "deploy/bootstrap-users.staging.example.json"),
    );
  });

  it("resolves bootstrap-user local paths from the external config root when configured", () => {
    const rootDir = "/tmp/repo";
    const configRoot = "/tmp/shared-config";

    expect(
      getBootstrapUsersPath(rootDir, "dev", { MYSTERY_CONFIG_ROOT: configRoot }),
    ).toBe(path.join(configRoot, "deploy/bootstrap-users.dev.local.json"));
    expect(getBootstrapUsersExamplePath(rootDir, "dev")).toBe(
      path.join(rootDir, "deploy/bootstrap-users.dev.example.json"),
    );
  });

  it("loads object-based users file", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-users-"));
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.local.json");

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
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.local.json");

    await writeFile(usersPath, JSON.stringify({ users: [{ email: "", password: "123" }] }), "utf-8");

    await expect(loadBootstrapUsers(usersPath)).rejects.toThrow("Invalid bootstrap user");
  });

  it("fails cleanly when only the example file exists", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-users-missing-"));
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.local.json");
    const examplePath = path.join(tmpDir, "bootstrap-users.dev.example.json");

    await writeFile(
      examplePath,
      JSON.stringify({ users: [{ email: "a@test.local", password: "replace-me-dev-password" }] }),
      "utf-8",
    );

    await expect(loadBootstrapUsers(usersPath)).rejects.toThrow(
      "Copy bootstrap-users.dev.example.json to bootstrap-users.dev.local.json and replace the sample passwords.",
    );
  });

  it("rejects placeholder passwords copied from the example", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "deploy-users-placeholder-"));
    const usersPath = path.join(tmpDir, "bootstrap-users.dev.local.json");

    await writeFile(
      usersPath,
      JSON.stringify({ users: [{ email: "a@test.local", password: "replace-me-dev-password" }] }),
      "utf-8",
    );

    await expect(loadBootstrapUsers(usersPath)).rejects.toThrow(
      "password must be replaced from the example template",
    );
    expect(isPlaceholderPassword("replace-me-dev-password")).toBe(true);
    expect(isPlaceholderPassword("Actual-Password-123!")).toBe(false);
  });
});

describe("buildCommandPlan", () => {
  it("builds staged dry-run command plans per environment", () => {
    const functionNames = ["blueprints-list", "game-start"];

    for (const envName of DEPLOY_ENVIRONMENTS) {
      const includeUsers = envName !== "prod";

      const plan = buildCommandPlan({
        envName,
        target: makeTarget(envName),
        functionNames,
        includePreflight: true,
        includeSeed: true,
        includeUsers,
        imageDir: null,
        allowMissingImages: true,
        serial: false,
        functionJobs: null,
        hasDbPassword: false,
      }) as CommandPlan;

      expect(plan.metadata).toEqual({
        parallelEnabled: true,
        functionCount: 2,
        functionJobs: 2,
      });

      expect(plan.serialPreDeploy.map((step) => step.id)).toEqual([
        "preflight:lint",
        "preflight:typecheck",
        "preflight:test-unit",
        "frontend:build",
      ]);

      expect(plan.parallelDeployLanes.pages.map((step) => step.id)).toEqual([
        "frontend:pages-deploy",
      ]);

      expect(plan.parallelDeployLanes.supabase.map((step) => step.id)).toEqual([
        "backend:link",
        "backend:db-push",
        "backend:configure-default-ai-profile",
        "backend:functions-deploy",
        "backend:seed-storage",
        ...(includeUsers ? [`backend:bootstrap-users:${envName}`] : []),
      ]);

      expect(plan.serialPostDeploy.map((step) => step.id)).toEqual([
        "verify:smoke",
      ]);

      const pagesStep = plan.parallelDeployLanes.pages.find(
        (step) => step.id === "frontend:pages-deploy",
      );
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

      const functionsStep = plan.parallelDeployLanes.supabase.find(
        (step) => step.id === "backend:functions-deploy",
      );
      expect(functionsStep?.command).toEqual([
        functionsStep?.command[0],
        "supabase",
        "functions",
        "deploy",
        "--project-ref",
        `${envName}-ref`,
        "--use-api",
        "--no-verify-jwt",
        "--jobs",
        "2",
      ]);

      const lines = [
        ...plan.serialPreDeploy,
        ...plan.parallelDeployLanes.pages,
        ...plan.parallelDeployLanes.supabase,
        ...plan.serialPostDeploy,
      ].map((step) => formatPlanLine(step));
      expect(lines[0]).toContain("preflight:lint");
      expect(lines.at(-1)).toContain("verify:smoke");
    }
  });

  it("omits optional steps when skip flags are enabled", () => {
    const plan = buildCommandPlan({
      envName: "dev",
      target: makeTarget("dev"),
      functionNames: ["blueprints-list"],
      includePreflight: false,
      includeSeed: false,
      includeUsers: false,
      imageDir: null,
      allowMissingImages: true,
      serial: false,
      functionJobs: null,
      hasDbPassword: false,
    }) as CommandPlan;

    expect(plan.serialPreDeploy.map((step) => step.id)).not.toContain("preflight:lint");
    expect(plan.parallelDeployLanes.supabase.map((step) => step.id)).not.toContain(
      "backend:seed-storage",
    );
    expect(
      plan.parallelDeployLanes.supabase.some((step) =>
        step.id.startsWith("backend:bootstrap-users"),
      ),
    ).toBe(false);
  });

  it("adds image sync flags to seed step when image dir is provided", () => {
    const plan = buildCommandPlan({
      envName: "dev",
      target: makeTarget("dev"),
      functionNames: ["blueprints-list"],
      includePreflight: false,
      includeSeed: true,
      includeUsers: false,
      imageDir: "generated/blueprint-images",
      allowMissingImages: false,
      serial: false,
      functionJobs: null,
      hasDbPassword: false,
    }) as CommandPlan;

    const seedStep = plan.parallelDeployLanes.supabase.find(
      (step) => step.id === "backend:seed-storage",
    );
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

  it("forces serial mode and single function job", () => {
    const plan = buildCommandPlan({
      envName: "dev",
      target: makeTarget("dev"),
      functionNames: ["blueprints-list", "game-start", "game-move"],
      includePreflight: false,
      includeSeed: false,
      includeUsers: false,
      imageDir: null,
      allowMissingImages: true,
      serial: true,
      functionJobs: 5,
      hasDbPassword: false,
    }) as CommandPlan;

    expect(plan.metadata.parallelEnabled).toBe(false);
    expect(plan.metadata.functionJobs).toBe(1);
    expect(
      plan.parallelDeployLanes.supabase.find((step) => step.id === "backend:functions-deploy")
        ?.command,
    ).toContain("1");
  });
});
