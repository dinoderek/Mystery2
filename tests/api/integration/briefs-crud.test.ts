import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("briefs CRUD", () => {
  let user: ApiAuthContext;

  beforeEach(async () => {
    user = await setupApiTestAuth("briefs-crud");
  });

  afterEach(async () => {
    await user.cleanup();
  });

  async function createBrief(
    headers: HeadersInit,
    overrides: Record<string, unknown> = {},
  ) {
    return fetch(`${API_URL}/briefs-save`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brief: "A stolen painting in a Victorian mansion",
        target_age: 10,
        ...overrides,
      }),
    });
  }

  it("creates a brief and returns full row with generated id", async () => {
    const res = await createBrief(user.headers, {
      title_hint: "The Heist",
      must_include: ["hidden passage"],
    });

    expect(res.status).toBe(201);
    const { brief } = await res.json();
    expect(brief.id).toBeTruthy();
    expect(brief.brief).toBe("A stolen painting in a Victorian mansion");
    expect(brief.target_age).toBe(10);
    expect(brief.title_hint).toBe("The Heist");
    expect(brief.must_include).toEqual(["hidden passage"]);
    expect(brief.user_id).toBe(user.user.id);
    expect(brief.created_at).toBeTruthy();
    expect(brief.updated_at).toBeTruthy();
    expect(brief.archived_at).toBeNull();
  });

  it("lists only own briefs", async () => {
    // Create 2 briefs
    await createBrief(user.headers, { title_hint: "Brief A" });
    await createBrief(user.headers, { title_hint: "Brief B" });

    const listRes = await fetch(`${API_URL}/briefs-list`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({}),
    });

    expect(listRes.status).toBe(200);
    const { briefs } = await listRes.json();
    expect(briefs.length).toBeGreaterThanOrEqual(2);
    const titles = briefs.map((b: { title_hint: string }) => b.title_hint);
    expect(titles).toContain("Brief A");
    expect(titles).toContain("Brief B");
  });

  it("gets a brief by id with full data", async () => {
    const createRes = await createBrief(user.headers, {
      title_hint: "Full Brief",
      art_style: "pixel art",
      elimination_complexity: "moderate",
    });
    const { brief: created } = await createRes.json();

    const getRes = await fetch(`${API_URL}/briefs-get`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: created.id }),
    });

    expect(getRes.status).toBe(200);
    const { brief } = await getRes.json();
    expect(brief.id).toBe(created.id);
    expect(brief.title_hint).toBe("Full Brief");
    expect(brief.art_style).toBe("pixel art");
    expect(brief.elimination_complexity).toBe("moderate");
  });

  it("updates a brief and changes updated_at", async () => {
    const createRes = await createBrief(user.headers, { title_hint: "Original" });
    const { brief: created } = await createRes.json();

    // Small delay to ensure updated_at differs
    await new Promise((r) => setTimeout(r, 50));

    const updateRes = await fetch(`${API_URL}/briefs-save`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({
        id: created.id,
        brief: "Updated mystery premise",
        target_age: 12,
        title_hint: "Updated Title",
      }),
    });

    expect(updateRes.status).toBe(200);
    const { brief: updated } = await updateRes.json();
    expect(updated.brief).toBe("Updated mystery premise");
    expect(updated.target_age).toBe(12);
    expect(updated.title_hint).toBe("Updated Title");
    expect(new Date(updated.updated_at).getTime()).toBeGreaterThan(
      new Date(created.created_at).getTime(),
    );
  });

  it("archives a brief and excludes from default list", async () => {
    const createRes = await createBrief(user.headers, { title_hint: "To Archive" });
    const { brief: created } = await createRes.json();

    const archiveRes = await fetch(`${API_URL}/briefs-archive`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: created.id }),
    });

    expect(archiveRes.status).toBe(200);
    const { brief: archived } = await archiveRes.json();
    expect(archived.archived_at).toBeTruthy();

    // Default list excludes archived
    const listRes = await fetch(`${API_URL}/briefs-list`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({}),
    });
    const { briefs } = await listRes.json();
    const ids = briefs.map((b: { id: string }) => b.id);
    expect(ids).not.toContain(created.id);
  });

  it("includes archived briefs when flag is set", async () => {
    const createRes = await createBrief(user.headers, { title_hint: "Archived One" });
    const { brief: created } = await createRes.json();

    await fetch(`${API_URL}/briefs-archive`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: created.id }),
    });

    const listRes = await fetch(`${API_URL}/briefs-list`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ include_archived: true }),
    });
    const { briefs } = await listRes.json();
    const ids = briefs.map((b: { id: string }) => b.id);
    expect(ids).toContain(created.id);
  });

  it("restores an archived brief", async () => {
    const createRes = await createBrief(user.headers, { title_hint: "Restore Me" });
    const { brief: created } = await createRes.json();

    await fetch(`${API_URL}/briefs-archive`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: created.id }),
    });

    const restoreRes = await fetch(`${API_URL}/briefs-archive`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: created.id, restore: true }),
    });

    expect(restoreRes.status).toBe(200);
    const { brief: restored } = await restoreRes.json();
    expect(restored.archived_at).toBeNull();
  });

  it("returns 404 for non-existent brief", async () => {
    const getRes = await fetch(`${API_URL}/briefs-get`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ brief_id: "00000000-0000-0000-0000-000000000000" }),
    });

    expect(getRes.status).toBe(404);
  });

  it("returns 400 for invalid data", async () => {
    const res = await fetch(`${API_URL}/briefs-save`, {
      method: "POST",
      headers: user.headers,
      body: JSON.stringify({ target_age: 10 }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("brief");
  });
});
