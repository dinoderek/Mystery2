import { createClient } from '@supabase/supabase-js';
import { resolveApiUrl } from '../../../lib/worktree-ports.mjs';

const SUPABASE_URL = resolveApiUrl();
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const ANON_KEY = process.env.ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WO_o0BopYjALCUvsJFpjTimEV1V5ICUAx3NU';

/** Admin client for user management (service role, bypasses RLS) */
function getAdminClient() {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Create a test user via the admin API. Returns the user object. */
export async function createTestUser(email: string, password: string) {
  const admin = getAdminClient();
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (error) throw new Error(`Failed to create test user ${email}: ${error.message}`);
  return data.user;
}

/** Sign in as a test user. Returns the session with access_token. */
export async function signIn(email: string, password: string) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Failed to sign in as ${email}: ${error.message}`);
  return data.session!;
}

/** Get Authorization headers for a signed-in session token. */
export function getAuthHeaders(accessToken: string) {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
  };
}

/** Create a user-scoped Supabase client using a session token (for RLS tests). */
export function createAuthenticatedClient(accessToken: string) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Delete a test user via the admin API. */
export async function cleanupTestUser(userId: string) {
  const admin = getAdminClient();
  // Remove owned rows first to satisfy FK constraints against auth.users.
  await admin.from("briefs").delete().eq("user_id", userId);
  await admin.from("game_sessions").delete().eq("user_id", userId);
  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    console.warn(`Failed to cleanup test user ${userId}: ${error.message}`);
  }
}

/** Helper: create user, sign in, return everything needed for tests. */
export async function setupTestAuth(email?: string, password?: string) {
  const testEmail = email || `test-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const testPassword = password || 'test-password-123';

  const user = await createTestUser(testEmail, testPassword);
  const session = await signIn(testEmail, testPassword);
  const headers = getAuthHeaders(session.access_token);

  return {
    user,
    session,
    headers,
    accessToken: session.access_token,
    cleanup: () => cleanupTestUser(user.id),
  };
}

// Legacy export for backward compatibility
export function getAnonSession() {
  return "anon";
}
