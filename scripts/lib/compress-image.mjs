// Compressed copies of blueprint artwork.
//
// The image model returns multi-megabyte PNGs, slow to load over a phone's
// WiFi or Tailscale. Each one gets a WebP beside it, at full size: the game
// serves the WebP in the PNG's place (`resolveImageFile` in the engine), and
// the PNG stays the lossless master that later images take as references.

import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { compressedImageFilename } from "../../packages/shared/src/image-ids.ts";

/** Visually lossless for illustrations, about a twelfth of the PNG's size. */
export const WEBP_QUALITY = 82;

/** Writes `<name>.webp` beside an image and returns its path. Throws when the image cannot be decoded. */
export async function compressImageFile(imagePath) {
  const outputPath = path.join(path.dirname(imagePath), compressedImageFilename(path.basename(imagePath)));
  await sharp(imagePath).webp({ quality: WEBP_QUALITY }).toFile(outputPath);
  return outputPath;
}

async function mtimeOf(filePath) {
  try {
    return (await fs.stat(filePath)).mtimeMs;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

/**
 * Compresses every PNG in a directory whose WebP is missing or older than it.
 * Returns what it wrote and what failed; one bad file does not stop the rest.
 */
export async function compressImagesInDir(dir) {
  const names = (await fs.readdir(dir)).filter((name) => name.toLowerCase().endsWith(".png")).sort();
  const compressed = [];
  const failed = [];
  for (const name of names) {
    const source = path.join(dir, name);
    const webpTime = await mtimeOf(path.join(dir, compressedImageFilename(name)));
    if (webpTime !== null && webpTime >= (await mtimeOf(source))) continue;
    try {
      const output = await compressImageFile(source);
      compressed.push({ source, output, before: (await fs.stat(source)).size, after: (await fs.stat(output)).size });
    } catch (error) {
      failed.push({ source, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { compressed, failed };
}
