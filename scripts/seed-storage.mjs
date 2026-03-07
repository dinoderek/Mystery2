import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

const ROOT_DIR = process.cwd();
const SOURCE_DIRS = ["blueprints", "supabase/seed/blueprints"];

function parseEnvLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return null;
  const firstEq = trimmed.indexOf("=");
  if (firstEq === -1) return null;

  const key = trimmed.slice(0, firstEq).trim();
  if (!key) return null;

  let value = trimmed.slice(firstEq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

async function loadDotEnvLocal() {
  const envPath = path.join(ROOT_DIR, ".env.local");
  let contents;
  try {
    contents = await fs.readFile(envPath, "utf-8");
  } catch {
    return;
  }

  for (const line of contents.split(/\r?\n/u)) {
    const parsed = parseEnvLine(line);
    if (!parsed) continue;
    const [key, value] = parsed;
    if (!process.env[key]) process.env[key] = value;
  }
}

async function collectBlueprintFiles() {
  const files = [];

  for (const relativeDir of SOURCE_DIRS) {
    const absoluteDir = path.join(ROOT_DIR, relativeDir);
    let entries;
    try {
      entries = await fs.readdir(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".json")) continue;
      files.push(path.join(absoluteDir, entry.name));
    }
  }

  return files;
}

await loadDotEnvLocal();

const supabaseUrl = process.env.API_URL || "http://127.0.0.1:54331";
const supabaseKey = process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SERVICE_ROLE_KEY (expected in env or .env.local)");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);
const blueprintFiles = await collectBlueprintFiles();

if (blueprintFiles.length === 0) {
  console.error(
    "No blueprint JSON files found in /blueprints or /supabase/seed/blueprints.",
  );
  process.exit(1);
}

let uploadedCount = 0;
for (const filePath of blueprintFiles) {
  const text = await fs.readFile(filePath, "utf-8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    console.error(`Skipping invalid JSON file: ${path.relative(ROOT_DIR, filePath)}`);
    continue;
  }

  if (!raw || typeof raw.id !== "string" || raw.id.length === 0) {
    console.error(
      `Skipping file missing blueprint id: ${path.relative(ROOT_DIR, filePath)}`,
    );
    continue;
  }

  const objectPath = `${raw.id}.json`;
  const { error } = await supabase.storage.from("blueprints").upload(
    objectPath,
    text,
    {
      contentType: "application/json",
      upsert: true,
    },
  );

  if (error) {
    console.error(
      `Error uploading ${path.relative(ROOT_DIR, filePath)} -> ${objectPath}: ${error.message}`,
    );
    process.exit(1);
  }

  uploadedCount += 1;
}

console.log(
  `Successfully seeded ${uploadedCount} blueprint(s) into storage from /blueprints and /supabase/seed/blueprints.`,
);
