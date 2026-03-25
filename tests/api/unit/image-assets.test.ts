import { describe, expect, it } from "vitest";

import {
  buildImageStorageKey,
  ensureCanonicalImageId,
  IMAGE_LINK_TTL_SECONDS,
  isCanonicalImageId,
  isExpiryWindowValid,
  normalizeSignedUrlExpiry,
} from "../../../supabase/functions/_shared/images.ts";
import { createImageId } from "../../../scripts/lib/image-prompt-builder.mjs";

const CANONICAL_FILENAME =
  "mock-blueprint.blueprint.png";

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

  it("generated image IDs pass canonical validation when .png extension is appended", () => {
    const cases = [
      { name: "The Missing Insignia", type: "blueprint", key: null },
      { name: "The Missing Insignia", type: "location", key: "school-library-e6440f7f-e44a-4ba3-baa3-0d503bb65369" },
      { name: "The Missing Insignia", type: "character", key: "detective-jane-abc12345-1234-1234-1234-123456789abc" },
      { name: "Mock Blueprint", type: "blueprint", key: null },
      { name: "Mock Blueprint", type: "character", key: "char-alice" },
    ];

    for (const { name, type, key } of cases) {
      const baseId = createImageId(name, type, key);
      const imageId = `${baseId}.png`;
      expect(
        isCanonicalImageId(imageId),
        `"${imageId}" (from name="${name}", type="${type}", key="${key}") rejected by isCanonicalImageId`,
      ).toBe(true);
    }
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
