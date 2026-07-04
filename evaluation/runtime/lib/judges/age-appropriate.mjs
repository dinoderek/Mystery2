// LLM judge for age-appropriate language.
//
// Where the deterministic `flesch` judge scores the formula-visible half of
// readability (sentence length x syllables), this judge asks a model about
// what the formula cannot see: unfamiliar vocabulary, idioms and figurative
// language a child would misread, and phrasing a target-age reader cannot
// parse. The standard it judges against is rendered from the same
// age-profile module that generated the narration's own prompt guidance
// (supabase/functions/_shared/age-profile.ts), so narrator and judge share
// one source of truth per age.
//
// The judge model is invoked through the harness's pluggable CLI bindings
// (config/cli.json | cli.example.json): variant "judge" (a real model call)
// or "judge-stub" (deterministic, offline). NOTE this makes rejudge.mjs runs
// that include this judge cost a model call — the narrator is never re-run,
// but the judge model is.
//
// judgeConfig.age_appropriate options:
//   cli        — CLI variant name (default "judge")
//   cliConfig  — inline CLI config entry, overrides the variant lookup (tests)
//   targetAge  — override the interaction's target_age

import { runCliWithRetries } from "../../../pipeline/cli-runner.mjs";
import { loadCliConfig } from "../cli-config.mjs";

export const id = "age_appropriate";

const DEFAULT_VARIANT = "judge";

const FINDING_KINDS = [
  "vocabulary",
  "sentence_length",
  "figurative_language",
  "clarity",
];

const OUTPUT_CONTRACT = `{
  "estimated_reading_age": <integer — the youngest age that could comfortably read this text unaided>,
  "findings": [
    {
      "quote": "<short verbatim quote of the offending phrase>",
      "kind": "vocabulary" | "sentence_length" | "figurative_language" | "clarity",
      "why": "<why a target-age reader stumbles here>",
      "suggestion": "<optional age-appropriate rewording>"
    }
  ],
  "verdict": "pass" | "fail",
  "reasoning": "<one short paragraph>"
}`;

async function buildSystemPrompt(targetAge) {
  const { renderComplexityGuidance } = await import(
    "../../../../supabase/functions/_shared/age-profile.ts"
  );
  return [
    `You are an expert in children's reading levels. You are judging ONE piece of narration from a detective game played by a ${targetAge}-year-old child.`,
    ``,
    `The narration was generated under these writing instructions:`,
    ``,
    renderComplexityGuidance(targetAge),
    ``,
    `Judge whether the narration actually follows them. Look for what a readability formula cannot see:`,
    `- vocabulary: words a ${targetAge}-year-old would not know and cannot work out from context`,
    `- sentence_length: sentences that stack clauses well past the guidance`,
    `- figurative_language: idioms, metaphors, or irony a child this age would misread`,
    `- clarity: phrasing where the child cannot tell what they are being told`,
    ``,
    `Verdict "pass" iff the narration as a whole is comfortable for a ${targetAge}-year-old to read unaided. Stretch words within the stated new-word allowance are fine; a pattern of overshooting is not. Judge language complexity only — tone and content suitability are out of scope.`,
    ``,
    `Respond with ONLY a single JSON object (no prose, no code fences) matching:`,
    ``,
    OUTPUT_CONTRACT,
  ].join("\n");
}

/** Strip ```json fences a model may wrap around its JSON, then parse. */
function parseVerdictJson(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  return JSON.parse(cleaned);
}

/** Shape-check the model's verdict; throws with a specific message on miss. */
export function validateVerdict(parsed) {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("judge output is not a JSON object");
  }
  if (parsed.verdict !== "pass" && parsed.verdict !== "fail") {
    throw new Error(`judge output verdict must be "pass" or "fail", got ${JSON.stringify(parsed.verdict)}`);
  }
  if (!Number.isInteger(parsed.estimated_reading_age)) {
    throw new Error("judge output estimated_reading_age must be an integer");
  }
  if (!Array.isArray(parsed.findings)) {
    throw new Error("judge output findings must be an array");
  }
  for (const f of parsed.findings) {
    if (typeof f?.quote !== "string" || typeof f?.why !== "string") {
      throw new Error("each finding needs string quote and why");
    }
    if (!FINDING_KINDS.includes(f.kind)) {
      throw new Error(`finding kind must be one of ${FINDING_KINDS.join(", ")}, got ${JSON.stringify(f.kind)}`);
    }
  }
  if (typeof parsed.reasoning !== "string") {
    throw new Error("judge output reasoning must be a string");
  }
  return parsed;
}

export async function judge(interaction, { config = {} } = {}) {
  const targetAge = config.targetAge ?? interaction.target_age;
  if (!Number.isFinite(targetAge)) {
    return {
      id,
      status: "error",
      score: null,
      details: { reason: "no target_age available on interaction or config" },
      parts: [],
    };
  }

  const response = interaction.response ?? {};
  const narration = response.narration_text ?? "";
  if (narration.trim().length === 0) {
    return {
      id,
      status: "error",
      score: null,
      details: { reason: "response has no narration text to judge", target_age: targetAge },
      parts: [],
    };
  }

  let entry;
  const variant = config.cli ?? DEFAULT_VARIANT;
  try {
    entry = config.cliConfig ?? (await loadCliConfig(variant));
  } catch (err) {
    return {
      id,
      status: "error",
      score: null,
      details: { reason: err instanceof Error ? err.message : String(err), target_age: targetAge },
      parts: [],
    };
  }

  const systemPrompt = await buildSystemPrompt(targetAge);
  const userMessage = JSON.stringify({
    target_age: targetAge,
    action: {
      type: interaction.action?.type ?? null,
      player_input: interaction.action?.player_input ?? null,
    },
    narration,
    narration_parts: (response.narration_parts ?? []).map((p) => ({
      speaker: p?.speaker?.kind ?? null,
      text: p?.text ?? "",
    })),
  });

  const judgeModel = process.env.RUNTIME_EVAL_JUDGE_MODEL ?? entry.model;
  const outcome = await runCliWithRetries({
    step: `judge-age-${interaction.case_id ?? "interaction"}`,
    config: entry,
    systemPrompt,
    userMessage,
    logDir: null,
    retries: entry.retries ?? 0,
    validateExtracted: (extracted) => validateVerdict(parseVerdictJson(extracted)),
    env: judgeModel ? { RUNTIME_EVAL_MODEL: judgeModel } : null,
  });

  if (!outcome.ok) {
    return {
      id,
      status: "error",
      score: null,
      details: {
        reason: outcome.error?.message ?? "judge CLI failed",
        target_age: targetAge,
        attempts: outcome.attempts,
      },
      parts: [],
    };
  }

  const verdict = validateVerdict(parseVerdictJson(outcome.extracted));
  return {
    id,
    status: verdict.verdict,
    score: verdict.estimated_reading_age,
    details: {
      target_age: targetAge,
      estimated_reading_age: verdict.estimated_reading_age,
      findings: verdict.findings,
      reasoning: verdict.reasoning,
      judge_model: `${config.cliConfig ? "inline" : variant}${judgeModel ? `:${judgeModel}` : ""}`,
      attempts: outcome.attempts,
    },
    parts: [],
  };
}
