// Types for `lib/database-target.mjs` under the root tsconfig, which does not
// enable `allowJs`. Same arrangement as `local-config-module.d.ts`: without
// this the wildcard `declare module "*.mjs"` would make every import `any`.
// The web workspace enables `allowJs` and reads the JSDoc in the `.mjs`
// instead; keep the two in step.

declare module "../lib/database-target.mjs" {
  export * from "../../../lib/database-target.mjs";
}

declare module "../../../lib/database-target.mjs" {
  export const DATABASE_NAME_ENV: string;
  export const PROD_DATABASE: string;
  export const MAIN_DATABASE: string;
  export const TEST_DATABASE: string;
  export const DATABASE_FILENAME: string;
  export const DATABASE_SIDECAR_SUFFIXES: readonly string[];
  export function isValidDatabaseName(name: string): boolean;
  export function resolveDatabaseName(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function resolveDatabasesRoot(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function resolveDatabaseDir(
    name: string,
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function resolveDatabaseFile(
    name: string,
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): string;
  export function listDatabases(
    repoRoot?: string,
    env?: Record<string, string | undefined>,
  ): Array<{ name: string; dir: string; file: string; exists: boolean }>;
}
