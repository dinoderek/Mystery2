// Shared game-master judge layer.
//
// One judge definition = one `<id>.md` prose contract + one `<id>.schema.ts`
// Zod schema, exactly as the blueprint and trace dimension batteries already
// work. What is new here is that these definitions are subject-agnostic: they
// are written against the projection in subject.mjs, so the SAME brief and the
// SAME output schema grade a whole played trace (evaluation/trace) and a single
// replayed interaction (evaluation/runtime).
//
// The two harnesses bind this layer differently — the trace pipeline runs them
// as registry dimensions through its own CLI config, the runtime harness runs
// them as judges through its own CLI config — but neither owns the contract.

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));

/**
 * The game-master adherence battery: does the narration honor the blueprint?
 * Broken into four judges rather than one because the repo's dimension
 * convention buys parallelism, iteration isolation (editing the roleplay brief
 * cannot regress spoiler scores), and targeted retries.
 */
export const ADHERENCE_JUDGE_IDS = [
  "gm_roleplay",
  "gm_clue_discipline",
  "gm_fabrication",
  "gm_spoiler",
];

export function judgesRoot() {
  return HERE;
}

function idToFilename(id, ext = "md") {
  return `${id.replace(/_/g, "-")}.${ext}`;
}

export function isSharedJudgeId(id) {
  return ADHERENCE_JUDGE_IDS.includes(id);
}

/**
 * Load a judge definition by id: its prose contract and (when present) the Zod
 * schema its output must satisfy. Returns null when the id is not a shared
 * judge, so a caller can fall back to its own local battery.
 */
export async function loadSharedJudgeDefinition(id) {
  const filePath = path.join(HERE, idToFilename(id));
  let text;
  try {
    text = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }

  const schemaPath = path.join(HERE, idToFilename(id, "schema.ts"));
  const mod = await import(url.pathToFileURL(schemaPath).href);
  if (!mod.schema) {
    throw new Error(`${id} schema must export a named 'schema' (Zod schema).`);
  }
  return { id, filePath, text, schema: mod.schema };
}

export async function loadSharedJudgeSystemPrompt() {
  return fs.readFile(path.join(HERE, "prompts", "judge-system.md"), "utf8");
}

/**
 * Compose the judge's system prompt: the shared evaluator preamble, the
 * dimension's own contract, the authoritative JSON Schema, and any per-run
 * context. Shared so a judge reads identically from either harness.
 */
export function composeJudgeSystemPrompt({ base, dimensionText, schema, context }) {
  let composed = `${base}\n\n---\n\n${dimensionText}`;
  if (schema) {
    const jsonSchema = zodToJsonSchema(schema, { target: "jsonSchema7" });
    composed +=
      `\n\n---\n\n## Output JSON Schema (authoritative)\n\n` +
      `Your response MUST be a single JSON object matching this schema. ` +
      `If the prose contract above and this schema disagree, the schema wins.\n\n` +
      `\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\n`;
  }
  if (context && typeof context === "object") {
    composed += `\n\n---\n\n## Dimension context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
  }
  return composed;
}

/** Validate a parsed judge response against its schema. */
export function validateJudgeOutput(parsed, schema) {
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, message: "Judge output is not a JSON object." };
  }
  if (!schema) {
    if (!("verdict" in parsed)) {
      return { ok: false, message: "Judge output missing verdict." };
    }
    return { ok: true, data: parsed };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return { ok: false, message: `Judge output failed schema validation: ${issues}` };
  }
  return { ok: true, data: result.data };
}

/**
 * The shared pass/fail rule, applied to every judge in this battery: a verdict
 * fails iff the judge reported at least one `major` finding. The model also
 * states a `verdict`; when the two disagree the findings win, because a model
 * that lists a major defect and then says "pass" is contradicting its own
 * evidence. Disagreements are surfaced, not silently resolved.
 */
export function resolveVerdict(data) {
  const findings = Array.isArray(data.findings) ? data.findings : [];
  const majors = findings.filter((f) => f?.severity === "major");
  const status = majors.length > 0 ? "fail" : "pass";
  return {
    status,
    major_count: majors.length,
    minor_count: findings.length - majors.length,
    model_verdict: data.verdict ?? null,
    verdict_disagreement: data.verdict ? data.verdict !== status : false,
  };
}
