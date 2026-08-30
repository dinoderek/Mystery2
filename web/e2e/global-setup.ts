/**
 * Empties the browser suite's database before a run, so results do not depend
 * on what the last run left behind. Playwright's `webServer` starts the game
 * itself, so there is nothing here to launch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { E2E_CONFIG_ROOT, E2E_DATABASE_FILE } from '../playwright.config';

export default function globalSetup() {
	// The sidecars too: a surviving `-wal` would replay the last run's committed
	// transactions back into the "empty" database on the next open.
	for (const suffix of ['', '-wal', '-shm']) {
		fs.rmSync(`${E2E_DATABASE_FILE}${suffix}`, { force: true });
	}
	fs.mkdirSync(path.join(E2E_CONFIG_ROOT, 'blueprint-images'), { recursive: true });
}
