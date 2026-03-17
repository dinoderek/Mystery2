import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  buildImageUploadPlan,
  collectBlueprintImageReferences,
  createImageManifest,
} from "../../../scripts/lib/blueprint-image-manifest.mjs";

const blueprint = {
  id: "123e4567-e89b-12d3-a456-426614174000",
  metadata: {
    image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614174111",
  },
  world: {
    locations: [
      {
        location_key: "kitchen",
        location_image_id: "mock-location-kitchen-123e4567-e89b-12d3-a456-426614174222",
      },
    ],
    characters: [
      {
        character_key: "alice",
        portrait_image_id: "mock-character-alice-123e4567-e89b-12d3-a456-426614174333",
      },
    ],
  },
};

describe("blueprint image manifest helpers", () => {
  it("collects image references from blueprint metadata, locations, and characters", () => {
    const refs = collectBlueprintImageReferences(blueprint);
    expect(refs).toHaveLength(3);
    expect(refs.map((entry: { purpose: string }) => entry.purpose)).toEqual([
      "blueprint_cover",
      "location_scene",
      "character_portrait",
    ]);
  });

  it("builds upload plan by resolving local files and summarizes manifest counts", async () => {
    const tmpDir = await mkdtemp(path.join(os.tmpdir(), "image-manifest-"));
    await mkdir(tmpDir, { recursive: true });
    await writeFile(
      path.join(tmpDir, "mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png"),
      Buffer.from([0, 1, 2]),
    );

    const plan = await buildImageUploadPlan(blueprint, tmpDir);
    expect(plan).toHaveLength(3);
    expect(plan[0].localPath).toContain(".png");
    expect(plan[1].localPath).toBeNull();
    expect(plan[2].localPath).toBeNull();

    const manifest = createImageManifest([
      { imageId: plan[0].imageId, status: "uploaded" },
      { imageId: plan[1].imageId, status: "missing" },
      { imageId: plan[2].imageId, status: "failed", error: "boom" },
    ]);

    expect(manifest).toMatchObject({
      attempted: 3,
      uploaded: 1,
      missing: 1,
      failed: 1,
    });
    expect(manifest.warnings.length).toBe(2);
  });
});
