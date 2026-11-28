// The filename a case's image goes by when the case file names none.
//
// A committed case names no image ids, or only these: its art sits in the
// images directory under these names, and the engine fills in any id a case
// does not name. The image generator writes them for a committed case.

export type ImageTargetType = "blueprint" | "character" | "location";

// `<name>.<name>.<png|jpg|jpeg|webp>`, each name letters, digits, hyphens and
// underscores, starting with a letter or digit. That admits every id
// `conventionalImageId` makes from a snake_case location or character id, and
// keeps a filename inside the images directory: no slash, no `..`, no leading
// dot.
const IMAGE_ID_PATTERN =
  /^[a-z0-9][a-z0-9_-]*\.[a-z0-9][a-z0-9_-]*\.(?:png|jpe?g|webp)$/i;

/** Whether the value is a filename the image route will serve. */
export function isCanonicalImageId(value: unknown): value is string {
  return typeof value === "string" && IMAGE_ID_PATTERN.test(value);
}

/**
 * `<case id>.blueprint.png` for the cover, `<case id>.character-<id>.png` for a
 * portrait and `<case id>.location-<id>.png` for a location, where the case id
 * is the case file's `metadata.id`.
 */
export function conventionalImageId(caseId: string, targetType: ImageTargetType, targetKey: string | null = null): string {
  return targetType === "blueprint" ? `${caseId}.blueprint.png` : `${caseId}.${targetType}-${targetKey}.png`;
}

/**
 * The compressed copy of an image: the same name with a `.webp` extension,
 * kept beside the original, which stays the lossless master. The generator
 * writes it, and the game serves it in the original's place while it is not
 * older than the original.
 */
export function compressedImageFilename(imageFilename: string): string {
  return imageFilename.replace(/\.[^.]+$/u, ".webp");
}
