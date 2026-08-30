// Where the local engine finds its database and its content on disk.
//
// Everything is resolved through `scripts/local-config.mjs`, the same helper
// the dev and generator scripts use, so a checkout with `MYSTERY_CONFIG_ROOT`
// set reads the same blueprints and images the generators write.
//
// (The ambient type declaration for that `.mjs` module lives in
// `tests/local-config-module.d.ts`; it is keyed on the literal specifier, which
// resolves to the same file from here.)

import path from "node:path";
import {
  getBlueprintImagesDir,
  getBlueprintsDir,
  isUsingExternalLocalConfigRoot,
  resolveLocalConfigRoot,
} from "../../../scripts/local-config.mjs";

type Env = Record<string, string | undefined>;

/**
 * The game database.
 *
 * With `MYSTERY_CONFIG_ROOT` set it is `<root>/game.db`, so every worktree
 * shares one history worth mining; otherwise `<repo>/data/game.db`, which is
 * gitignored.
 *
 * This is the *development* database. Tests must never open it — they pass an
 * explicit path under a temporary directory to `openDatabase()` instead.
 */
export function resolveDatabasePath(
  repoRoot: string = process.cwd(),
  env: Env = process.env,
): string {
  if (isUsingExternalLocalConfigRoot(repoRoot, env)) {
    return path.join(resolveLocalConfigRoot(repoRoot, env), "game.db");
  }
  return path.join(path.resolve(repoRoot), "data", "game.db");
}

/**
 * Directories searched for blueprint JSON, in precedence order: the config
 * root's `blueprints/` first, then the ones committed to the repo.
 *
 * The two are the same directory when `MYSTERY_CONFIG_ROOT` is unset, in which
 * case only one is searched. Keeping the repo's copy in the list even when a
 * config root is set is what lets the test suite run against fixtures it can
 * rely on while writing its database somewhere disposable.
 */
export function resolveBlueprintDirs(
  repoRoot: string = process.cwd(),
  env: Env = process.env,
): string[] {
  const committed = path.join(path.resolve(repoRoot), "blueprints");
  const configured = getBlueprintsDir(repoRoot, env);

  return configured === committed ? [committed] : [configured, committed];
}

/**
 * Directory holding blueprint image files, flat, named by image id — the same
 * layout `seed:storage` uploads from.
 */
export function resolveBlueprintImagesDir(
  repoRoot: string = process.cwd(),
  env: Env = process.env,
): string {
  return getBlueprintImagesDir(repoRoot, env);
}
