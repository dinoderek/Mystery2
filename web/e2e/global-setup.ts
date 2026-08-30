/**
 * Empties the browser suite's database before a run, so results do not depend
 * on what the last run left behind. Playwright's `webServer` starts the game
 * itself, so there is nothing here to launch.
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
