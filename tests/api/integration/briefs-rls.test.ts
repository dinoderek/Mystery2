import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAuthenticatedClient } from "../../testkit/src/auth";
import { API_URL, setupApiTestAuth, type ApiAuthContext } from "./auth-helpers";

describe("briefs RLS ownership policies", () => {
  let userA: ApiAuthContext;
  let userB: ApiAuthContext;

  beforeEach(async () => {
    userA = await setupApiTestAuth("briefs-rls-a");
    userB = await setupApiTestAuth("briefs-rls-b");
  });

  afterEach(async () => {
    await userA.cleanup();
    await userB.cleanup();
  });

  async function createBrief(headers: HeadersInit) {
    const res = await fetch(`${API_URL}/briefs-save`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        brief: "RLS test mystery",
        target_age: 10,
        title_hint: "RLS Test",
      }),
    });
    const { brief } = await res.json();
    return brief;
  }

  it("user A cannot read user B's brief via Edge Function", async () => {
    const brief = await createBrief(userB.headers);

    const getRes = await fetch(`${API_URL}/briefs-get`, {
      method: "POST",
      headers: userA.headers,
      body: JSON.stringify({ brief_id: brief.id }),
    });

    expect(getRes.status).toBe(404);
  });

  it("user A cannot read user B's brief via direct DB query", async () => {
    const brief = await createBrief(userB.headers);

    const clientA = createAuthenticatedClient(userA.accessToken);
    const { data, error } = await clientA
      .from("briefs")
      .select("id")
      .eq("id", brief.id);

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot update user B's brief", async () => {
    const brief = await createBrief(userB.headers);

    const clientA = createAuthenticatedClient(userA.accessToken);
    const { data, error } = await clientA
      .from("briefs")
      .update({ title_hint: "Hijacked" })
      .eq("id", brief.id)
      .select("id");

    expect(error).toBeNull();
    expect(data).toEqual([]);
  });

  it("user A cannot archive user B's brief", async () => {
    const brief = await createBrief(userB.headers);

    const archiveRes = await fetch(`${API_URL}/briefs-archive`, {
      method: "POST",
      headers: userA.headers,
      body: JSON.stringify({ brief_id: brief.id }),
    });

    // RLS returns 404 because user A can't see user B's brief
    expect(archiveRes.status).toBe(404);
  });

  it("unauthenticated request returns 401", async () => {
    const res = await fetch(`${API_URL}/briefs-list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(401);
  });
});
