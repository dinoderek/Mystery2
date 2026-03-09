import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";
import { unauthorized } from "./errors.ts";

export interface AuthResult {
  client: ReturnType<typeof createSupabaseClient>;
  user: { id: string; email?: string };
}

/**
 * Validates the Authorization header JWT and returns a user-scoped Supabase client.
 * All subsequent DB operations through the returned client are subject to RLS.
 *
 * @throws Returns a 401 Response if auth fails (caller should return it directly).
 */
export async function requireAuth(req: Request): Promise<AuthResult | Response> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
    return unauthorized("Missing or invalid authorization token");
  }

  const accessToken = authHeader.slice(7).trim();
  if (!accessToken) {
    return unauthorized("Missing or invalid authorization token");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY environment variables");
  }

  // Create user-scoped client with the forwarded auth header
  const client = createSupabaseClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: authHeader },
    },
  });

  // Validate the token by fetching the user
  const {
    data: { user },
    error,
  } = await client.auth.getUser(accessToken);

  if (error || !user) {
    return unauthorized("Missing or invalid authorization token");
  }

  return { client, user: { id: user.id, email: user.email ?? undefined } };
}

/**
 * Type guard to check if requireAuth returned an error Response.
 */
export function isAuthError(result: AuthResult | Response): result is Response {
  return result instanceof Response;
}
