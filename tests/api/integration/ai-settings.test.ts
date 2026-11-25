// `/api/ai-settings`, against the built server.
//
// The page is reachable with no cookie (it sits in front of the profile
// picker), lists the AIs in `ai.json` without a key, and stores one choice.
// The suite's server has no `ai.json`, so only mock can be chosen on it.
//
// ## Nothing here switches the suite's server to a live AI
//
// The rest of this suite is safe to run in parallel because every test owns a
// profile and touches only its own sessions. The stored choice is not like
// that: it belongs to the installation, so a live choice made here would be
// made for every test sharing this server. It happened, when the page still
// took keys: a throwaway key went to the real openrouter.ai, and whichever test
// started a game in that window got a 401 back as a 500 it had no way to
// explain. Locally the files interleaved harmlessly and it passed; on CI they
// did not.
//
// So every choice of anything but mock is made on a server of the test's own
// (`startOwnServer`), which nothing else shares and whose AIs cannot reach a
// real model. If you add a case here, ask what the suite's server is set to
// when it yields.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AISettingsState } from "../../../packages/shared/src/mystery-api-contracts.ts";
import { AISettingsStateSchema } from "../../../packages/shared/src/mystery-api-contracts.ts";
import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import type { TestPlayer } from "../../testkit/src/server";
import { API_URL, MOCK_BLUEPRINT_ID, readStoredEvents, setupApiTestAuth } from "./helpers";

const JSON_HEADERS = { "Content-Type": "application/json" };

function choose(name: unknown, apiUrl = API_URL): Promise<Response> {
  return fetch(`${apiUrl}/ai-settings`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name }),
  });
}

async function state(apiUrl = API_URL): Promise<AISettingsState> {
  return AISettingsStateSchema.parse(await (await fetch(`${apiUrl}/ai-settings`)).json());
}

describe("the suite's server", () => {
  // Shared with every other test, so each one leaves it on mock.
  beforeEach(async () => {
    await choose("mock");
  });
  afterEach(async () => {
    await choose("mock");
  });

  it("answers with no cookie at all, listing only mock", async () => {
    const response = await fetch(`${API_URL}/ai-settings`);

    expect(response.status).toBe(200);
    expect(AISettingsStateSchema.parse(await response.json())).toMatchObject({
      ais: [{ name: "mock", backend: "mock", problem: null }],
      narrator: { name: "mock", backend: "mock" },
      narrator_error: null,
    });
  });

  it("still answers a signed-in player", async () => {
    const auth = await setupApiTestAuth("ai-settings");

    expect((await fetch(`${API_URL}/ai-settings`, { headers: auth.headers })).status).toBe(200);
  });

  it("stores a choice of mock, with no cookie", async () => {
    const response = await choose("mock");

    expect(response.status).toBe(200);
    expect(AISettingsStateSchema.parse(await response.json()).chosen).toBe("mock");
    expect((await state()).chosen).toBe("mock");
  });

  it("refuses a name that is not in ai.json, naming it, and keeps the choice", async () => {
    for (const name of ["free", "paid", "default"]) {
      const response = await choose(name);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toContain(`"${name}"`);
    }
    expect((await state()).chosen).toBe("mock");
  });

  it("refuses a body without a name, naming the field", async () => {
    for (const body of [{}, { name: "" }, { name: 3 }]) {
      const response = await fetch(`${API_URL}/ai-settings`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ details: { field: "name" } });
    }
  });

  it("has no key or model endpoints any more", async () => {
    for (const path of ["ai-settings/keys", "ai-settings/models"]) {
      expect((await fetch(`${API_URL}/${path}`)).status).toBe(404);
      expect(
        (await fetch(`${API_URL}/${path}`, { method: "POST", headers: JSON_HEADERS, body: "{}" })).status,
      ).toBe(404);
    }
  });

  it("reports no override, because the suite's server is started without one", async () => {
    // If this ever reports an override, the harness has begun leaking the
    // ambient environment into the server it spawns.
    expect((await state()).override).toBeNull();
  });
});

