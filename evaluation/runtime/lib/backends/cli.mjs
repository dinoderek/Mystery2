// CLI model backend (deterministic single-event prompt-replay).
//
// Reconstructs the REAL runtime prompt+context for the case's ONE action from
// the fixed `given` state + explicit history (via lib/prompt-build.mjs, which
// imports the shared builders), and pipes it to a local CLI (claude / openai /
// stub) using the evaluation pipeline's runCli. Because the input is fully
// specified by the case — not accumulated over turns — every model receives
// byte-identical input, so outputs are directly comparable.
//
// Every action with a `roleInput` mapping in lib/roles.mjs replays locally.
// The prompt itself is assembled by the shared role-request layer, the same one
// the Edge Function handlers use, so a local replay and a live endpoint call
// build the same prompt for the same input.

import fs from "node:fs/promises";
import path from "node:path";
import { runCliWithRetries } from "../../../pipeline/cli-runner.mjs";
import { loadCliConfig, parseFencedJson } from "../cli-config.mjs";
import { buildNarrationPrompt, buildRoleRequest } from "../prompt-build.mjs";
import { makeResponse } from "../transcript.mjs";
import { getAction, normalizeHistory } from "../roles.mjs";

export const id = "cli";

// Narration roles return plain text rather than a role-output JSON contract.
const NARRATION_ROLES = new Set(["intro", "ambience"]);

export async function collect(testCase, ctx) {
  const variant = ctx.variant ?? "claude";
  const entry = await loadCliConfig(variant);
  const action = getAction(testCase.action.type);
  if (!action.roleInput) {
    throw new Error(
      `Action "${testCase.action.type}" has no local replay mapping yet. ` +
        `Use the endpoint backend, or add a roleInput mapping in lib/roles.mjs.`,
    );
  }

  const blueprintPath = path.resolve(process.cwd(), testCase.blueprint.path);
  const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf-8"));
  const history = normalizeHistory(testCase.given.history);
  const roleInput = action.roleInput(testCase.given, testCase.action, blueprint, history);
  const isNarrationRole = NARRATION_ROLES.has(roleInput.role);

  const request = isNarrationRole
    ? {
      system: "You are a narrator. Reply with narration text only.",
      user: await buildNarrationPrompt(roleInput),
      prompt: await buildNarrationPrompt(roleInput),
      context: null,
    }
    : await buildRoleRequest(roleInput);

  const result = await runCliWithRetries({
    step: `${testCase.id}-${testCase.action.type}`,
    config: entry,
    systemPrompt: request.system,
    userMessage: request.user,
    logDir: null,
    retries: entry.retries ?? 0,
    env: entry.model && !process.env.RUNTIME_EVAL_MODEL ? { RUNTIME_EVAL_MODEL: entry.model } : null,
  });
  if (!result.ok) {
    throw new Error(`CLI ${testCase.action.type} failed: ${result.error?.message}`);
  }

  // Narration roles reply with prose; role-output roles reply with JSON whose
  // `narration` field carries the text.
  const roleOutput = isNarrationRole
    ? { narration: result.extracted }
    : parseFencedJson(result.extracted);
  const narration = typeof roleOutput.narration === "string" ? roleOutput.narration : "";
  const speaker = action.speaker(testCase.given, testCase.action, blueprint);

  const response = makeResponse({
    action: testCase.action.type,
    request: testCase.action,
    parts: narration ? [{ text: narration, speaker }] : [],
    prompt: request.prompt,
    raw: roleOutput,
  });

  return {
    response,
    blueprint,
    blueprintPath,
    model: `${variant}${entry.model ? `:${entry.model}` : ""}`,
  };
}
