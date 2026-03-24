import fs from "node:fs/promises";
import path from "node:path";

function withReference(imageId, purpose, targetKey = null) {
  if (!imageId || typeof imageId !== "string") return null;
  return { imageId, purpose, targetKey };
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

async function findFirstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Keep trying candidates.
    }
  }
  return null;
}

const IMAGE_EXTENSIONS = [".png", ".jpg", ".jpeg", ".webp"];

async function findImageFile(imageDir, imageId) {
  // Try direct <imageId>.<ext> first (legacy naming).
  const directCandidates = IMAGE_EXTENSIONS.map(
    (ext) => path.join(imageDir, `${imageId}${ext}`),
  );
  const direct = await findFirstExistingPath(directCandidates);
  if (direct) return direct;

  // Try <prefix>.<imageId>.<ext> naming (new pattern).
  try {
    const entries = await fs.readdir(imageDir);
    for (const ext of IMAGE_EXTENSIONS) {
      const suffix = `.${imageId}${ext}`;
      const match = entries.find((entry) => entry.endsWith(suffix));
      if (match) return path.join(imageDir, match);
    }
  } catch {
    // Directory may not exist.
  }

  return null;
}

export async function buildImageUploadPlan(blueprint, imageDir) {
  const refs = collectBlueprintImageReferences(blueprint);
  const uploads = [];

  for (const ref of refs) {
    const localPath = await findImageFile(imageDir, ref.imageId);

    uploads.push({
      ...ref,
      localPath,
      storageKey: `${blueprint.id}/${ref.imageId}${localPath ? path.extname(localPath) : ".png"}`,
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
      manifest.warnings.push(`Missing local image for ${item.imageId}`);
      continue;
    }
    manifest.failed += 1;
    manifest.warnings.push(
      `Failed upload for ${item.imageId}: ${item.error ?? "unknown error"}`,
    );
  }

  return manifest;
}
