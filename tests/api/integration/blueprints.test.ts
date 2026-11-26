import { beforeEach, describe, expect, it } from "vitest";
import { readMockCase } from "../../testkit/src/mock-case";
import { API_URL, MOCK_BLUEPRINT_ID, setupApiTestAuth, type ApiAuthContext } from "./helpers";

// The case list runs as a profile: its lines are narrated at the profile's
// reading age (the prompt and the failure path are `unit/blueprints-list.test.ts`).

interface Listed {
  id: string;
  title: string;
  one_liner: string | null;
  blueprint_image_id?: string | null;
  world?: unknown;
}

describe("blueprints-list endpoint", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("blueprints-list");
  });

  async function list(query = ""): Promise<Listed[]> {
    const res = await fetch(`${API_URL}/blueprints-list${query}`, { headers: auth.headers });
    expect(res.status).toBe(200);
    return (await res.json()).blueprints;
  }

  it("lists the mock case's title and art at once, with no line", async () => {
    const mockCase = (await list()).find((b) => b.id === MOCK_BLUEPRINT_ID);

    expect(mockCase).toMatchObject({
      title: "Mock Case — clue graph",
      one_liner: null,
      blueprint_image_id: "mock-case.blueprint.png",
    });
    expect(mockCase?.world).toBeUndefined();
  });

  it("narrates every listed case's line when asked, never the case's own", async () => {
    const age = await fetch(`${API_URL}/profile-settings`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ reading_age: 7 }),
    });
    expect(age.status).toBe(200);

    const listed = await list("?one_liners=true");
    const authored = readMockCase().metadata.one_liner;

    expect(listed.find((b) => b.id === MOCK_BLUEPRINT_ID)?.one_liner).toBe(`[Mock] ${authored}`);
    for (const entry of listed) {
      expect(entry.one_liner, entry.id).toMatch(/^\[Mock\] /);
    }
    expect(listed.map((b) => b.one_liner)).not.toContain(authored);
  });
});
