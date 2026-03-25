import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildImageUploadPlan,
  collectBlueprintImageReferences,
  createImageManifest,
} from "../../../scripts/lib/blueprint-image-manifest.mjs";
import {
  buildImageStorageKey,
  isCanonicalImageId,
} from "../../../supabase/functions/_shared/images.ts";

const blueprint = {
  schema_version: "v2",
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    image_id: "mock-blueprint.blueprint.png",
  },
  world: {
    locations: [
      {
        id: "loc_kitchen",
        name: "Kitchen",
        location_image_id: "mock-blueprint.location-loc-kitchen.png",
      },
    ],
    characters: [
      {
        id: "char_alice",
        first_name: "Alice",
        portrait_image_id: "mock-blueprint.character-char-alice.png",
      },
    ],
  },
};

describe("blueprint image manifest helpers", () => {
  it("collects image references using V2 id-based keys", () => {
    const refs = collectBlueprintImageReferences(blueprint);
    expect(refs).toHaveLength(3);
    expect(refs.map((entry: { purpose: string }) => entry.purpose)).toEqual([
      "blueprint_cover",
      "location_scene",
      "character_portrait",
    ]);
    expect(refs[1].targetKey).toBe("loc_kitchen");
    expect(refs[2].targetKey).toBe("char_alice");
  });

  it("builds upload plan by resolving local files and summarizes manifest counts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-manifest-"));
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      path.join(tmpDir, "mock-blueprint.blueprint.png"),
      Buffer.from([0, 1, 2]),
    );

    const plan = await buildImageUploadPlan(blueprint, tmpDir);
    expect(plan).toHaveLength(3);
    expect(plan[0].localPath).toContain(".png");
    expect(plan[0].storageKey).toBe(
      "123e4567-e89b-12d3-a456-426614174000/mock-blueprint.blueprint.png",
    );
    expect(plan[1].localPath).toBeNull();
    expect(plan[2].localPath).toBeNull();

    const manifest = createImageManifest([
      { imageFilename: plan[0].imageFilename, status: "uploaded" },
      { imageFilename: plan[1].imageFilename, status: "missing" },
      { imageFilename: plan[2].imageFilename, status: "failed", error: "boom" },
    ]);

    expect(manifest).toMatchObject({
      attempted: 3,
      uploaded: 1,
      missing: 1,
      failed: 1,
    });
    expect(manifest.warnings.length).toBe(2);
  });

  it("seed upload keys match the serving edge function's buildImageStorageKey", async () => {
    const plan = await buildImageUploadPlan(blueprint, "/nonexistent");

    for (const item of plan) {
      // The edge function builds a storage key from (blueprintId, imageId).
      // The seed script uploads to item.storageKey.
      // These MUST be identical or serving will 404.
      const edgeKey = buildImageStorageKey(blueprint.id, item.imageFilename);
      expect(item.storageKey).toBe(edgeKey);
    }
  });

  it("all image IDs from the upload plan pass canonical validation", async () => {
    const plan = await buildImageUploadPlan(blueprint, "/nonexistent");

    for (const item of plan) {
      expect(
        isCanonicalImageId(item.imageFilename),
        `"${item.imageFilename}" rejected by isCanonicalImageId`,
      ).toBe(true);
    }
  });
});
