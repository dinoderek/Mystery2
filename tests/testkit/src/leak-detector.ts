import { createClient } from '@supabase/supabase-js';
import { resolveApiUrl } from '../../../lib/worktree-ports.mjs';

const SUPABASE_URL = resolveApiUrl();
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const TEST_EMAIL_SUFFIX = '@test.local';

// Seeded infrastructure users (created by `npm run seed:auth`) that the
// browser E2E and local dev login depend on.  These are intentionally
// long-lived and should never be flagged as leaks.
const SEEDED_EMAILS = new Set([
  'player1@test.local',
  'player2@test.local',
]);


/**
 * Queries for orphaned test users (emails matching *@test.local)
 * that weren't cleaned up after tests. Logs warnings — never throws.
 *
 * Excludes known seeded infrastructure users (player1, player2).
 *
 * Returns the count of leaked users found (0 = clean).
 */
export async function detectTestUserLeaks(): Promise<number> {
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (error) {
      console.warn(`[leak-detector] Failed to list users: ${error.message}`);
      return 0;
    }

    const leaked = data.users.filter((u) => {
      if (!u.email?.endsWith(TEST_EMAIL_SUFFIX)) return false;
      if (SEEDED_EMAILS.has(u.email)) return false;
      // Also accept any test-generated pattern as a potential leak
      // (even if it doesn't match the regex, any non-seeded @test.local
      // user is suspicious).
      return true;
    });

    if (leaked.length > 0) {
      console.warn(
        `[leak-detector] Found ${leaked.length} orphaned test user(s):`,
      );
      for (const u of leaked) {
        console.warn(`  - ${u.email} (id: ${u.id}, created: ${u.created_at})`);
      }
    }

    return leaked.length;
  } catch (err) {
    console.warn(
      `[leak-detector] Error during leak check: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 0;
  }
}
