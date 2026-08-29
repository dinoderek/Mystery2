import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  MYSTERY_CONFIG_ROOT_ENV,
  getAIEnvPath,
  getBaseEnvPath,
  getBlueprintImagesDir,
  getBlueprintsDir,
  getBriefsDir,
  getChatGenPromptsDir,
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
  });

  it("resolves content dirs from the external root", () => {
    const env = { [MYSTERY_CONFIG_ROOT_ENV]: externalRoot };

    expect(getBlueprintsDir(repoRoot, env)).toBe(path.join(externalRoot, "blueprints"));
    expect(getBriefsDir(repoRoot, env)).toBe(path.join(externalRoot, "briefs"));
    expect(getBlueprintImagesDir(repoRoot, env)).toBe(
      path.join(externalRoot, "blueprint-images"),
    );
    expect(getChatGenPromptsDir(repoRoot, env)).toBe(
      path.join(externalRoot, "chat-gen-prompts"),
    );
  });

  it("resolves content dirs from the repo root when unset", () => {
    expect(getBlueprintsDir(repoRoot, {})).toBe(path.join(repoRoot, "blueprints"));
    expect(getBriefsDir(repoRoot, {})).toBe(path.join(repoRoot, "briefs"));
    expect(getBlueprintImagesDir(repoRoot, {})).toBe(
      path.join(repoRoot, "blueprint-images"),
    );
  });

  it("rejects relative MYSTERY_CONFIG_ROOT values", () => {
    expect(() =>
      resolveLocalConfigRoot(repoRoot, {
        [MYSTERY_CONFIG_ROOT_ENV]: "./relative-config",
      }),
    ).toThrow(`${MYSTERY_CONFIG_ROOT_ENV} must be an absolute path`);
  });
});
