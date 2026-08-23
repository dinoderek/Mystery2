// Game-master adherence judges, bound to the runtime harness.
//
// These are NOT separate judges from the trace pipeline's gm_* dimensions —
// they are the same briefs and the same Zod schemas, loaded out of
// evaluation/judges/ and pointed at a different subject. The trace pipeline
// projects a whole played session; this module projects ONE stored interaction
// (the case's fixed history as unjudged context, the action under test as the
// single judged turn) and runs the identical prompt.
//
// That is the whole point of the split: a regression found on a played trace
// can be frozen into a runtime case (evaluation/runtime/cases-from-trace.mjs)
// and re-judged by the same standard on demand, without replaying a game.
//
// The judge model is invoked through the runtime harness's own pluggable CLI
// bindings (config/cli.json | cli.example.json): variant "judge" (a real model
// call) or "judge-stub" (deterministic, offline). Each judge is one model call,
// so a case running all four costs four calls per backend — they are opt-in via
// `judges` / `--judges`, never a default.
//
// judgeConfig.<judge_id> options:
//   cli           — CLI variant name (default "judge")
//   cliConfig     — inline CLI config entry, overrides the variant lookup (tests)
//   blueprintPath — override the interaction's blueprint_path

import fs from "node:fs/promises";
import path from "node:path";

import {
  ADHERENCE_JUDGE_IDS,
  composeJudgeSystemPrompt,
  loadSharedJudgeDefinition,
  loadSharedJudgeSystemPrompt,
  resolveVerdict,
  validateJudgeOutput,
} from "../../../judges/index.mjs";
import { projectInteractionSubject } from "../../../judges/subject.mjs";
import { runCliWithRetries } from "../../../pipeline/cli-runner.mjs";
import { loadCliConfig, parseFencedJson } from "../cli-config.mjs";
import { isAccusationRole, resolveRoleName } from "../roles.mjs";

const DEFAULT_VARIANT = "judge";

function errorResult(id, reason) {
  return { id, status: "error", score: null, details: { reason }, parts: [] };
}

async function loadBlueprint(interaction, config) {
  const blueprintPath = config.blueprintPath ?? interaction.blueprint_path;
  if (!blueprintPath) {
    throw new Error(
      "no blueprint_path on the interaction — these judges grade against the blueprint, " +
        "so pass judgeConfig.blueprintPath or re-collect the interaction",
    );
  }
  const resolved = path.resolve(process.cwd(), blueprintPath);
  return JSON.parse(await fs.readFile(resolved, "utf-8"));
}

/**
 * Build the judge's user message for one interaction. Exported for tests and
 * for anyone wanting to see exactly what a judge is handed.
 */
export function buildJudgeUserMessage(judgeId, interaction, blueprint) {
  const actionType = interaction.action?.type ?? null;
  // Label the judged turn with the role the model actually ran as, resolved
  // through the harness's own action map. If an action has no local mapping (or
  // its resolver needs a field this capture lacks), fall back to the action
  // type: a slightly coarser label is better than failing the judge.
  let roleName = actionType;
  try {
    roleName =
      resolveRoleName(
        actionType,
        interaction.given ?? {},
        interaction.action ?? {},
        blueprint,
        interaction.given?.history,
      ) ?? actionType;
  } catch {
    roleName = actionType;
  }
  const subject = projectInteractionSubject(interaction, {
    roleName,
    isAccusationPhase: isAccusationRole(roleName),
  });
  return JSON.stringify({
    dimension_id: judgeId,
    context: null,
    blueprint,
    subject,
  });
}

async function runAdherenceJudge(judgeId, interaction, config) {
  const definition = await loadSharedJudgeDefinition(judgeId);
  if (!definition) throw new Error(`No shared judge definition for "${judgeId}"`);

  const blueprint = await loadBlueprint(interaction, config);
  const narration = interaction.response?.narration_text ?? "";
  if (narration.trim().length === 0) {
    return errorResult(judgeId, "response has no narration text to judge");
  }

  const entry = config.cliConfig ?? (await loadCliConfig(config.cli ?? DEFAULT_VARIANT));
  const systemPrompt = composeJudgeSystemPrompt({
    base: await loadSharedJudgeSystemPrompt(),
    dimensionText: definition.text,
    schema: definition.schema,
    context: null,
  });

  // RUNTIME_EVAL_JUDGE_MODEL overrides the variant's model, and the wrappers
  // read RUNTIME_EVAL_MODEL — same indirection the age_appropriate judge uses,
  // so both LLM judges honor the documented override.
  const judgeModel = process.env.RUNTIME_EVAL_JUDGE_MODEL ?? entry.model;

  const result = await runCliWithRetries({
    step: `judge-${judgeId}-${interaction.case_id ?? "case"}`,
    config: entry,
    systemPrompt,
    userMessage: buildJudgeUserMessage(judgeId, interaction, blueprint),
    logDir: null,
    retries: entry.retries ?? 0,
    // Validate INSIDE the retry loop: a judge that replies with prose instead
    // of its JSON object is a real, retriable model failure, not a dead run.
    validateExtracted: (extracted) => {
      const validation = validateJudgeOutput(parseFencedJson(extracted), definition.schema);
      if (!validation.ok) throw new Error(validation.message);
    },
    env: judgeModel ? { RUNTIME_EVAL_MODEL: judgeModel } : null,
  });
  if (!result.ok) {
    return errorResult(judgeId, result.error?.message ?? "judge CLI failed");
  }

  // Re-parse the attempt that passed validateExtracted above.
  const validation = validateJudgeOutput(parseFencedJson(result.extracted), definition.schema);
  if (!validation.ok) return errorResult(judgeId, validation.message);

  const verdict = resolveVerdict(validation.data);

  return {
    id: judgeId,
    status: verdict.status,
    // Headline number: major findings. 0 is a clean turn; lower is better.
    score: verdict.major_count,
    details: {
      judge_model: `${config.cli ?? DEFAULT_VARIANT}${judgeModel ? `:${judgeModel}` : ""}`,
      major_count: verdict.major_count,
      minor_count: verdict.minor_count,
      model_verdict: verdict.model_verdict,
      // Surfaced rather than resolved silently: a judge that lists a major
      // finding and then says "pass" is contradicting its own evidence, and
      // that is worth seeing when iterating on a brief.
      verdict_disagreement: verdict.verdict_disagreement,
      reasoning: validation.data.reasoning ?? "",
      findings: validation.data.findings ?? [],
    },
    parts: [],
  };
}

/** Build the judge module for one shared judge id. */
export function makeAdherenceJudge(judgeId) {
  return {
    id: judgeId,
    async judge(interaction, { config = {} } = {}) {
      try {
        return await runAdherenceJudge(judgeId, interaction, config);
      } catch (err) {
        return errorResult(judgeId, err instanceof Error ? err.message : String(err));
      }
    },
  };
}

/** Every shared adherence judge, ready to register. */
export const adherenceJudges = ADHERENCE_JUDGE_IDS.map(makeAdherenceJudge);
