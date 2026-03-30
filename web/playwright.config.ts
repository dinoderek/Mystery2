import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBaseEnvPath } from '../scripts/local-config.mjs';
import { resolveWorktreePorts } from '../lib/worktree-ports.mjs';

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const contents = fs.readFileSync(filePath, 'utf8');
  const vars: Record<string, string> = {};

  for (const line of contents.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const firstEq = trimmed.indexOf('=');
    if (firstEq === -1) continue;

    const key = trimmed.slice(0, firstEq).trim();
    let value = trimmed.slice(firstEq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }

  return vars;
}

const configDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(configDir, '..');
const { ports, isWorktree } = resolveWorktreePorts(repoRoot);
const rootEnv = parseEnvFile(getBaseEnvPath(repoRoot, process.env));

// In a worktree the derived Supabase URL is authoritative; in the main
// checkout we fall back to .env.local / hardcoded defaults as before.
const supabaseUrl = isWorktree
  ? `http://127.0.0.1:${ports.api}`
  : (process.env.VITE_SUPABASE_URL ?? rootEnv.API_URL ?? 'http://127.0.0.1:54331');

const webServerEnv = {
  ...process.env,
  VITE_SUPABASE_URL: supabaseUrl,
  VITE_SUPABASE_ANON_KEY:
    process.env.VITE_SUPABASE_ANON_KEY ??
    rootEnv.ANON_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY,
  VITE_E2E_AUTH_BYPASS: '1',
};

const vitePort = ports.vite_dev;
const viteUrl = `http://localhost:${vitePort}`;

/**
 * Read environment variables from file.
 * https://github.com/motdotla/dotenv
 */
// import dotenv from 'dotenv';
// import path from 'path';
// dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  globalSetup: './e2e/global-setup.ts',
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
    baseURL: viteUrl,

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

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  webServer: {
    command: `npm run dev -- --port ${vitePort}`,
    url: viteUrl,
    reuseExistingServer: !process.env.CI,
    env: webServerEnv,
  },
});
