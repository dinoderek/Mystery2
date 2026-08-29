import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  API_URL,
  MOCK_BLUEPRINT_ID,
  readStoredSession,
  setupApiTestAuth,
  TEST_CONFIG_ROOT,
  type ApiAuthContext,
} from "./helpers";

// The property under test has not changed: a session's AI profile is resolved
// on every request, not frozen when the session starts, so `dev:ai:free` and
// `dev:ai:paid` take effect without a restart. What changed is where a profile
// lives — it was a row in `ai_profiles` read with a service-role client, and it
// is now the env file that already configured it.

const FREE_ENV_PATH = path.join(TEST_CONFIG_ROOT, ".env.ai.free.local");

function writeFreeProfile(lines: string[]): void {
  fs.writeFileSync(FREE_ENV_PATH, `${lines.join("\n")}\n`);
}

async function search(auth: ApiAuthContext, gameId: string): Promise<number> {
  const res = await fetch(`${API_URL}/game-search`, {
    method: "POST",
    headers: auth.headers,
    body: JSON.stringify({ game_id: gameId }),
  });
  return res.status;
}

describe("ai profile runtime resolution", () => {
  let auth: ApiAuthContext;

  beforeEach(async () => {
    auth = await setupApiTestAuth("ai-profile-runtime");
  });

  afterEach(() => {
    fs.rmSync(FREE_ENV_PATH, { force: true });
  });

  it("applies a profile change immediately for an active session", async () => {
    writeFreeProfile(["AI_PROVIDER=mock", "AI_MODEL=mock/runtime-test"]);

    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        ai_profile: "free",
      }),
    });
    expect(startRes.status).toBe(200);
    const { game_id: gameId } = await startRes.json();

    // The label is recorded on the session for provenance; the evaluation
    // pipeline reads it.
    expect(readStoredSession(gameId)?.ai_profile_id).toBe("free");
    expect(await search(auth, gameId)).toBe(200);

    // Break the profile after the session has started. A run that cached the
    // profile at start would carry on working; resolving per request cannot.
    writeFreeProfile(["AI_PROVIDER=mock", "AI_MODEL="]);
    expect(await search(auth, gameId)).toBe(500);

    writeFreeProfile(["AI_PROVIDER=mock", "AI_MODEL=mock/runtime-test"]);
    expect(await search(auth, gameId)).toBe(200);
  });

  it("rejects a profile that is not configured on this machine", async () => {
    const res = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({
        blueprint_id: MOCK_BLUEPRINT_ID,
        ai_profile: "no-such-profile",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("falls back to the mock provider when nothing configures the default", async () => {
    const startRes = await fetch(`${API_URL}/game-start`, {
      method: "POST",
      headers: auth.headers,
      body: JSON.stringify({ blueprint_id: MOCK_BLUEPRINT_ID }),
    });
    expect(startRes.status).toBe(200);
    const { game_id: gameId } = await startRes.json();

    expect(readStoredSession(gameId)?.ai_profile_id).toBe("default");
  });
});
