// The name of the cookie holding the current profile.
//
// A profile is a row in one database, and a worktree gets its own database
// (`lib/database-target.mjs` explains why). Cookies, though, are not isolated
// by port: `localhost:51000` and `localhost:51006` share one jar, and so do
// `npm run dev` and `npm run prod`, which run on the same port against
// different databases. One fixed name therefore let whichever server was used
// last overwrite the profile for all of them.
//
// The damage was quiet. The next server read an id its database had never
// heard of, `getById` returned nothing, and every endpoint answered 401 — while
// the browser still showed a signed-in menu, because the client loads the
// profile once at mount and never asks again. "I am signed in and everything
// says I am not" was this.
//
// Scoping the name to the database gives each one its own cookie, so the
// servers stop overwriting each other and signing in to one no longer signs
// you out of another.

import { createHash } from "node:crypto";
import path from "node:path";

/** Shared by every scoped name, so the family is recognisable in devtools. */
export const PLAYER_COOKIE_PREFIX = "mystery-player-id";

/**
 * The cookie name for the profile in `databasePath`.
 *
 * The database's absolute path is hashed rather than its name being used
 * directly: a name is a single path segment but not necessarily a valid cookie
 * name, and two runs can share one (the suites all use `test`, under a
 * different temporary config root each time). The path is what actually
 * identifies the database, and a digest of it is always a valid token.
 */
export function playerCookieName(databasePath: string): string {
  const digest = createHash("sha256")
    .update(path.resolve(databasePath))
    .digest("hex")
    .slice(0, 8);

  return `${PLAYER_COOKIE_PREFIX}.${digest}`;
}
