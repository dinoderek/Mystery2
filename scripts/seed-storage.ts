import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54331";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sourceDirs = ["blueprints", "supabase/seed/blueprints"];

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const jsonFiles: string[] = [];
for (const dir of sourceDirs) {
  try {
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.isFile) continue;
      if (!entry.name.endsWith(".json")) continue;
      jsonFiles.push(`${dir}/${entry.name}`);
    }
  } catch {
    // Ignore missing directory in partial setups
  }
}

if (jsonFiles.length === 0) {
  console.error(
    "No blueprint JSON files found in /blueprints or /supabase/seed/blueprints.",
  );
  Deno.exit(1);
}

let uploaded = 0;
for (const filePath of jsonFiles) {
  const text = await Deno.readTextFile(filePath);

  let raw: { id?: unknown };
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`Skipping invalid JSON file: ${filePath}`);
    continue;
  }

  if (typeof raw.id !== "string" || raw.id.length === 0) {
    console.error(`Skipping file missing blueprint id: ${filePath}`);
    continue;
  }

  const { error } = await supabase.storage
    .from("blueprints")
    .upload(`${raw.id}.json`, text, {
      contentType: "application/json",
      upsert: true,
    });

  if (error) {
    console.error(`Error uploading ${filePath}:`, error.message);
    Deno.exit(1);
  }
  uploaded += 1;
}

console.log(
  `Successfully seeded ${uploaded} blueprint(s) into storage from /blueprints and /supabase/seed/blueprints.`,
);
