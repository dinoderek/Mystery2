import { describe, expect, it } from "vitest";
import { API_URL, MOCK_BLUEPRINT_ID } from "./helpers";

// The catalog belongs to nobody, so these requests carry no cookie.

describe("blueprints-list endpoint", () => {
  it("lists the mock case", async () => {
    const res = await fetch(`${API_URL}/blueprints-list`);
    expect(res.status).toBe(200);
    const data = await res.json();

    expect(data.blueprints).toBeDefined();
    expect(Array.isArray(data.blueprints)).toBe(true);
    expect(data.blueprints.length).toBeGreaterThanOrEqual(1);

    const mockDb = data.blueprints.find(
      (b: { id: string; title: string; world?: unknown }) => b.id === MOCK_BLUEPRINT_ID,
    );
    expect(mockDb).toBeDefined();
    expect(mockDb.title).toBe("Mock Case — clue graph");
    expect(mockDb.world).toBeUndefined();
    expect(mockDb.blueprint_image_id).toBe(
      "mock-case.blueprint.png",
    );
  });
});
