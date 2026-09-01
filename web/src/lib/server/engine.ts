// The engine, opened once for the life of the server process.
//
// `createLocalEngine()` opens the SQLite file and resolves the content
// directories; doing that per request would reopen the database on every turn.
// Everything under `src/routes/api/` reaches the game through this module and
// nothing else.

import path from 'node:path';
import { createLocalEngine, playerCookieName, type LocalEngine } from '@my2/game-engine';

let engine: LocalEngine | null = null;

/**
 * The repository root, which is where the database and content directories are
 * resolved from when `MYSTERY_CONFIG_ROOT` is not set.
 *
 * Every way of starting this server — `vite dev`, `node build/index.js`,
 * `npm run dev` from the repo root — runs with `web/` as the working
 * directory, so the root is its parent. `MYSTERY_REPO_ROOT` overrides that for
 * anything that does not.
 */
function resolveRepoRoot(): string {
	const override = process.env.MYSTERY_REPO_ROOT?.trim();
	if (override) return path.resolve(override);

	const cwd = process.cwd();
	return path.basename(cwd) === 'web' ? path.dirname(cwd) : cwd;
}

export function getEngine(): LocalEngine {
	engine ??= createLocalEngine({ repoRoot: resolveRepoRoot() });
	return engine;
}

/**
 * The profile cookie for the database this server opened.
 *
 * Derived rather than fixed because cookies are not isolated by port: two
 * servers on `localhost` share a jar, and each worktree has its own database.
 * `player-cookie.ts` in the engine has the rest.
 */
export function playerCookie(): string {
	return playerCookieName(getEngine().databasePath);
}
