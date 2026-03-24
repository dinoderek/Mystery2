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
  export function resolveLocalConfigPath(
    relativePath: string,
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
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
  export function getDeployEnvPath(
    repoRoot: string,
    envName: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getAuthUsersLocalPath(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getAuthUsersExamplePath(repoRoot?: string): string;
  export function getBootstrapUsersPath(
    repoRoot: string,
    envName: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function getBootstrapUsersExamplePath(
    repoRoot: string,
    envName: string,
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
  export function formatResolvedLocalConfigPath(
    repoRoot: string,
    filePath: string,
  ): string;
}
