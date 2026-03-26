import { describe, expect, it } from "vitest";
import { API_URL } from "./auth-helpers";

const ENDPOINTS = [
  { path: "blueprints-list", requestedMethod: "GET" },
  { path: "game-start", requestedMethod: "POST" },
  { path: "game-sessions-list", requestedMethod: "GET" },
  { path: "game-get", requestedMethod: "GET" },
  { path: "game-move", requestedMethod: "POST" },
  { path: "game-talk", requestedMethod: "POST" },
  { path: "game-ask", requestedMethod: "POST" },
  { path: "game-end-talk", requestedMethod: "POST" },
  { path: "game-search", requestedMethod: "POST" },
  { path: "game-accuse", requestedMethod: "POST" },
  { path: "blueprint-image-link", requestedMethod: "POST" },
] as const;

describe("edge function CORS handling", () => {
  it("accepts preflight OPTIONS for all endpoints", async () => {
    for (const endpoint of ENDPOINTS) {
      const res = await fetch(`${API_URL}/${endpoint.path}`, {
        method: "OPTIONS",
        headers: {
          Origin: "https://example.com",
          "Access-Control-Request-Method": endpoint.requestedMethod,
          "Access-Control-Request-Headers": "authorization,content-type",
        },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain(
        "authorization",
      );
      expect(res.headers.get("Access-Control-Allow-Headers")?.toLowerCase()).toContain(
        "content-type",
      );
      const allowMethods = res.headers.get("Access-Control-Allow-Methods")
        ?.toUpperCase() ?? "";
      expect(allowMethods).toContain("OPTIONS");
      expect(allowMethods).toContain(endpoint.requestedMethod);
    }
  });

  it("includes CORS headers on rejected auth responses", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
      }),
    });

    expect(res.status).toBe(401);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");

    const imageRes = await fetch(`${API_URL}/blueprint-image-link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blueprint_id: "123e4567-e89b-12d3-a456-426614174000",
        image_id: "mock-blueprint.blueprint.png",
      }),
    });
    expect(imageRes.status).toBe(401);
    expect(imageRes.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
