/**
 * Replays one case through a narrator binding: no server, no database.
 *
 * It rebuilds the real runtime prompt and context for the case's one action
 * from the fixed `given` state and explicit history (`prompt-build.ts`, which
 * shares the server handlers' assembly) and sends it through the core's model
 * runner. The input is fully specified by the case, not accumulated over
 * turns, so every model receives byte-identical input and the outputs compare
 * directly.

 */

import { runModel } from "../../core/runner.ts";
import type { ResolvedBinding } from "../../core/config.ts";
import type { ModelCall } from "../../core/result.ts";
import type {
  NarrationRoleInput,
  TemplateRoleInput,
} from "../../../packages/game-engine/src/role-request.ts";
import type { BlueprintLike, TurnCase } from "./case.ts";
import { parseFencedJson } from "./model-json.ts";
import { buildNarrationPrompt, buildRoleRequest } from "./prompt-build.ts";
import type { ModelRequest } from "./prompt-build.ts";
import { getAction, normalizeHistory } from "./roles.ts";
import { makeResponse } from "./transcript.ts";
import type { TurnResponse } from "./transcript.ts";

/** Narration roles reply with prose rather than a role-output JSON contract. */
const NARRATION_ROLES = new Set(["intro", "ambience"]);

/** What a narrator source hands back for one case. */
export interface Collected {
  response: TurnResponse;
  /** The model behind the narration, as the stored turn records it. */
  model: string;
  /** The narrator's call through the runner, when the harness made it. */
  call: ModelCall | null;
}

export interface CliReplayRequest {
  testCase: TurnCase;
  blueprint: BlueprintLike;
  binding: ResolvedBinding;
  logDir: string;
}

/** What the provider sends for each shape of role (see `OpenRouterProvider.generateNarration` and `generateRoleOutput`). */
async function composeRequest(testCase: TurnCase, blueprint: BlueprintLike): Promise<{ request: ModelRequest; narration: boolean }> {
  const action = getAction(testCase.action.type);
  const history = normalizeHistory(testCase.given.history);
  const roleInput = action.roleInput(testCase.given, testCase.action, blueprint, history);
  if (NARRATION_ROLES.has(roleInput.role)) {
    const prompt = buildNarrationPrompt(roleInput as unknown as NarrationRoleInput);
    const system = "You are the narrator for a kids mystery game. Return plain text only.";
    return { request: { system, user: prompt, prompt, context: null }, narration: true };
  }
  return { request: await buildRoleRequest(roleInput as unknown as TemplateRoleInput), narration: false };
}

export function modelLabel(binding: ResolvedBinding): string {
  return `${binding.name}${binding.model ? `:${binding.model}` : ""}`;
}

export async function replayThroughNarrator({ testCase, blueprint, binding, logDir }: CliReplayRequest): Promise<Collected> {
  const action = getAction(testCase.action.type);
  const { request, narration } = await composeRequest(testCase, blueprint);

  const result = await runModel({
    binding,
    step: `narrate-${testCase.id}-${testCase.action.type}`,
    systemPrompt: request.system,
    userMessage: request.user,
    logDir,
    // Prose is not JSON, so a narration role is read as text when the wrapper
    // prints it bare; a wrapper that prints an envelope names where the text is.
    output: narration && binding.extract_path === null ? "text" : "json",
    // Validated inside the retry loop: prose where JSON was asked for is a retriable failure.
    parse: narration ? undefined : (answer) => parseFencedJson(answer) as Record<string, unknown>,
  });
  if (!result.ok) throw new Error(`narrator ${testCase.action.type} failed: ${result.error}`);

  // Narration roles reply with prose; role-output roles reply with JSON whose
  // `narration` field carries the text.
  const roleOutput = narration ? { narration: result.answer } : (result.value as Record<string, unknown>);
  const text = typeof roleOutput.narration === "string" ? roleOutput.narration : "";
  const speaker = action.speaker(testCase.given, testCase.action, blueprint);

  const response = makeResponse({
    action: testCase.action.type,
    request: { ...testCase.action },
    parts: text ? [{ text, speaker }] : [],
    prompt: request.prompt,
    raw: roleOutput,
  });
  return { response, model: modelLabel(binding), call: result.call };
}
