import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MYSTERY_CONFIG_ROOT_ENV,
  formatResolvedLocalConfigPath,
  getAIEnvPath,
  getAuthUsersExamplePath,
  getAuthUsersLocalPath,
  getBaseEnvPath,
  getBootstrapUsersExamplePath,
  getBootstrapUsersPath,
  getDeployEnvPath,
  getImagesEnvPath,
  isUsingExternalLocalConfigRoot,
  resolveLocalConfigRoot,
} from "../../../scripts/local-config.mjs";

describe("local config resolver", () => {
  const repoRoot = "/tmp/repo";
  const externalRoot = "/tmp/shared-mystery-config";

  it("uses the repo root when MYSTERY_CONFIG_ROOT is unset", () => {
    expect(resolveLocalConfigRoot(repoRoot, {})).toBe(repoRoot);
    expect(isUsingExternalLocalConfigRoot(repoRoot, {})).toBe(false);
    expect(getBaseEnvPath(repoRoot, {})).toBe(path.join(repoRoot, ".env.local"));
  });

  it("uses the configured external root when MYSTERY_CONFIG_ROOT is absolute", () => {
    const env = { [MYSTERY_CONFIG_ROOT_ENV]: externalRoot };

    expect(resolveLocalConfigRoot(repoRoot, env)).toBe(externalRoot);
    expect(isUsingExternalLocalConfigRoot(repoRoot, env)).toBe(true);
    expect(getBaseEnvPath(repoRoot, env)).toBe(path.join(externalRoot, ".env.local"));
    expect(getAIEnvPath(repoRoot, "free", env)).toBe(
      path.join(externalRoot, ".env.ai.free.local"),
    );
    expect(getImagesEnvPath(repoRoot, env)).toBe(
      path.join(externalRoot, ".env.images.local"),
    );
    expect(getDeployEnvPath(repoRoot, "dev", env)).toBe(
      path.join(externalRoot, ".env.deploy.dev.local"),
    );
    expect(getAuthUsersLocalPath(repoRoot, env)).toBe(
      path.join(externalRoot, "supabase/seed/auth-users.local.json"),
    );
    expect(getBootstrapUsersPath(repoRoot, "staging", env)).toBe(
      path.join(externalRoot, "deploy/bootstrap-users.staging.local.json"),
    );
  });

  it("keeps committed example/template files repo-relative", () => {
    const env = { [MYSTERY_CONFIG_ROOT_ENV]: externalRoot };

    expect(getAuthUsersExamplePath(repoRoot)).toBe(
      path.join(repoRoot, "supabase/seed/auth-users.example.json"),
    );
    expect(getBootstrapUsersExamplePath(repoRoot, "dev")).toBe(
      path.join(repoRoot, "deploy/bootstrap-users.dev.example.json"),
    );
    expect(getAuthUsersExamplePath(repoRoot)).not.toContain(externalRoot);
    expect(getBootstrapUsersExamplePath(repoRoot, "dev")).not.toContain(externalRoot);
    expect(getBaseEnvPath(repoRoot, env)).toContain(externalRoot);
  });

  it("rejects relative MYSTERY_CONFIG_ROOT values", () => {
    expect(() =>
      resolveLocalConfigRoot(repoRoot, {
        [MYSTERY_CONFIG_ROOT_ENV]: "./relative-config",
      }),
    ).toThrow(`${MYSTERY_CONFIG_ROOT_ENV} must be an absolute path`);
  });

  it("formats repo-local paths relatively and external paths absolutely", () => {
    expect(
      formatResolvedLocalConfigPath(repoRoot, path.join(repoRoot, ".env.local")),
    ).toBe(".env.local");
    expect(
      formatResolvedLocalConfigPath(
        repoRoot,
        path.join(externalRoot, "supabase/seed/auth-users.local.json"),
      ),
    ).toBe(path.join(externalRoot, "supabase/seed/auth-users.local.json"));
  });
});
