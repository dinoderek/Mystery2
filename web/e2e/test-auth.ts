import { expect, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

const TEST_EMAIL = process.env.AUTH_TEST_EMAIL ?? null;
const TEST_PASSWORD = process.env.AUTH_TEST_PASSWORD ?? 'password123';

function readRootEnvValue(key: string): string | null {
  const envPath = path.resolve(process.cwd(), '../.env.local');
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

async function ensureTestUser(email: string, password: string) {
  const supabaseUrl =
    process.env.VITE_SUPABASE_URL ?? readRootEnvValue('API_URL') ?? 'http://127.0.0.1:54331';
  const serviceRoleKey =
    process.env.SERVICE_ROLE_KEY ?? readRootEnvValue('SERVICE_ROLE_KEY');

  if (!serviceRoleKey) {
    throw new Error('SERVICE_ROLE_KEY is required for auth E2E setup');
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (
    error &&
    !/already (?:registered|exists)|user already exists|duplicate key/i.test(error.message)
  ) {
    throw error;
  }
}

export async function enableAuthBypass(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem('mystery-e2e-auth-bypass', '1');
  });
}

export async function loginWithSeedUser(page: Page, password = TEST_PASSWORD) {
  const email = TEST_EMAIL ?? `player-${crypto.randomUUID().slice(0, 8)}@test.local`;

  await ensureTestUser(email, password);

  await page.goto('/');
  await expect(page).toHaveURL(/\/login$/);

  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: '[ LOGIN ]' }).click();

  await expect(page).toHaveURL(/\/$/, { timeout: 15000 });
  await expect(page.getByText('MYSTERY GAME TERMINAL').first()).toBeVisible();
}
