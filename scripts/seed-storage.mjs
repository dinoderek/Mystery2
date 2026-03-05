import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";

const supabaseUrl = process.env.API_URL || "http://127.0.0.1:54331";
const supabaseKey = process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const text = await fs.readFile(
  "supabase/seed/blueprints/mock-blueprint.json",
  "utf-8",
);
const raw = JSON.parse(text);
const { data, error } = await supabase.storage
  .from("blueprints")
  .upload(`${raw.id}.json`, text, {
    contentType: "application/json",
    upsert: true,
  });

if (error) {
  console.error("Error uploading mock-blueprint.json:", error.message);
  process.exit(1);
}
console.log(`Successfully seeded ${raw.id}.json into storage.`);
