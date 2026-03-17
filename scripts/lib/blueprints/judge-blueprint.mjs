import fs from "node:fs/promises";

import { AIJudgeReportSchema, BlueprintV2Schema } from "./contracts.mjs";
import { deriveArtifactPaths } from "./draft-runs.mjs";
import { buildJudgePrompt } from "./judge-prompt.mjs";

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
    throw new Error(`Judge provider failed (${response.status})`);
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
