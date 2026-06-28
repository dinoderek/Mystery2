// Node-native auth bootstrap for the runtime evaluation harness.
//
// Functionally mirrors tests/testkit/src/auth.ts: create a throwaway test user
// via the admin API, sign in to get a bearer token, and clean up afterwards.

import { createClient } from "@supabase/supabase-js";
import { resolveEnv } from "./env.mjs";

function adminClient(env) {
  return createClient(env.supabaseUrl, env.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Create a test user, sign in, and return the bearer headers plus a cleanup
 * function that deletes the user (and its owned rows) again.
 */
export async function setupHarnessAuth(tag = "runtime-eval", env = resolveEnv()) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const password = "test-password-123";

  const admin = adminClient(env);
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (createError) {
    throw new Error(`Failed to create test user ${email}: ${createError.message}`);
  }
  const user = created.user;

  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: signedIn, error: signInError } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) {
    throw new Error(`Failed to sign in as ${email}: ${signInError.message}`);
  }
  const accessToken = signedIn.session.access_token;

  return {
    user,
    accessToken,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    cleanup: async () => {
      await admin.from("briefs").delete().eq("user_id", user.id);
      await admin.from("game_sessions").delete().eq("user_id", user.id);
      const { error } = await admin.auth.admin.deleteUser(user.id);
      if (error) {
        console.warn(`Failed to clean up test user ${user.id}: ${error.message}`);
      }
    },
  };
}
