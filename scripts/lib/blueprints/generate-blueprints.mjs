import fs from "node:fs/promises";
import path from "node:path";

import { BlueprintV2Schema } from "./contracts.mjs";
import {
  candidateBlueprintFilename,
  candidateRawOutputFilename,
  createDraftRun,
} from "./draft-runs.mjs";

async function requestCandidate({
  model,
  prompt,
  apiKey,
  fetchImpl = fetch,
}) {
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
        { role: "system", content: "Return Blueprint V2 JSON only." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Generation provider failed (${response.status})`);
  }

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    throw new Error("Generation provider returned non-string content");
  }
  return content;
}

export async function runBlueprintGeneration({
  briefPath,
  count = 1,
  model,
  apiKey,
  draftsRoot,
  now,
  fetchImpl,
  requestCandidateImpl = requestCandidate,
}) {
  const run = await createDraftRun({ briefPath, draftsRoot, now });
  const prompt = await fs.readFile(
    path.join("supabase", "functions", "_shared", "blueprints", "generator-prompt.md"),
    "utf-8",
  );

  const results = [];
  for (let index = 1; index <= count; index += 1) {
    const raw = await requestCandidateImpl({
      model,
      apiKey,
      fetchImpl,
      prompt: `${prompt}\n\nBrief:\n${run.brief}`,
    });

    try {
      const parsed = BlueprintV2Schema.parse(JSON.parse(raw));
      const outputPath = path.join(run.runDir, candidateBlueprintFilename(index));
      await fs.writeFile(outputPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf-8");
      results.push({ index, status: "generated", outputPath });
    } catch {
      const outputPath = path.join(run.runDir, candidateRawOutputFilename(index));
      await fs.writeFile(outputPath, raw, "utf-8");
      results.push({ index, status: "raw_only", outputPath });
    }
  }

  const generatedCount = results.filter((result) => result.status === "generated").length;
  if (generatedCount === 0) {
    const error = new Error("No valid Blueprint V2 candidates were generated.");
    error.results = results;
    error.runDir = run.runDir;
    throw error;
  }

  return { ...run, results };
}
