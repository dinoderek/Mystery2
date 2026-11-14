import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startOwnServer, type OwnServer } from "../../testkit/src/own-server";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredEvents,
  readStoredSession,
  sendLine,
  setupApiTestAuth,
  type ApiAuthContext,
} from "./helpers";

// Which AI narrates: the suite's server has no `ai.json` and no run override,
// so mock narrates and only mock can be named. The servers this file starts
// itself prove what a start reads: a named AI from the file, a run override
// exported in the shell cleared, a malformed file refused.

async function startGame(apiUrl: string, auth: ApiAuthContext, aiProfile?: string): Promise<Response> {
  return fetch(`${apiUrl}/game-start`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID, ...(aiProfile ? { ai_profile: aiProfile } : {}) }),
  });
}

describe("the suite's server", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("ai-profile-runtime");
  });

  it("narrates the default with mock, recording the label for provenance", async () => {
    const res = await startGame(API_URL, auth);
    expect(res.status).toBe(200);
    const { game_id: gameId } = await res.json();

    expect(readStoredSession(gameId)?.ai_profile_id).toBe("default");
    expect(readStoredEvents(gameId).map((event) => event.model)).toContain("mock/runtime-default");
  });

  it("answers 400 for an AI that is not in its (empty) ai.json", async () => {
    for (const name of ["free", "paid", "no-such-ai"]) {
      expect((await startGame(API_URL, auth, name)).status).toBe(400);
    }
  });

  it("plays a game that names mock", async () => {
    const res = await startGame(API_URL, auth, "mock");
    expect(res.status).toBe(200);
    expect((await sendLine(auth, (await res.json()).game_id, "search")).status).toBe(200);
  });
});

describe("a server of a test's own", () => {
  let server: OwnServer | null = null;

  afterEach(async () => {
    await server?.stop();
    server = null;
  });

  it("resolves an AI named in the ai.json it started with", async () => {
    server = await startOwnServer({ aiConfig: { ais: { other: { backend: "claude-cli", model: "sonnet" } } } });
    const auth = await server.createPlayer("ai-named");
    // The claude CLI is pointed at a missing file, so the opening narration
    // fails (500); resolving the name is what is proven, by not answering 400.
    expect((await startGame(server.apiUrl, auth, "other")).status).toBe(500);
    expect((await startGame(server.apiUrl, auth, "free")).status).toBe(400);
  });

  it("still narrates with mock when the shell exported a run override", async () => {
    const exported = process.env.AI_PROFILE;
    process.env.AI_PROFILE = "paid";
    try {
      // A server given AI_PROFILE=paid with no such AI would refuse to start.
      server = await startOwnServer();
    } finally {
      if (exported === undefined) delete process.env.AI_PROFILE;
      else process.env.AI_PROFILE = exported;
    }
    const auth = await server.createPlayer("ai-exported");
    const res = await startGame(server.apiUrl, auth);
    expect(res.status).toBe(200);
    const { game_id: gameId } = await res.json();
    expect(readStoredEvents(gameId, server.database()).map((event) => event.model)).toContain("mock/runtime-default");
  });

  it("refuses to start on a malformed ai.json", async () => {
    await expect(startOwnServer({ aiConfig: { ais: { free: { backend: "openrouter" } } } })).rejects.toThrow(
      /exited during startup/,
    );
  });

  it("refuses to start when the run override names an AI it does not have", async () => {
    await expect(startOwnServer({ env: { AI_PROFILE: "free" } })).rejects.toThrow(/exited during startup/);
  });
});
