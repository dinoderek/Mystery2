import fs from "node:fs/promises";

import { AIJudgeReportSchema, BlueprintV2Schema } from "./contracts.mjs";
import { deriveArtifactPaths } from "./draft-runs.mjs";
import { buildJudgePrompt } from "./judge-prompt.mjs";
import { assertRequiredConfig } from "../../supabase-utils.mjs";

const MAX_ERROR_BODY_LENGTH = 8_000;

async function readResponseBody(response) {
  try {
    const text = await response.text();
    if (text.length <= MAX_ERROR_BODY_LENGTH) {
      return text;
    }
    return `${text.slice(0, MAX_ERROR_BODY_LENGTH)}\n... [truncated ${text.length - MAX_ERROR_BODY_LENGTH} chars]`;
  } catch (error) {
    return `[unavailable: ${error instanceof Error ? error.message : String(error)}]`;
  }
}

function validateBlueprintJudgeConfig({ model, apiKey }) {
  assertRequiredConfig("Blueprint judging", [
    {
      value: apiKey,
      label: "OPENROUTER_API_KEY",
      fix:
        "set it in `.env.local` or shell env before running `npm run judge:blueprint`",
    },
    {
      value: model,
      label: "judge model",
      fix:
        "pass `--model <id>` or set `OPENROUTER_BLUEPRINT_VERIFIER_MODEL` in `.env.local`",
    },
  ]);
}

async function requestJson({ model, prompt, apiKey, fetchImpl = fetch }) {
  const response = await fetchImpl("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a strict JSON API. Output JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    const responseBody = await readResponseBody(response);
    const keyHint = response.status === 401
      ? " OpenRouter rejected the API key; check OPENROUTER_API_KEY in `.env.local` or shell env."
      : "";
    throw new Error(
      `Judge provider failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""}).${keyHint}\nResponse body:\n${responseBody}`,
    );
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Judge provider returned non-string content");
  }
  return JSON.parse(content);
}

export async function judgeBlueprintPath({
  blueprintPath,
  model,
  apiKey,
  fetchImpl,
  requestJsonImpl = requestJson,
}) {
  validateBlueprintJudgeConfig({ model, apiKey });

  const blueprint = BlueprintV2Schema.parse(
    JSON.parse(await fs.readFile(blueprintPath, "utf-8")),
  );

  const rawReport = await requestJsonImpl({
    model,
    prompt: buildJudgePrompt(blueprint),
    apiKey,
    fetchImpl,
  });

  const report = AIJudgeReportSchema.parse({
    ...rawReport,
    stage: "judge",
    blueprint_id: rawReport.blueprint_id ?? blueprint.id,
    blueprint_path: blueprintPath,
  });

  const { aiJudgeReportPath } = deriveArtifactPaths(blueprintPath);
  await fs.writeFile(aiJudgeReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  return { report, reportPath: aiJudgeReportPath };
}
