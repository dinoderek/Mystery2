import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

/**
 * Creates a Supabase client with the service role key (bypasses RLS).
 * Use for admin/privileged operations only.
 */
export function createClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables",
    );
  }

  return createSupabaseClient(supabaseUrl, supabaseKey);
}

/**
 * Creates a user-scoped Supabase client that forwards the request's
 * Authorization header. All DB operations through this client are
 * subject to RLS policies.
 */
export function createUserClient(req: Request) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables",
    );
  }

  return createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: req.headers.get("Authorization") ?? "" },
    },
  });
}
