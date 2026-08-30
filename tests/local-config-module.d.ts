// Types for `scripts/local-config.mjs` under the root tsconfig, which does not
// enable `allowJs` — without this, the wildcard `declare module "*.mjs"` would
// make every import from it `any`. The web workspace does enable `allowJs` and
// reads the JSDoc annotations in the `.mjs` itself; keep the two in step.

declare module "../scripts/local-config.mjs" {
  export * from "../../../scripts/local-config.mjs";
}

declare module "../../../scripts/local-config.mjs" {
  export const MYSTERY_CONFIG_ROOT_ENV: string;
  export function resolveLocalConfigRoot(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function isUsingExternalLocalConfigRoot(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): boolean;
  export function getBaseEnvPath(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getAIEnvPath(
    repoRoot: string,
    mode: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getImagesEnvPath(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getBlueprintsDir(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getBriefsDir(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getBlueprintImagesDir(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getChatGenPromptsDir(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
}
