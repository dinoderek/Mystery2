import { describe, expect, it } from "vitest";

import {
  buildImageStorageKey,
  ensureCanonicalImageId,
  IMAGE_LINK_TTL_SECONDS,
  isCanonicalImageId,
  isExpiryWindowValid,
  normalizeSignedUrlExpiry,
} from "../../../supabase/functions/_shared/images.ts";

const CANONICAL_FILENAME =
  "mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png";

describe("image helper utilities", () => {
  it("accepts canonical image filenames and rejects invalid shapes", () => {
    expect(isCanonicalImageId(CANONICAL_FILENAME)).toBe(true);
    expect(isCanonicalImageId("not-valid")).toBe(false);
    expect(isCanonicalImageId("missing-ext-123e4567-e89b-12d3-a456-426614174111")).toBe(false);
    expect(ensureCanonicalImageId(CANONICAL_FILENAME)).toBe(CANONICAL_FILENAME);
    expect(ensureCanonicalImageId("bad-id")).toBeNull();
  });

  it("creates expected storage key from blueprint id and image filename", () => {
    expect(
      buildImageStorageKey(
        "123e4567-e89b-12d3-a456-426614174000",
        CANONICAL_FILENAME,
      ),
    ).toBe(
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_FILENAME}`,
    );
  });

  it("normalizes expiry timestamps and validates window bounds", () => {
    const nowMs = Date.UTC(2030, 0, 1, 0, 0, 0);
    const expiresAt = normalizeSignedUrlExpiry(nowMs, IMAGE_LINK_TTL_SECONDS);
    const expiresMs = Date.parse(expiresAt);

    expect(expiresMs).toBe(nowMs + IMAGE_LINK_TTL_SECONDS * 1000);
    expect(isExpiryWindowValid(expiresAt, nowMs, IMAGE_LINK_TTL_SECONDS)).toBe(
      true,
    );
    expect(
      isExpiryWindowValid(
        new Date(nowMs - 1000).toISOString(),
        nowMs,
        IMAGE_LINK_TTL_SECONDS,
      ),
    ).toBe(false);
  });
});
