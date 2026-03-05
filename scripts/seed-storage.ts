import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54331";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const content = await Deno.readFile(
  "supabase/seed/blueprints/mock-blueprint.json",
);
const { data, error } = await supabase.storage
  .from("blueprints")
  .upload("mock-blueprint.json", content, {
    contentType: "application/json",
    upsert: true,
  });

if (error) {
  console.error("Error uploading mock-blueprint.json:", error.message);
  Deno.exit(1);
}
console.log("Successfully seeded mock-blueprint.json into storage.");
