// Endpoint model backend (deterministic single-event).
//
// Seeds a fully-specified session + fixed history into the database, then sends
// the case's action to the server as the line a player would type, to
// `game-turn`. The exception is `start`, which creates the session itself
// (action.createsSession) through `game-start`. The server rebuilds the exact runtime
// context from the seeded rows, so the input is identical every run and across
// models — the only variable is the model behind the session's ai_profile
// (`mock` for plumbing/CI, or an `openrouter` profile reaching openai/* or
// anthropic/* for a real run).

import { setupHarnessAuth } from "../auth.mjs";
import { ensureBlueprintSeeded } from "../seed.mjs";
import { seedSessionWithHistory } from "../seed-session.mjs";
import { getAction } from "../roles.mjs";
import { assertTurnPlayed, extractNarrationParts, makeResponse } from "../transcript.mjs";

export const id = "endpoint";

async function callEndpoint(apiUrl, endpoint, method, body, headers) {
  const res = await fetch(`${apiUrl}/${endpoint}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { _raw_text: text };
  }
  if (!res.ok) {
    throw new Error(`${endpoint} failed: HTTP ${res.status} ${String(text).slice(0, 500)}`);
  }
  return data;
}

export async function collect(testCase, ctx) {
  const env = ctx.env;
  const action = getAction(testCase.action.type);
  if (testCase.action.accusation_history_mode) {
    // A typed line cannot carry it; only the cli backends honour it.
    throw new Error("accusation_history_mode is not supported by the endpoint backend");
  }
  const aiProfile = ctx.aiProfile ?? testCase.aiProfile ?? "default";

  const { blueprint, blueprintPath } = await ensureBlueprintSeeded(testCase.blueprint.path);
  const auth = await setupHarnessAuth(testCase.id ?? "runtime-eval", env);

  try {
    // `start` creates its own session, so there is nothing to seed and no game
    // id to address; every other action acts on a fully-specified seeded one.
    const gameId = action.createsSession
      ? null
      : await seedSessionWithHistory({
        blueprint,
        given: testCase.given,
        aiProfile,
        playerId: auth.player.id,
      });

    const body = action.endpoint.body(testCase.given, testCase.action, gameId, {
      blueprint,
      aiProfile,
    });
    const data = await callEndpoint(
      env.apiUrl,
      action.endpoint.name,
      action.endpoint.method,
      body,
      auth.headers,
    );
    if (action.endpoint.name === "game-turn") assertTurnPlayed(data, body.input, action);

    const response = makeResponse({
      action: testCase.action.type,
      request: body,
      parts: extractNarrationParts(testCase.action.type, data),
      raw: data,
    });

    return { response, blueprint, blueprintPath, model: aiProfile };
  } finally {
    await auth.cleanup();
  }
}
