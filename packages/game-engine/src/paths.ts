// Where the local engine finds its database and its content on disk.
//
// Everything is resolved through `scripts/local-config.mjs`, the same helper
// the dev and generator scripts use, so a checkout with `MYSTERY_CONFIG_ROOT`
// set reads the same blueprints and images the generators write.
//
// The database is a step further out: it is named per worktree by
// `lib/database-target.mjs`, because it is the one thing here carrying a schema
// version and so the one thing two checkouts must not share.
//
// (The ambient type declarations for both `.mjs` modules live in
// `tests/local-config-module.d.ts` and `tests/database-target-module.d.ts`;
// they are keyed on the literal specifier, which resolves to the same file
// from here.)

import path from "node:path";
import {
  getBlueprintImagesDir,
  getBlueprintsDir,
} from "../../../scripts/local-config.mjs";
import {
  resolveDatabaseFile,
  resolveDatabaseName,
} from "../../../lib/database-target.mjs";

type Env = Record<string, string | undefined>;

/**
 * The game database.
 *
 * `<config root>/database/<name>/game.db`, where the name is this worktree's
 * (`main` in the main checkout) unless `MYSTERY_DATABASE` overrides it — which
 * is how `npm run prod` reaches the persistent one. `lib/database-target.mjs`
 * derives it, and explains why a worktree must not share a database.
 *
 * This is the *development* database. Tests must never open it — they pass an
 * explicit path under a temporary directory to `openDatabase()` instead.
 */
export function resolveDatabasePath(
  repoRoot: string = process.cwd(),
  env: Env = process.env,
): string {
  return resolveDatabaseFile(resolveDatabaseName(repoRoot, env), repoRoot, env);
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
