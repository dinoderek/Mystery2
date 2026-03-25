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
import { loadEnvFile } from "./supabase-utils.mjs";
import { resolveWorktreePorts } from "./worktree-ports.mjs";

const ROOT_DIR = process.cwd();

function parseOptions() {
  const options = {
    seedImages: true,
    imageDir: getBlueprintImagesDir(ROOT_DIR),
    allowMissingImages: true,
  };

  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--seed-images" || token === "--seed-images=always") {
      options.seedImages = true;
      continue;
    }
    if (token === "--skip-seed-images") {
      options.seedImages = false;
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

async function seedBlueprintJson(client) {
  const blueprintFiles = await collectBlueprintFiles();

  if (blueprintFiles.length === 0) {
    throw new Error(
      "No blueprint JSON files found in /blueprints or /supabase/seed/blueprints.",
    );
  }

  const blueprints = [];
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
  if (!options.seedImages) {
    return { attempted: 0, uploaded: 0, missing: 0, failed: 0, warnings: [] };
  }

  const uploadResults = [];

  for (const blueprint of blueprints) {
    const plan = await buildImageUploadPlan(blueprint, options.imageDir);

    for (const item of plan) {
      if (!item.localPath) {
        uploadResults.push({ imageFilename: item.imageFilename, status: "missing" });
        continue;
      }

      try {
        const bytes = await fs.readFile(item.localPath);
        const { error } = await client.storage.from("blueprint-images").upload(
          item.storageKey,
          bytes,
          { contentType: "image/png", upsert: true },
        );

        if (error) {
          uploadResults.push({
            imageFilename: item.imageFilename,
            status: "failed",
            error: error.message,
          });
          continue;
        }

        uploadResults.push({ imageFilename: item.imageFilename, status: "uploaded" });
      } catch (error) {
        uploadResults.push({
          imageFilename: item.imageFilename,
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

const baseEnvPath = getBaseEnvPath(ROOT_DIR, process.env);
const baseEnv = await loadEnvFile(baseEnvPath, false);
for (const [key, value] of Object.entries(baseEnv)) {
  if (!process.env[key]) process.env[key] = value;
}

const { seedImages, imageDir, allowMissingImages } = parseOptions();
const resolved = resolveWorktreePorts();
const worktreeApiUrl = `http://127.0.0.1:${resolved.ports.api}`;
const supabaseUrl = resolved.isWorktree ? worktreeApiUrl : (process.env.API_URL || worktreeApiUrl);
const supabaseKey = process.env.SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error(
    `Missing SERVICE_ROLE_KEY (expected in env or ${formatResolvedLocalConfigPath(ROOT_DIR, baseEnvPath)})`,
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

try {
  const { uploadedCount, blueprints } = await seedBlueprintJson(supabase);
  const imageManifest = await syncBlueprintImages(supabase, blueprints, {
    seedImages,
    imageDir,
    allowMissingImages,
  });

  console.log(
    `Upserted ${uploadedCount} blueprint(s) into storage.`,
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
