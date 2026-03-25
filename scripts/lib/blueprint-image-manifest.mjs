import fs from "node:fs/promises";
import path from "node:path";

function withReference(imageFilename, purpose, targetKey = null) {
  if (!imageFilename || typeof imageFilename !== "string") return null;
  return { imageFilename, purpose, targetKey };
}

export function collectBlueprintImageReferences(blueprint) {
  const refs = [];

  const cover = withReference(blueprint?.metadata?.image_id, "blueprint_cover");
  if (cover) refs.push(cover);

  for (const location of blueprint?.world?.locations ?? []) {
    const ref = withReference(
      location.location_image_id,
      "location_scene",
      location.id,
    );
    if (ref) refs.push(ref);
  }

  for (const character of blueprint?.world?.characters ?? []) {
    const ref = withReference(
      character.portrait_image_id,
      "character_portrait",
      character.id,
    );
    if (ref) refs.push(ref);
  }

  return refs;
}

export async function buildImageUploadPlan(blueprint, imageDir) {
  const refs = collectBlueprintImageReferences(blueprint);
  const uploads = [];

  for (const ref of refs) {
    const localPath = path.join(imageDir, ref.imageFilename);
    let exists = false;
    try {
      await fs.access(localPath);
      exists = true;
    } catch {
      // File not found locally.
    }

    uploads.push({
      ...ref,
      localPath: exists ? localPath : null,
      storageKey: `${blueprint.id}/${ref.imageFilename}`,
    });
  }

  return uploads;
}

export function createImageManifest(results) {
  const manifest = {
    attempted: 0,
    uploaded: 0,
    missing: 0,
    failed: 0,
    warnings: [],
  };

  for (const item of results) {
    manifest.attempted += 1;
    if (item.status === "uploaded") {
      manifest.uploaded += 1;
      continue;
    }
    if (item.status === "missing") {
      manifest.missing += 1;
      manifest.warnings.push(`Missing local image for ${item.imageFilename}`);
      continue;
    }
    manifest.failed += 1;
    manifest.warnings.push(
      `Failed upload for ${item.imageFilename}: ${item.error ?? "unknown error"}`,
    );
  }

  return manifest;
}
