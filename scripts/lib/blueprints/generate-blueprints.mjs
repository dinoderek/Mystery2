import fs from "node:fs/promises";
import path from "node:path";

import {
  createDraftRun,
  generatedBlueprintFilename,
  generatedVerificationFilename,
} from "./draft-runs.mjs";
import { loadBlueprintGeneratorPrompt } from "./generator-prompt.mjs";
import { assertRequiredConfig } from "../../supabase-utils.mjs";
import { verifyBlueprintPath } from "./verify-blueprint.mjs";

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

function validateBlueprintGenerationConfig({ outputName, model, apiKey }) {
  assertRequiredConfig("Blueprint generation", [
    {
      value: outputName,
      label: "output name",
      fix:
        "pass `--output-name <name>` so generated artifacts use a stable, readable filename prefix",
    },
    {
      value: apiKey,
      label: "OPENROUTER_API_KEY",
      fix:
        "set it in `.env.local` or shell env before running `npm run generate:blueprints`",
    },
    {
      value: model,
      label: "generation model",
      fix:
        "pass `--model <id>` or set `OPENROUTER_BLUEPRINT_GENERATION_MODEL` in `.env.local`",
    },
  ]);
}

async function assertOutputTargetsAvailable(runDir, outputName, count) {
  const conflicts = [];

  for (let index = 1; index <= count; index += 1) {
    for (const filePath of [
      path.join(runDir, generatedBlueprintFilename(outputName, index)),
      path.join(runDir, generatedVerificationFilename(outputName, index)),
    ]) {
      try {
        await fs.access(filePath);
        conflicts.push(filePath);
      } catch {
        // File does not exist.
      }
    }
  }

  if (conflicts.length > 0) {
    throw new Error(
      `Blueprint generation would overwrite existing artifacts:\n${conflicts.map((filePath) => `- ${filePath}`).join("\n")}`,
    );
  }
}

function formatBlueprintOutput(raw) {
  try {
    return `${JSON.stringify(JSON.parse(raw), null, 2)}\n`;
  } catch {
    return raw.endsWith("\n") ? raw : `${raw}\n`;
  }
}

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
    const responseBody = await readResponseBody(response);
    const keyHint = response.status === 401
      ? " OpenRouter rejected the API key; check OPENROUTER_API_KEY in `.env.local` or shell env."
      : "";
    throw new Error(
      `Generation provider failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""}).${keyHint}\nResponse body:\n${responseBody}`,
    );
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
  outputName,
  count = 1,
  model,
  apiKey,
  draftsRoot,
  now,
  fetchImpl,
  logImpl = console.log,
  requestCandidateImpl = requestCandidate,
}) {
  validateBlueprintGenerationConfig({ outputName, model, apiKey });

  const run = await createDraftRun({ briefPath, outputName, draftsRoot, now });
  await assertOutputTargetsAvailable(run.runDir, run.outputName, count);
  const prompt = await loadBlueprintGeneratorPrompt();

  const results = [];
  for (let index = 1; index <= count; index += 1) {
    logImpl(
      `[blueprint-generation] Generating blueprint ${index} of ${count} with model ${model}...`,
    );
    const raw = await requestCandidateImpl({
      model,
      apiKey,
      fetchImpl,
      prompt: `${prompt}\n\nBrief:\n${run.brief}`,
    });

    const blueprintPath = path.join(run.runDir, generatedBlueprintFilename(run.outputName, index));
    await fs.writeFile(blueprintPath, formatBlueprintOutput(raw), "utf-8");
    const verification = await verifyBlueprintPath(blueprintPath);

    logImpl(
      `[blueprint-generation] Wrote ${path.basename(blueprintPath)} and ${path.basename(verification.reportPath)} (${verification.report.status}).`,
    );

    results.push({
      index,
      blueprintPath,
      verificationPath: verification.reportPath,
      verificationStatus: verification.report.status,
    });
  }

  const passingCount = results.filter((result) => result.verificationStatus !== "fail").length;
  if (passingCount === 0) {
    const error = new Error("No generated blueprints passed verification.");
    error.results = results;
    error.runDir = run.runDir;
    throw error;
  }

  return { ...run, results };
}
