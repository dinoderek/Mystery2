// Endpoint model backend (deterministic single-event).
//
// Seeds a fully-specified session + fixed history into the DB, then calls the
// ONE endpoint for the case's action. The server rebuilds the exact runtime
// context from the seeded rows, so the input is identical every run and across
// models — the only variable is the model behind the session's ai_profile
// (`mock` for plumbing/CI, or an `openrouter` profile reaching openai/* or
// anthropic/* for a real run).

import { setupHarnessAuth } from "../auth.mjs";
import { ensureBlueprintSeeded } from "../seed.mjs";
import { seedSessionWithHistory } from "../seed-session.mjs";
import { getAction } from "../roles.mjs";
import { extractNarrationParts, makeResponse } from "../transcript.mjs";

export const id = "endpoint";

async function callEndpoint(functionsUrl, endpoint, method, body, headers) {
  const res = await fetch(`${functionsUrl}/${endpoint}`, {
    method,
    headers,
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
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
  const aiProfile = ctx.aiProfile ?? testCase.aiProfile ?? "default";

  const { blueprint, blueprintPath } = await ensureBlueprintSeeded(testCase.blueprint.path, env);
  const auth = await setupHarnessAuth(testCase.id ?? "runtime-eval", env);

  try {
    const gameId = await seedSessionWithHistory({
      blueprint,
      given: testCase.given,
      aiProfile,
      userId: auth.user.id,
      env,
    });

    const body = action.endpoint.body(testCase.given, testCase.action, gameId);
    const data = await callEndpoint(
      env.functionsUrl,
      action.endpoint.name,
      action.endpoint.method,
      body,
      auth.headers,
    );

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
