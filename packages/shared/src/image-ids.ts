// The filename a case's image goes by when the case file names none.
//
// A committed case carries no image ids: its art sits in the images directory
// under these names, and the engine fills them in when it loads the case. The
// image generator writes them for a committed case.

export type ImageTargetType = "blueprint" | "character" | "location";

/**
 * `<case id>.blueprint.png` for the cover, `<case id>.character-<id>.png` for a
 * portrait and `<case id>.location-<id>.png` for a location, where the case id
 * is the case file's `metadata.id`.
 */
export function conventionalImageId(caseId: string, targetType: ImageTargetType, targetKey: string | null = null): string {
  return targetType === "blueprint" ? `${caseId}.blueprint.png` : `${caseId}.${targetType}-${targetKey}.png`;
}
