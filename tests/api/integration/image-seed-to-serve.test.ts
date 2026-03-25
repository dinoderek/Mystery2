import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

import {
  API_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";
import { buildImageUploadPlan } from "../../../scripts/lib/blueprint-image-manifest.mjs";
import { buildImageStorageKey } from "../../../supabase/functions/_shared/images.ts";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54331";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Minimal valid PNG (1x1 pixel, transparent)
const STUB_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
  0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
  137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 98, 0, 0, 0, 2,
  0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66,
  96, 130,
]);

describe("image seed-to-serve contract", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("image-seed-serve");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("serves images uploaded with the same storage key the seed script computes", async () => {
    const blueprintPath = path.resolve(
      process.cwd(),
      "supabase/seed/blueprints/mock-blueprint.json",
    );
    const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf-8"));

    // 1. Compute upload plan the same way seed-storage.mjs does.
    //    Use a non-existent dir so localPath is null (we don't need real files).
    const plan = await buildImageUploadPlan(blueprint, "/nonexistent");

    // Sanity: plan should reference all images from the fixture
    expect(plan.length).toBeGreaterThanOrEqual(3); // cover + locations + characters

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 2. Upload a stub PNG to each storage key from the plan.
    for (const item of plan) {
      const { error } = await admin.storage
        .from("blueprint-images")
        .upload(item.storageKey, STUB_PNG, {
          contentType: "image/png",
          upsert: true,
        });
      expect(error, `upload failed for ${item.storageKey}: ${error?.message}`).toBeNull();
    }

    // 3. For each image ref, verify the edge function resolves a signed URL.
    //    This proves the storage key from the seed script matches what the
    //    edge function builds via buildImageStorageKey().
    const purposes: Record<string, string> = {
      blueprint_cover: blueprint.metadata.image_id,
      location_scene: blueprint.world.locations[0].location_image_id,
      character_portrait: blueprint.world.characters[0].portrait_image_id,
    };

    for (const [purpose, imageId] of Object.entries(purposes)) {
      // Verify the storage key the edge function would build matches the plan
      const edgeKey = buildImageStorageKey(blueprint.id, imageId);
      const planItem = plan.find(
        (p: { storageKey: string }) => p.storageKey === edgeKey,
      );
      expect(
        planItem,
        `Storage key mismatch: edge function would look for "${edgeKey}" but seed plan has: ${plan.map((p: { storageKey: string }) => p.storageKey).join(", ")}`,
      ).toBeDefined();

      // Hit the real edge function
      const res = await fetch(`${API_URL}/blueprint-image-link`, {
        method: "POST",
        headers: auth.headers,
        body: JSON.stringify({
          blueprint_id: MOCK_BLUEPRINT_ID,
          image_id: imageId,
          purpose,
        }),
      });

      expect(res.status, `${purpose} (${imageId}) returned ${res.status}`).toBe(200);
      const body = await res.json();
      expect(body.image_id).toBe(imageId);
      expect(body.signed_url).toBeTruthy();
      expect(body.signed_url).toContain("token=");
    }
  }, 15_000);
});
