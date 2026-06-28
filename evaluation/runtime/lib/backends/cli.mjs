// CLI model backend (deterministic single-event prompt-replay).
//
// Reconstructs the REAL runtime prompt+context for the case's ONE action from
// the fixed `given` state + explicit history (via lib/prompt-build.mjs, which
// imports the shared builders), and pipes it to a local CLI (claude / openai /
// stub) using the evaluation pipeline's runCli. Because the input is fully
// specified by the case — not accumulated over turns — every model receives
// byte-identical input, so outputs are directly comparable.
//
// Replays the roles that have a `cli` mapping in lib/roles.mjs (talk -> talk_start,
// ask -> talk_conversation today). Add a mapping there to support another role.

import fs from "node:fs/promises";
import path from "node:path";
import { runCliWithRetries } from "../../../pipeline/cli-runner.mjs";
import { buildRoleRequest } from "../prompt-build.mjs";
import { makeResponse } from "../transcript.mjs";
import { getAction, normalizeHistory } from "../roles.mjs";

export const id = "cli";

const CONFIG_DIR = path.join("evaluation", "runtime", "config");

async function loadCliConfig(variant) {
  const override = path.resolve(process.cwd(), CONFIG_DIR, "cli.json");
  const example = path.resolve(process.cwd(), CONFIG_DIR, "cli.example.json");
  let file = example;
  try {
    await fs.access(override);
    file = override;
  } catch {
    // fall back to the committed example
  }
  const all = JSON.parse(await fs.readFile(file, "utf-8"));
  const entry = all[variant];
  if (!entry) {
    throw new Error(
      `CLI variant "${variant}" not found in ${path.relative(process.cwd(), file)}. ` +
        `Known: ${Object.keys(all).filter((k) => !k.startsWith("_")).join(", ")}`,
    );
  }
  return entry;
}

/** Strip ```json fences a model may wrap around its JSON, then parse. */
function parseRoleJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

export async function collect(testCase, ctx) {
  const variant = ctx.variant ?? "claude";
  const entry = await loadCliConfig(variant);
  const action = getAction(testCase.action.type);
  if (!action.cli) {
    throw new Error(
      `Action "${testCase.action.type}" has no CLI prompt mapping yet. ` +
        `Use the endpoint backend, or add a cli mapping in lib/roles.mjs.`,
    );
  }

  const blueprintPath = path.resolve(process.cwd(), testCase.blueprint.path);
  const blueprint = JSON.parse(await fs.readFile(blueprintPath, "utf-8"));
  const history = normalizeHistory(testCase.given.history);

  const request = await buildRoleRequest({
    role: action.cli.role,
    builder: action.cli.builder,
    contextInput: action.cli.contextInput(testCase.given, testCase.action, blueprint, history),
    promptVars: action.cli.promptVars(testCase.given, testCase.action, blueprint),
  });

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

  const roleOutput = parseRoleJson(result.extracted);
  const narration = typeof roleOutput.narration === "string" ? roleOutput.narration : "";
  const speaker = action.cli.speaker(testCase.given, testCase.action, blueprint);

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
