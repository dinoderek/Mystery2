// `/api/ai-settings`, against the built server.
//
// Two properties are the reason this suite exists: the page is reachable with
// no cookie (it sits in front of the profile picker), and a stored API key
// never comes back out of it. Everything else here is ordinary CRUD.
//
// The server under test runs against a temporary config root with no env files,
// so every row these tests see is one they created — there is no `env` row to
// collide with, and the override block is null.
//
// ## Nothing here switches the mode to live
//
// The rest of this suite is safe to run in parallel because every test owns a
// profile and touches only its own sessions. The settings row is not like that:
// it belongs to the installation, so setting `mode: "openrouter"` here sets it
// for every test sharing this server. It happened — a throwaway key went to the
// real openrouter.ai, and whichever test started a game in that window got a
// 401 back as a 500 it had no way to explain. Locally the files interleaved
// harmlessly and it passed; on CI they did not.
//
// So the accept path is asserted where it costs nobody: `resolve()` returning
// `openrouter` in `tests/api/unit/ai-settings-store.test.ts`, and `default`
// following the stored choice in `tests/api/unit/local-engine-ai-profile.test.ts`.
// What stays here is everything that leaves the server in mock — including the
// refusal, which is the endpoint-level behaviour worth pinning anyway.
//
// If you add a case here, ask what the server is set to when it yields.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { API_URL, setupApiTestAuth } from "./helpers";

const JSON_HEADERS = { "Content-Type": "application/json" };

interface KeySummary {
  label: string;
  source: "env" | "user";
  masked: string;
}

interface ModelSummary {
  label: string;
  model_id: string;
  source: "env" | "user";
}

interface SettingsState {
  effective_mode: "mock" | "openrouter";
  stored_mode: "mock" | "openrouter";
  selected_key_label: string | null;
  selected_model_label: string | null;
  missing_key_label: string | null;
  missing_model_label: string | null;
  keys: KeySummary[];
  models: ModelSummary[];
  override: { provider: string; model: string; source: string } | null;
}

function get(): Promise<Response> {
  return fetch(`${API_URL}/ai-settings`);
}

function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${API_URL}/${path}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
  });
}

function remove(path: string, label: string): Promise<Response> {
  return fetch(`${API_URL}/${path}?label=${encodeURIComponent(label)}`, {
    method: "DELETE",
  });
}

async function state(): Promise<SettingsState> {
  return (await get()).json() as Promise<SettingsState>;
}

/**
 * The settings row is global, so tests share it. Each one puts it back to mock
 * with nothing selected and removes what it added, rather than relying on
 * ordering.
 */
async function reset(): Promise<void> {
  await post("ai-settings", { mode: "mock" });
  await post("ai-settings", { key_label: null, model_label: null });

  const current = await state();
  for (const key of current.keys.filter((entry) => entry.source === "user")) {
    await remove("ai-settings/keys", key.label);
  }
  for (const model of current.models.filter((entry) => entry.source === "user")) {
    await remove("ai-settings/models", model.label);
  }
}

beforeEach(reset);
afterEach(reset);

describe("reaching the settings without a profile", () => {
  it("answers a GET with no cookie at all", async () => {
    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ stored_mode: "mock" });
  });

  it("accepts a write with no cookie", async () => {
    expect((await post("ai-settings/models", { label: "m", model_id: "v/m" })).status).toBe(200);
  });

  it("still works for a signed-in player", async () => {
    const auth = await setupApiTestAuth("ai-settings");

    expect((await fetch(`${API_URL}/ai-settings`, { headers: auth.headers })).status).toBe(200);
  });
});

describe("keys", () => {
  it("never returns a stored key, only its last four characters", async () => {
    const response = await post("ai-settings/keys", {
      label: "mine",
      api_key: "sk-or-v1-supersecretvalue9999",
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).not.toContain("supersecret");
    expect(body).not.toContain("sk-or-v1-supersecretvalue9999");

    const current = await state();
    expect(current.keys).toContainEqual({
      label: "mine",
      source: "user",
      masked: "...9999",
    });
  });

  it("rejects a key with no label or no value", async () => {
    expect((await post("ai-settings/keys", { label: "", api_key: "sk" })).status).toBe(400);
    expect((await post("ai-settings/keys", { label: "mine", api_key: "" })).status).toBe(400);
  });

  it("replaces a key stored under the same label", async () => {
    await post("ai-settings/keys", { label: "mine", api_key: "sk-aaaa" });
    await post("ai-settings/keys", { label: "mine", api_key: "sk-bbbb" });

    const current = await state();
    expect(current.keys.filter((key) => key.label === "mine")).toEqual([
      { label: "mine", source: "user", masked: "...bbbb" },
    ]);
  });

  it("reports a delete of something that was never there", async () => {
    expect((await remove("ai-settings/keys", "ghost")).status).toBe(404);
  });
});

describe("choosing a configuration", () => {
  it("refuses real AI until both a key and a model are selected", async () => {
    const response = await post("ai-settings", { mode: "openrouter" });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringMatching(/key/i) });
    expect((await state()).stored_mode).toBe("mock");
  });

  it("refuses a selection naming a label that does not exist", async () => {
    expect((await post("ai-settings", { key_label: "ghost" })).status).toBe(400);
  });

  it("stores a key and model selection, and persists it", async () => {
    // The mode stays mock, so this leaves the server in a state every other
    // test can live with. See the note at the top of the file.
    await post("ai-settings/keys", { label: "mine", api_key: "sk-or-v1-abcd" });
    await post("ai-settings/models", { label: "mine", model_id: "vendor/model" });

    const response = await post("ai-settings", {
      key_label: "mine",
      model_label: "mine",
    });

    expect(response.status).toBe(200);
    expect(await state()).toMatchObject({
      stored_mode: "mock",
      selected_key_label: "mine",
      selected_model_label: "mine",
    });
  });

  it("clears a selection when asked with null", async () => {
    await post("ai-settings/models", { label: "mine", model_id: "vendor/model" });
    await post("ai-settings", { model_label: "mine" });

    await post("ai-settings", { model_label: null });

    expect((await state()).selected_model_label).toBeNull();
  });

  it("drops the selection when the selected model is deleted", async () => {
    await post("ai-settings/models", { label: "mine", model_id: "vendor/model" });
    await post("ai-settings", { model_label: "mine" });

    await remove("ai-settings/models", "mine");

    expect(await state()).toMatchObject({
      stored_mode: "mock",
      selected_model_label: null,
    });
  });

  it("rejects a mode it does not understand, and an empty update", async () => {
    expect((await post("ai-settings", { mode: "anthropic" })).status).toBe(400);
    expect((await post("ai-settings", {})).status).toBe(400);
  });
});

describe("the override banner", () => {
  it("reports no override, because the test server is started without one", async () => {
    // The mock test server runs against a temporary config root with no env
    // files and no AI variables — mock by absence. If this ever starts
    // reporting an override, the harness has begun leaking the ambient
    // environment into the server it spawns.
    expect((await state()).override).toBeNull();
  });
});
