import { describe, it, expect } from "vitest";

const API_URL = "http://127.0.0.1:54331/functions/v1";

describe("blueprints-list endpoint", () => {
  it("returns available mock blueprint", async () => {
    const res = await fetch(`${API_URL}/blueprints-list`, {
      headers: { Authorization: `Bearer ${process.env.ANON_KEY}` },
    });
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.blueprints).toBeDefined();
    expect(Array.isArray(data.blueprints)).toBe(true);
    expect(data.blueprints.length).toBeGreaterThanOrEqual(1);

    const mockDb = data.blueprints.find(
      (b: { id: string; title: string; world?: unknown }) => b.id === "123e4567-e89b-12d3-a456-426614174000",
    );
    expect(mockDb).toBeDefined();
    expect(mockDb.title).toBe("Mock Blueprint");
    expect(mockDb.world).toBeUndefined();
  });
});
