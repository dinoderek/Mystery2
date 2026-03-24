import { createClient } from "npm:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL") || "http://127.0.0.1:54331";
const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const sourceDirs = ["blueprints", "supabase/seed/blueprints"];

const args = Deno.args;
const seedImages = args.includes("--seed-images") ||
  args.some((arg) => arg === "--seed-images=always");
const strictImages = args.includes("--strict-images");

function getImageDirArg() {
  const inline = args.find((arg) => arg.startsWith("--image-dir="));
  if (inline) return inline.slice("--image-dir=".length);
  const index = args.indexOf("--image-dir");
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return "generated/blueprint-images";
}

const imageDir = getImageDirArg();

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  Deno.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

interface BlueprintRef {
  id: string;
  schema_version?: string;
  metadata?: { image_id?: string };
  world?: {
    locations?: Array<{ id: string; location_image_id?: string }>;
    characters?: Array<{ id: string; portrait_image_id?: string }>;
  };
}

function imageRefs(blueprint: BlueprintRef): string[] {
  const refs: string[] = [];
  if (blueprint.metadata?.image_id) refs.push(blueprint.metadata.image_id);
  for (const location of blueprint.world?.locations ?? []) {
    if (location.location_image_id) refs.push(location.location_image_id);
  }
  for (const character of blueprint.world?.characters ?? []) {
    if (character.portrait_image_id) refs.push(character.portrait_image_id);
  }
  return refs;
}

async function readFirstExistingImagePath(imageId: string): Promise<string | null> {
  const candidates = [".png", ".jpg", ".jpeg", ".webp"].map((ext) => `${imageDir}/${imageId}${ext}`);
  for (const candidate of candidates) {
    try {
      await Deno.stat(candidate);
      return candidate;
    } catch {
      // Continue.
    }
  }
  return null;
}

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
const blueprints: BlueprintRef[] = [];
for (const filePath of jsonFiles) {
  const text = await Deno.readTextFile(filePath);

  let raw: BlueprintRef;
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
  blueprints.push(raw);
  uploaded += 1;
}

let attemptedImages = 0;
let uploadedImages = 0;
let missingImages = 0;
let failedImages = 0;

if (seedImages) {
  for (const blueprint of blueprints) {
    for (const imageId of imageRefs(blueprint)) {
      attemptedImages += 1;
      const localPath = await readFirstExistingImagePath(imageId);
      if (!localPath) {
        missingImages += 1;
        console.warn(`[WARN] Missing local image for ${imageId}`);
        continue;
      }

      try {
        const bytes = await Deno.readFile(localPath);
        const ext = localPath.slice(localPath.lastIndexOf("."));
        const contentType = ext === ".webp"
          ? "image/webp"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "image/png";

        const { error } = await supabase.storage
          .from("blueprint-images")
          .upload(`${blueprint.id}/${imageId}${ext}`, bytes, {
            contentType,
            upsert: true,
          });

        if (error) {
          failedImages += 1;
          console.warn(`[WARN] Failed upload for ${imageId}: ${error.message}`);
          continue;
        }

        uploadedImages += 1;
      } catch (error) {
        failedImages += 1;
        console.warn(`[WARN] Failed upload for ${imageId}: ${String(error)}`);
      }
    }
  }
}

if (strictImages && (missingImages > 0 || failedImages > 0)) {
  console.error(
    `Image sync failed strict policy: missing=${missingImages}, failed=${failedImages}`,
  );
  Deno.exit(1);
}

console.log(
  `Successfully seeded ${uploaded} blueprint(s) into storage from /blueprints and /supabase/seed/blueprints.`,
);
console.log(
  `Image sync manifest: attempted=${attemptedImages}, uploaded=${uploadedImages}, missing=${missingImages}, failed=${failedImages}`,
);
