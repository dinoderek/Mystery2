import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  API_URL,
  ensureMockBlueprintSeeded,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./auth-helpers";

const SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:54331";
const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const BLUEPRINT_ID = "123e4567-e89b-12d3-a456-426614174000";
const COVER_IMAGE_ID = "mock-blueprint-123e4567-e89b-12d3-a456-426614174111.png";

describe("edge function auth rejection", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("auth-rejection");
    await ensureMockBlueprintSeeded();

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    const { error } = await admin.storage
      .from("blueprint-images")
      .upload(`${BLUEPRINT_ID}/${COVER_IMAGE_ID}.png`, bytes, {
        contentType: "image/png",
        upsert: true,
      });
    if (error) {
      throw new Error(`Failed to seed blueprint image fixture: ${error.message}`);
    }
  });

  afterEach(async () => {
    await auth.cleanup();
  });

  it("rejects missing or invalid tokens and accepts valid tokens", async () => {
    const missingStartRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    expect(missingStartRes.status).toBe(401);

    const missingBlueprintsRes = await fetch(`${API_URL}/blueprints-list`, {
      method: "GET",
    });
    expect(missingBlueprintsRes.status).toBe(401);

    const invalidHeaders = {
      "Content-Type": "application/json",
      Authorization: "Bearer not-a-valid-token",
    };

    const invalidStartRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: invalidHeaders,
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    expect(invalidStartRes.status).toBe(401);

    const invalidBlueprintsRes = await fetch(`${API_URL}/blueprints-list`, {
      method: "GET",
      headers: invalidHeaders,
    });
    expect(invalidBlueprintsRes.status).toBe(401);

    const validBlueprintsRes = await fetch(`${API_URL}/blueprints-list`, {
      method: "GET",
      headers: auth.headers,
    });
    expect(validBlueprintsRes.status).toBe(200);

    const validStartRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: BLUEPRINT_ID,
      }),
    });
    expect(validStartRes.status).toBe(200);

    const missingImageAuthRes = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprint_id: BLUEPRINT_ID,
        image_id: COVER_IMAGE_ID,
        purpose: "blueprint_cover",
      }),
    });
    expect(missingImageAuthRes.status).toBe(401);

    const invalidImageAuthRes = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: invalidHeaders,
      body: JSON.stringify({
        blueprint_id: BLUEPRINT_ID,
        image_id: COVER_IMAGE_ID,
        purpose: "blueprint_cover",
      }),
    });
    expect(invalidImageAuthRes.status).toBe(401);

    const validImageRes = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: BLUEPRINT_ID,
        image_id: COVER_IMAGE_ID,
        purpose: "blueprint_cover",
      }),
    });
    expect(validImageRes.status).toBe(200);
    const validImageBody = await validImageRes.json();
    expect(validImageBody.image_id).toBe(COVER_IMAGE_ID);
    expect(validImageBody.signed_url).toContain("token=");
    expect(Date.parse(validImageBody.expires_at)).toBeGreaterThan(Date.now());

    const missingImageRes = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: BLUEPRINT_ID,
        image_id: "mock-blueprint-123e4567-e89b-12d3-a456-426614179999.png",
        purpose: "blueprint_cover",
      }),
    });
    expect(missingImageRes.status).toBe(404);
  }, 15_000);
});
