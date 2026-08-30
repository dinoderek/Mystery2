import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveWorktreePorts } from '../lib/worktree-ports.mjs';
import { TEST_DATABASE, resolveDatabaseFile } from '../lib/database-target.mjs';

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..');
const { ports } = resolveWorktreePorts(repoRoot);

const port = ports.web;
// 127.0.0.1, not localhost: localhost resolves to ::1 first on this
// machine and the dev server binds IPv4 only, so `page.request` would be
// refused while `page.goto` quietly fell back.
const baseURL = `http://127.0.0.1:${port}`;

// The browser suite plays real sessions, so it gets a database of its own.
// Deterministic rather than a mkdtemp: the config module is re-loaded in every
// worker, and they all have to agree on the same directory. `global-setup.ts`
// empties it at the start of each run and `global-teardown.ts` removes it.
export const E2E_CONFIG_ROOT = path.join(os.tmpdir(), `mystery-e2e-${port}`);
fs.mkdirSync(E2E_CONFIG_ROOT, { recursive: true });

// Pinned rather than left to the worktree-derived name, so `global-setup.ts`
// can empty the file the server is about to open without repeating the
// derivation. It is inside E2E_CONFIG_ROOT either way, never a real database.
export const E2E_DATABASE_FILE = resolveDatabaseFile(TEST_DATABASE, E2E_CONFIG_ROOT, {});

export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  testDir: './e2e',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 4,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [['list'], ['html']],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('')`. */
    baseURL,

    /* Capture screenshot on failure for debugging */
    screenshot: 'only-on-failure',

    /* Collect trace on failure (no retry needed). See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  /* The game server: one process serving both the app and /api. */
  webServer: {
    command: `npm run dev -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      MYSTERY_CONFIG_ROOT: E2E_CONFIG_ROOT,
      MYSTERY_DATABASE: TEST_DATABASE,
    },
  },
});
