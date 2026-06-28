// Environment + URL resolution for the runtime evaluation harness.
//
// Mirrors the local Supabase config that the vitest API suites rely on
// (tests/testkit/src/auth.ts, tests/api/integration/auth-helpers.ts) but stays
// Node-native (.mjs) so the harness has no TypeScript build dependency.

import { resolveApiUrl } from "../../../lib/worktree-ports.mjs";

// Local demo keys shipped with the Supabase CLI. These are NOT secrets — they
// are the well-known anon/service keys for a default local stack. Override via
// SERVICE_ROLE_KEY / ANON_KEY env vars for any non-default stack.
const DEFAULT_SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const DEFAULT_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WO_o0BopYjALCUvsJFpjTimEV1V5ICUAx3NU";

/**
 * Resolve the API base URL, functions URL, and local keys for the current
 * worktree's Supabase stack.
 */
export function resolveEnv(cwd = process.cwd()) {
  const supabaseUrl = resolveApiUrl(cwd);
  return {
    supabaseUrl,
    functionsUrl: `${supabaseUrl}/functions/v1`,
    restUrl: `${supabaseUrl}/rest/v1`,
    serviceRoleKey: process.env.SERVICE_ROLE_KEY || DEFAULT_SERVICE_ROLE_KEY,
    anonKey: process.env.ANON_KEY || DEFAULT_ANON_KEY,
  };
}
