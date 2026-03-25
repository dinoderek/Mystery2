const IMAGE_FILENAME_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:png|jpe?g|webp)$/i;

export const BLUEPRINT_IMAGES_BUCKET = "blueprint-images";
export const IMAGE_LINK_TTL_SECONDS = 120;

export function isCanonicalImageId(value: unknown): value is string {
  return typeof value === "string" && IMAGE_FILENAME_PATTERN.test(value);
}

export function ensureCanonicalImageId(value: unknown): string | null {
  if (isCanonicalImageId(value)) {
    return value;
  }
  return null;
}

export function normalizeSignedUrlExpiry(
  issuedAtMs = Date.now(),
  ttlSeconds = IMAGE_LINK_TTL_SECONDS,
): string {
  return new Date(issuedAtMs + ttlSeconds * 1000).toISOString();
}

export function isExpiryWindowValid(
  expiresAtIso: string,
  nowMs = Date.now(),
  ttlSeconds = IMAGE_LINK_TTL_SECONDS,
): boolean {
  const expiresAtMs = Date.parse(expiresAtIso);
  if (!Number.isFinite(expiresAtMs)) return false;

  const deltaMs = expiresAtMs - nowMs;
  if (deltaMs <= 0) return false;

  return deltaMs <= ttlSeconds * 1000 + 5000;
}

export function buildImageStorageKey(
  blueprintId: string,
  imageFilename: string,
): string {
  return `${blueprintId}/${imageFilename}`;
}
