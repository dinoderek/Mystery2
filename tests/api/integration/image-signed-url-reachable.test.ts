import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs/promises";
import path from "node:path";

import {
  API_URL,
  SUPABASE_URL,
  ensureMockBlueprintSeeded,
  MOCK_BLUEPRINT_ID,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

const SERVICE_ROLE_KEY =
  process.env.SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

// Minimal valid 1x1 transparent PNG
const STUB_PNG = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1,
  0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 10, 73, 68, 65, 84,
  120, 156, 98, 0, 0, 0, 2, 0, 1, 226, 33, 188, 51, 0, 0, 0, 0, 73, 69, 78,
  68, 174, 66, 96, 130,
]);

describe("signed image URL is reachable from outside Docker", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("image-url-reachable");
    await ensureMockBlueprintSeeded();
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("returns a signed URL whose origin is the public Supabase host, and the URL resolves to image bytes", async () => {
    const blueprintPath = path.resolve(
      process.cwd(),
      "supabase/seed/blueprints/mock-blueprint.json",
    );
    const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf-8"));
    const imageId: string = blueprint.metadata.image_id;

    // Upload a stub image so the signed URL has something to serve
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const storageKey = `${blueprint.id}/${imageId}`;
    await admin.storage.from("blueprint-images").upload(storageKey, STUB_PNG, {
      contentType: "image/png",
      upsert: true,
    });

    // Request a signed URL via the edge function
    const res = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        image_id: imageId,
        purpose: "blueprint_cover",
      }),
    });
    expect(res.status).toBe(200);

    const body = await res.json();
    const signedUrl: string = body.signed_url;

    // The edge function returns a relative path (no origin)
    expect(signedUrl).toMatch(/^\/storage\/v1\//);
    expect(signedUrl).not.toContain("kong:");
    expect(signedUrl).not.toContain("supabase_edge_runtime");
    expect(signedUrl).toContain("token=");

    // Reconstruct the full URL the way the client does
    const fullUrl = `${SUPABASE_URL}${signedUrl}`;

    // The URL must actually be reachable and serve image bytes
    const imgRes = await fetch(fullUrl);
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get("content-type")).toContain("image/png");
    const imgBytes = new Uint8Array(await imgRes.arrayBuffer());
    expect(imgBytes.length).toBeGreaterThan(0);
  }, 15_000);
});