// The servers below are the test's own. Their AIs cannot reach a real model:
// the claude CLI is pointed at a missing file, OpenRouter at a closed port.
describe("a server with AIs of its own", () => {
  let server: OwnServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  async function start(aiConfig: unknown, env: Record<string, string> = {}): Promise<OwnServer> {
    // A key exported in the shell would reach the server and give a keyless
    // entry one.
    server = await startOwnServer({
      aiConfig,
      env: { OPENROUTER_API_KEY: "", AI_CLAUDE_CLI_MAX_ATTEMPTS: "1", ...env },
    });
    return server;
  }

  function gameStart(own: OwnServer, auth: TestPlayer): Promise<Response> {
    return fetch(`${own.apiUrl}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
  }

  function turn(own: OwnServer, auth: TestPlayer, gameId: string, input: string): Promise<Response> {
    return fetch(`${own.apiUrl}/game-turn`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ game_id: gameId, input }),
    });
  }

  /** Stores a choice the page would refuse: an AI that has since gone, or broken. */
  function storeChoiceDirectly(own: OwnServer, name: string): void {
    own
      .database()
      .prepare("insert into app_settings (id, ai_name) values (1, ?) on conflict(id) do update set ai_name = excluded.ai_name")
      .run(name);
  }

  function sessionCount(own: OwnServer, auth: TestPlayer): number {
    const row = own.database().prepare("select count(*) as n from game_sessions where player_id = ?").get(auth.id);
    return Number(row?.n);
  }

  it("lists the file's AIs with backend and model, and sends no key", async () => {
    const own = await start({
      ais: {
        luna6: { backend: "openrouter", model: "openai/gpt-6-luna", key: "sk-or-v1-integration-secret" },
        free: { backend: "openrouter", model: "vendor/free" },
        claude: { backend: "claude-cli", model: "sonnet" },
      },
    });

    const response = await fetch(`${own.apiUrl}/ai-settings`);
    const body = await response.text();

    expect(body).not.toContain("integration-secret");
    expect(body).not.toContain("sk-or");
    const parsed = AISettingsStateSchema.parse(JSON.parse(body));
    expect(parsed.ais.map(({ name, backend, model }) => [name, backend, model])).toEqual([
      ["mock", "mock", "mock/runtime-default"],
      ["luna6", "openrouter", "openai/gpt-6-luna"],
      ["free", "openrouter", "vendor/free"],
      ["claude", "claude-cli", "sonnet"],
    ]);
    expect(parsed.ais.find((ai) => ai.name === "free")?.problem).toMatch(/AI "free" uses openrouter but has no key/);

    // Choosing returns the same shape, still without the key.
    const chosen = await choose("luna6", own.apiUrl);
    expect(chosen.status).toBe(200);
    expect(await chosen.text()).not.toContain("integration-secret");
    expect((await state(own.apiUrl)).narrator).toEqual({ name: "luna6", backend: "openrouter", model: "openai/gpt-6-luna" });

    // An AI without what it needs is listed but cannot be chosen.
    const refused = await choose("free", own.apiUrl);
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toMatch(/"free"/);
    expect((await state(own.apiUrl)).chosen).toBe("luna6");
  });

  it("shows a run override, which narrates instead of the choice", async () => {
    const own = await start({ ais: { claude: { backend: "claude-cli", model: "sonnet" } } }, { AI_PROFILE: "claude" });

    expect(await state(own.apiUrl)).toMatchObject({
      chosen: null,
      override: { name: "claude", backend: "claude-cli", model: "sonnet" },
      narrator: { name: "claude" },
    });
  });

  it("takes a choice made between two turns on the second turn", async () => {
    const own = await start({ ais: { cli: { backend: "claude-cli", model: "sonnet" } } });
    const auth = await own.createPlayer("ai-choice-turn");
    const started = await gameStart(own, auth);
    expect(started.status).toBe(200);
    const { game_id: gameId } = await started.json();

    expect((await turn(own, auth, gameId, "search")).status).toBe(200);
    const narrated = readStoredEvents(gameId, own.database()).length;

    expect((await choose("cli", own.apiUrl)).status).toBe(200);

    // The claude CLI is a missing file here, so the second turn fails: it was
    // narrated by the new choice, and mock did not stand in for it.
    expect((await turn(own, auth, gameId, "search")).status).not.toBe(200);
    expect(readStoredEvents(gameId, own.database())).toHaveLength(narrated);
  });

  it("narrates a fresh database with the ai.json default, with nothing chosen", async () => {
    const own = await start({ ais: { cli: { backend: "claude-cli", model: "sonnet" } }, default: "cli" });
    const auth = await own.createPlayer("ai-default-fresh");

    expect(await state(own.apiUrl)).toMatchObject({
      chosen: null,
      configured_default: "cli",
      narrator: { name: "cli", backend: "claude-cli", model: "sonnet" },
    });
    // The claude CLI is a missing file here, so the game cannot start: the
    // default narrated it, and mock did not stand in for it.
    expect((await gameStart(own, auth)).status).not.toBe(200);
    expect(sessionCount(own, auth)).toBe(0);
  });

  it("answers game-start with an error naming an ai.json default that cannot narrate, and starts nothing", async () => {
    const own = await start({ ais: { free: { backend: "openrouter", model: "vendor/free" } }, default: "free" });
    const auth = await own.createPlayer("ai-default-broken");

    const response = await gameStart(own, auth);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/The default in .*ai\.json, "free", cannot narrate/);
    expect(sessionCount(own, auth)).toBe(0);
    expect((await state(own.apiUrl)).narrator_error).toMatch(/"free"/);
  });

  it("answers game-start with an error naming a chosen AI that has gone, and starts nothing", async () => {
    const own = await start(undefined);
    const auth = await own.createPlayer("ai-choice-gone");
    storeChoiceDirectly(own, "luna6");

    const response = await gameStart(own, auth);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/"luna6", is not in ai\.json/);
    expect(sessionCount(own, auth)).toBe(0);
    expect((await state(own.apiUrl)).narrator_error).toMatch(/"luna6"/);
  });

  it("answers game-start with an error naming a chosen AI that has no key", async () => {
    const own = await start({ ais: { free: { backend: "openrouter", model: "vendor/free" } } });
    const auth = await own.createPlayer("ai-choice-broken");
    storeChoiceDirectly(own, "free");

    const response = await gameStart(own, auth);

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/AI "free" uses openrouter but has no key/);
    expect(sessionCount(own, auth)).toBe(0);
  });

  it("answers a turn with an error naming a chosen AI that has gone, and writes no event", async () => {
    const own = await start(undefined);
    const auth = await own.createPlayer("ai-choice-gone-turn");
    const started = await gameStart(own, auth);
    expect(started.status).toBe(200);
    const { game_id: gameId } = await started.json();
    const before = readStoredEvents(gameId, own.database());

    storeChoiceDirectly(own, "luna6");
    const response = await turn(own, auth, gameId, "search");

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/"luna6", is not in ai\.json/);
    expect(readStoredEvents(gameId, own.database())).toEqual(before);
  });
});
