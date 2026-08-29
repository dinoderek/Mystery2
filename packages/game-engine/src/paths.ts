// Where the local engine finds its database and its content on disk.
//
// Everything is resolved through `scripts/local-config.mjs`, the same helper
// the seed and dev scripts use, so a worktree with `MYSTERY_CONFIG_ROOT` set
// reads the same blueprints and images the Supabase seeder uploads today.
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
 * Directories searched for blueprint JSON, in precedence order.
 *
 * Mirrors `scripts/seed-storage.mjs`: the config root's `blueprints/` first,
 * then the two seed blueprints checked into the repo. The second entry goes
 * away with `supabase/` in P5, at which point the seed blueprints need a new
 * home.
 */
export function resolveBlueprintDirs(
  repoRoot: string = process.cwd(),
  env: Env = process.env,
): string[] {
  return [
    getBlueprintsDir(repoRoot, env),
    path.join(path.resolve(repoRoot), "supabase/seed/blueprints"),
  ];
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
