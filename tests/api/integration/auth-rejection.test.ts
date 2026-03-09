import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("edge function auth rejection", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("auth-rejection");
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
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });
    expect(validStartRes.status).toBe(200);
  });
});
