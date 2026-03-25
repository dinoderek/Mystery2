import { createClient } from "@supabase/supabase-js";
import fs from "fs/promises";
import path from "path";

import {
  buildImageUploadPlan,
  createImageManifest,
} from "./lib/blueprint-image-manifest.mjs";
import {
  formatResolvedLocalConfigPath,
  getBaseEnvPath,
  getBlueprintImagesDir,
  getBlueprintsDir,
} from "./local-config.mjs";
import { resolveApiUrl } from "./worktree-ports.mjs";

const ROOT_DIR = process.cwd();
const args = process.argv.slice(2);

function parseOptions() {
  const options = {
    seedMode: "always",
    seedImages: "skip",
    imageDir: getBlueprintImagesDir(ROOT_DIR),
    allowMissingImages: true,
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--if-missing") {
      options.seedMode = "if-missing";
      continue;
    }

    if (token === "--seed-images") {
      options.seedImages = "always";
      continue;
    }

    if (token === "--skip-seed-images") {
      options.seedImages = "skip";
      continue;
    }

    if (token === "--strict-images") {
      options.allowMissingImages = false;
      continue;
    }

    if (token === "--allow-missing-images") {
      options.allowMissingImages = true;
      continue;
    }

    if (token === "--image-dir") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --image-dir");
      }
      options.imageDir = path.isAbsolute(value)
        ? value
        : path.join(ROOT_DIR, value);
      index += 1;
      continue;
    }

    if (token.startsWith("--seed-images=")) {
      const mode = token.slice("--seed-images=".length);
      if (!["skip", "if-missing", "always"].includes(mode)) {
        throw new Error(`Invalid --seed-images value "${mode}"`);
      }
      options.seedImages = mode;
      continue;
    }

    if (token.startsWith("--image-dir=")) {
      const value = token.slice("--image-dir=".length);
      options.imageDir = path.isAbsolute(value)
        ? value
        : path.join(ROOT_DIR, value);
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return options;
}

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
  const envPath = getBaseEnvPath(ROOT_DIR, process.env);
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

function collectBlueprintSourceDirs() {
  return [
    getBlueprintsDir(ROOT_DIR),
    path.join(ROOT_DIR, "supabase/seed/blueprints"),
  ];
}

async function collectBlueprintFiles() {
  const files = [];

  for (const absoluteDir of collectBlueprintSourceDirs()) {
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

async function listHasAnyObject(client, bucketName) {
  const { data, error } = await client.storage.from(bucketName).list("", { limit: 1 });
  if (error) {
    throw new Error(`Unable to check bucket "${bucketName}": ${error.message}`);
  }
  return (data ?? []).length > 0;
}

async function listObjectNames(client, bucketName) {
  const { data, error } = await client.storage.from(bucketName).list("", {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) {
    throw new Error(`Unable to list bucket "${bucketName}": ${error.message}`);
  }

  return new Set((data ?? []).map((entry) => entry.name));
}

async function seedBlueprintJson(client, seedMode) {
  const blueprintFiles = await collectBlueprintFiles();

  if (blueprintFiles.length === 0) {
    throw new Error(
      "No blueprint JSON files found in /blueprints or /supabase/seed/blueprints.",
    );
  }

  const blueprints = [];
  let uploadedCount = 0;
  const existingObjectNames = seedMode === "if-missing"
    ? await listObjectNames(client, "blueprints")
    : null;

  if (seedMode === "if-missing" && existingObjectNames?.size) {
    console.log("Storage seed running in verify mode: existing blueprint objects will be left in place.");
  }

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
    if (existingObjectNames?.has(objectPath)) {
      blueprints.push(raw);
      continue;
    }

    const { error } = await client.storage.from("blueprints").upload(
      objectPath,
      text,
      {
        contentType: "application/json",
        upsert: true,
      },
    );

    if (error) {
      throw new Error(
        `Error uploading ${path.relative(ROOT_DIR, filePath)} -> ${objectPath}: ${error.message}`,
      );
    }

    blueprints.push(raw);
    uploadedCount += 1;
  }

  return { uploadedCount, blueprints };
}

async function syncBlueprintImages(client, blueprints, options) {
  if (options.seedImages === "skip") {
    return {
      attempted: 0,
      uploaded: 0,
      missing: 0,
      failed: 0,
      warnings: [],
    };
  }

  if (options.seedImages === "if-missing") {
    const hasImages = await listHasAnyObject(client, "blueprint-images");
    if (hasImages) {
      console.log("Image seed skipped: blueprint-images bucket already contains objects.");
      return {
        attempted: 0,
        uploaded: 0,
        missing: 0,
        failed: 0,
        warnings: [],
      };
    }
  }

  const uploadResults = [];

  for (const blueprint of blueprints) {
    const plan = await buildImageUploadPlan(blueprint, options.imageDir);

    for (const item of plan) {
      if (!item.localPath) {
        uploadResults.push({ imageId: item.imageId, status: "missing" });
        continue;
      }

      try {
        const bytes = await fs.readFile(item.localPath);
        const ext = path.extname(item.localPath).toLowerCase();
        const contentType = ext === ".webp"
          ? "image/webp"
          : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : "image/png";

        const { error } = await client.storage.from("blueprint-images").upload(
          item.storageKey,
          bytes,
          {
            contentType,
            upsert: true,
          },
        );

        if (error) {
          uploadResults.push({
            imageId: item.imageId,
            status: "failed",
            error: error.message,
          });
          continue;
        }

        uploadResults.push({ imageId: item.imageId, status: "uploaded" });
      } catch (error) {
        uploadResults.push({
          imageId: item.imageId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const manifest = createImageManifest(uploadResults);

  if (!options.allowMissingImages && (manifest.missing > 0 || manifest.failed > 0)) {
    throw new Error(
      `Image sync failed strict policy: missing=${manifest.missing}, failed=${manifest.failed}`,
    );
  }

  return manifest;
}

await loadDotEnvLocal();

const { seedMode, seedImages, imageDir, allowMissingImages } = parseOptions();
const supabaseUrl = process.env.API_URL || resolveApiUrl();
const supabaseKey = process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error(
    `Missing SERVICE_ROLE_KEY (expected in env or ${formatResolvedLocalConfigPath(ROOT_DIR, getBaseEnvPath(ROOT_DIR, process.env))})`,
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

try {
  const { uploadedCount, blueprints } = await seedBlueprintJson(supabase, seedMode);
  const imageManifest = await syncBlueprintImages(supabase, blueprints, {
    seedImages,
    imageDir,
    allowMissingImages,
  });

  console.log(
    `Successfully seeded ${uploadedCount} blueprint(s) into storage from /blueprints and /supabase/seed/blueprints.`,
  );
  console.log(
    `Image sync manifest: attempted=${imageManifest.attempted}, uploaded=${imageManifest.uploaded}, missing=${imageManifest.missing}, failed=${imageManifest.failed}`,
  );
  if (imageManifest.warnings.length > 0) {
    for (const warning of imageManifest.warnings) {
      console.warn(`[WARN] ${warning}`);
    }
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
