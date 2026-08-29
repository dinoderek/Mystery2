/**
 * Empties the browser suite's database before a run.
 *
 * This used to start the worktree's Supabase stack. There is nothing to start
 * now — Playwright's `webServer` runs the game server itself — but the run
 * still wants a database with no sessions in it, so results do not depend on
 * what the last run left behind.
 */

import fs from 'node:fs';
import path from 'node:path';
import { E2E_CONFIG_ROOT } from '../playwright.config';

export default function globalSetup() {
	for (const entry of ['game.db', 'game.db-wal', 'game.db-shm']) {
		fs.rmSync(path.join(E2E_CONFIG_ROOT, entry), { force: true });
	}
	fs.mkdirSync(path.join(E2E_CONFIG_ROOT, 'blueprint-images'), { recursive: true });
}
