const IMAGE_ID_PATTERN =
  /^[a-z0-9]+(?:-[a-z0-9]+)*-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const BLUEPRINT_IMAGES_BUCKET = "blueprint-images";
export const IMAGE_LINK_TTL_SECONDS = 120;

export function isCanonicalImageId(value: unknown): value is string {
  return typeof value === "string" && IMAGE_ID_PATTERN.test(value);
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
  imageId: string,
  extension = "png",
): string {
  const safeExt = extension.replace(/^\./u, "").toLowerCase();
  return `${blueprintId}/${imageId}.${safeExt}`;
}

export function buildImageStorageCandidates(
  blueprintId: string,
  imageId: string,
): string[] {
  return ["png", "jpg", "jpeg", "webp"].map((ext) =>
    buildImageStorageKey(blueprintId, imageId, ext)
  );
}
