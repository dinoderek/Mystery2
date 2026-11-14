/**
 * The `api` generation backend: one OpenRouter call that writes a Blueprint V2
 * from a brief, run as the wrapper the `generator-api` binding names
 * (`evaluation/config/wrappers/openrouter-generate.sh`).
 *
 * It wraps `generateBlueprint` in `packages/blueprint-generator`, so the request
 * is the one the game's tooling has always sent: the generator prompt and the
 * age guidance, the brief, a strict JSON Schema response format with the
 * image-id fields removed, and `require_parameters`. The wrapper reads the
 * brief from the user message the runner wrote, the model from `EVAL_MODEL`
 * and the key from `OPENROUTER_API_KEY`; it prints the blueprint in the
 * `{ "result": "<blueprint JSON>" }` envelope the binding's `extract_path`
 * reads. The key is never printed or put in an error message.
 *
 * A blueprint that fails the schema is still printed, as it was checked, so the
 * command that ran the wrapper keeps it and its mechanical check says why it
 * failed, as it does for the agent backend; the envelope then also carries
 * `raw`, the model's own text, for the attempt's stdout log. Any other failure
 * exits non-zero and the runner retries as the binding says.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { BlueprintGenerationError, generateBlueprint } from "../../packages/blueprint-generator/src/index.ts";
import type { StoryBrief } from "../../packages/blueprint-generator/src/index.ts";
import { readEnvFile } from "../../packages/game-engine/src/env-file.ts";
import { resolveLocalConfigRoot } from "../../scripts/local-config.mjs";

export const OPENROUTER_KEY_VAR = "OPENROUTER_API_KEY";

/**
 * The OpenRouter key: `OPENROUTER_API_KEY` in the environment, else the same
 * name in `.env.local` in the config root (`MYSTERY_CONFIG_ROOT`, or the repo).
 * Null when neither has one.
 */
export function readOpenRouterKey(env: NodeJS.ProcessEnv, root: string): string | null {
  const fromEnv = env[OPENROUTER_KEY_VAR]?.trim();
  if (fromEnv) return fromEnv;
  const configRoot = resolveLocalConfigRoot(root, env);
  const fromFile = readEnvFile(path.join(configRoot, ".env.local"))[OPENROUTER_KEY_VAR]?.trim();
  return fromFile || null;
}

function timeoutFrom(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.AI_OPENROUTER_TIMEOUT_MS?.trim();
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid AI_OPENROUTER_TIMEOUT_MS "${raw}". Expected a positive integer.`);
  }
  return parsed;
}

async function readStoryBrief(userMessageFile: string): Promise<StoryBrief> {
  const message = JSON.parse(await fs.readFile(userMessageFile, "utf8")) as { story_brief?: StoryBrief };
  if (!message.story_brief) throw new Error(`${userMessageFile} has no story_brief`);
  return message.story_brief;
}

export interface OpenRouterRequest {
  /** The user message the runner wrote: `{ story_brief, instructions }`. */
  userMessageFile: string;
  /** `EVAL_MODEL`, `OPENROUTER_API_KEY`, and optionally `AI_OPENROUTER_TIMEOUT_MS` and `OPENROUTER_URL`. */
  env: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

/** Makes the one call and returns what the wrapper prints. Throws when there is no blueprint to print. */
export async function generateViaOpenRouter({ userMessageFile, env, fetchImpl }: OpenRouterRequest): Promise<string> {
  const model = env.EVAL_MODEL?.trim();
  if (!model) throw new Error("no model: set one on the generator-api binding or pass --model");
  const openRouterApiKey = env[OPENROUTER_KEY_VAR]?.trim();
  if (!openRouterApiKey) throw new Error(`${OPENROUTER_KEY_VAR} is not set`);
  const storyBrief = await readStoryBrief(userMessageFile);

  try {
    const blueprint = await generateBlueprint({
      storyBrief,
      model,
      openRouterApiKey,
      timeoutMs: timeoutFrom(env),
      baseUrl: env.OPENROUTER_URL?.trim() || undefined,
      fetchImpl,
    });
    return JSON.stringify({ result: JSON.stringify(blueprint, null, 2) });
  } catch (error) {
    if (!(error instanceof BlueprintGenerationError) || error.code !== "SCHEMA_VALIDATION_FAILED") throw error;
    // The result is the answer as the generator checked it, so the command's
    // own check reports what is really wrong rather than the nulls strict mode
    // forced; `raw` keeps what the model sent in the attempt's stdout log.
    const { checkedJson, responseText } = error.details;
    if (checkedJson === undefined) throw error;
    return JSON.stringify({ result: JSON.stringify(checkedJson, null, 2), raw: responseText });
  }
}

/** What a failed call says on stderr: the error's code and message, never its request. */
export function describeFailure(error: unknown): string {
  if (error instanceof BlueprintGenerationError) {
    const status = error.details.status === undefined ? "" : ` (HTTP ${error.details.status})`;
    return `${error.code}: ${error.message}${status}`;
  }
  return (error as Error)?.message ?? String(error);
}
