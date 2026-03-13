import { setupTestAuth } from '../../testkit/src/auth';
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs/promises';
import path from 'node:path';

export const API_URL = 'http://127.0.0.1:54331/functions/v1';
export const REST_URL = 'http://127.0.0.1:54331/rest/v1';

export type ApiAuthContext = Awaited<ReturnType<typeof setupTestAuth>>;

export async function setupApiTestAuth(tag: string): Promise<ApiAuthContext> {
	const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`;
	return setupTestAuth(email, 'password123');
}

const SUPABASE_URL = process.env.SUPABASE_URL || 'http://127.0.0.1:54331';
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

export async function ensureMockBlueprintSeeded(): Promise<void> {
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const blueprintPath = path.resolve(
    process.cwd(),
    'supabase/seed/blueprints/mock-blueprint.json',
  );
  const raw = await fs.readFile(blueprintPath, 'utf-8');
  const parsed = JSON.parse(raw) as { id: string };

  const { error } = await admin.storage.from('blueprints').upload(
    `${parsed.id}.json`,
    raw,
    {
      contentType: 'application/json',
      upsert: true,
    },
  );
  if (error) {
    throw new Error(`Failed to seed mock blueprint fixture: ${error.message}`);
  }
}
