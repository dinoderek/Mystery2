import { createClient as createSupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

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
