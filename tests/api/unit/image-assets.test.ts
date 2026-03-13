import { describe, expect, it } from "vitest";

import {
  buildImageStorageCandidates,
  buildImageStorageKey,
  ensureCanonicalImageId,
  IMAGE_LINK_TTL_SECONDS,
  isCanonicalImageId,
  isExpiryWindowValid,
  normalizeSignedUrlExpiry,
} from "../../../supabase/functions/_shared/images.ts";

const CANONICAL_ID = "mock-blueprint-123e4567-e89b-12d3-a456-426614174111";

describe("image helper utilities", () => {
  it("accepts canonical image ids and rejects invalid shapes", () => {
    expect(isCanonicalImageId(CANONICAL_ID)).toBe(true);
    expect(isCanonicalImageId("not-valid")).toBe(false);
    expect(ensureCanonicalImageId(CANONICAL_ID)).toBe(CANONICAL_ID);
    expect(ensureCanonicalImageId("bad-id")).toBeNull();
  });

  it("creates expected storage keys and extension candidates", () => {
    expect(
      buildImageStorageKey(
        "123e4567-e89b-12d3-a456-426614174000",
        CANONICAL_ID,
        "png",
      ),
    ).toBe(
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_ID}.png`,
    );

    expect(
      buildImageStorageCandidates(
        "123e4567-e89b-12d3-a456-426614174000",
        CANONICAL_ID,
      ),
    ).toEqual([
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_ID}.png`,
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_ID}.jpg`,
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_ID}.jpeg`,
      `123e4567-e89b-12d3-a456-426614174000/${CANONICAL_ID}.webp`,
    ]);
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
