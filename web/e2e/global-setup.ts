/**
 * Playwright global setup — ensures the worktree's Supabase stack is running
 * before any browser E2E tests execute.
 *
 * Without this, standalone `npm -w web run test:e2e` fails on the first run
 * because nothing starts Supabase on the worktree-derived port.  When run via
 * the test gate (`npm test`), earlier phases already call
 * `ensureSupabaseRunning`, so this is a fast no-op.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseEnvPath } from '../../scripts/local-config.mjs';
import {
	ensureSupabaseRunning,
	injectWorktreeEnv,
	loadEnvFile,
} from '../../scripts/supabase-utils.mjs';

export default async function globalSetup() {
	const configDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(configDir, '..', '..');

	// ensureSupabaseRunning and its helpers (patchConfigToml, npx supabase)
	// expect cwd to be the repo root, not the web/ workspace.
	const originalCwd = process.cwd();
	process.chdir(repoRoot);
	try {
		const baseEnvPath = getBaseEnvPath(repoRoot, process.env);
		const baseVars = await loadEnvFile(baseEnvPath, false);
		const env = injectWorktreeEnv({ ...baseVars, ...process.env });

		await ensureSupabaseRunning(env);
	} finally {
		process.chdir(originalCwd);
	}
}
