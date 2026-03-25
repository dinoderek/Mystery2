import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { getAuthUsersLocalPath, getBaseEnvPath } from '../../scripts/local-config.mjs';
import { resolveWorktreePorts } from '../../lib/worktree-ports.mjs';

const TEST_EMAIL = process.env.AUTH_TEST_EMAIL ?? null;
const TEST_PASSWORD = process.env.AUTH_TEST_PASSWORD ?? null;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableConnectionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /ECONNREFUSED|fetch failed|network/i.test(error.message);
}

function readRootEnvValue(key: string): string | null {
  const repoRoot = path.resolve(process.cwd(), '..');
  const envPath = getBaseEnvPath(repoRoot, process.env);
  if (!fs.existsSync(envPath)) return null;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/u);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const envKey = trimmed.slice(0, eqIdx).trim();
    if (envKey !== key) continue;
    let value = trimmed.slice(eqIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }

  return null;
}

type AuthLogin = {
  email: string;
  password: string;
};

function readLocalSeedLogin(): AuthLogin | null {
  const repoRoot = path.resolve(process.cwd(), '..');
  const usersPath = getAuthUsersLocalPath(repoRoot, process.env);
  if (!fs.existsSync(usersPath)) return null;

  const raw = fs.readFileSync(usersPath, 'utf8');
  const parsed = JSON.parse(raw) as {
    users?: Array<{ email?: string; password?: string }>;
  };
  const firstUser = Array.isArray(parsed.users) ? parsed.users[0] : null;
  if (!firstUser?.email || !firstUser.password) {
    throw new Error(`Invalid auth seed config: ${usersPath}`);
  }

  return {
    email: firstUser.email,
    password: firstUser.password,
  };
}

export function resolvePreferredLogin(): AuthLogin {
  if ((TEST_EMAIL && !TEST_PASSWORD) || (!TEST_EMAIL && TEST_PASSWORD)) {
    throw new Error('AUTH_TEST_EMAIL and AUTH_TEST_PASSWORD must be set together');
  }

  if (TEST_EMAIL && TEST_PASSWORD) {
    return { email: TEST_EMAIL, password: TEST_PASSWORD };
  }

  const localSeedLogin = readLocalSeedLogin();
  if (localSeedLogin) return localSeedLogin;

  const suffix = crypto.randomUUID().slice(0, 8);
  return {
    email: `player-${suffix}@test.local`,
    password: `E2E-${suffix}-Aa1!`,
  };
}

function resolveSupabaseUrl(): string {
  if (process.env.VITE_SUPABASE_URL) return process.env.VITE_SUPABASE_URL;

  const repoRoot = path.resolve(process.cwd(), '..');
  const { ports, isWorktree } = resolveWorktreePorts(repoRoot);
  if (isWorktree) return `http://127.0.0.1:${ports.api}`;

  return readRootEnvValue('API_URL') ?? 'http://127.0.0.1:54331';
}

async function ensureTestUser(email: string, password: string) {
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey =
    process.env.SERVICE_ROLE_KEY ?? readRootEnvValue('SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    throw new Error('SERVICE_ROLE_KEY is required for auth E2E setup');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let error: { message: string } | null = null;

  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const result = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      error = result.error;
      break;
    } catch (thrown: unknown) {
      const msg = thrown instanceof Error ? thrown.message : String(thrown);
      if (/already.*registered|already.*exists|user already exists|duplicate key/i.test(msg)) {
        return;
      }
      if (attempt === 5 || !isRetryableConnectionError(thrown)) {
        throw thrown;
      }
      await sleep(500 * attempt);
    }
  }

  if (
    error &&
    !/already.*registered|already.*exists|user already exists|duplicate key/i.test(error.message)
  ) {
    throw error;
  }
}

export async function enableAuthBypass(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('mystery-e2e-auth-bypass', '1');
  });
}

export async function loginWithSeedUser(page: Page, password?: string) {
  const resolved = resolvePreferredLogin();
  const email = resolved.email;
  const loginPassword = password ?? resolved.password;

  await ensureTestUser(email, loginPassword);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(loginPassword);
  await page.getByRole('button', { name: '[ LOGIN ]' }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();
}
