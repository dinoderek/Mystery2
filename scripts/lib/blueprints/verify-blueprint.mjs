import fs from "node:fs/promises";
import path from "node:path";

import { BlueprintV2Schema, VerificationReportSchema } from "./contracts.mjs";
import { createStageDiagnostics, formatStageError } from "./diagnostics.mjs";
import { deriveArtifactPaths } from "./draft-runs.mjs";
import { calculateSolvePath } from "./solve-path.mjs";

function publicTextBlocks(blueprint) {
  return [
    blueprint.metadata.title,
    blueprint.metadata.one_liner,
    blueprint.narrative.premise,
    ...blueprint.narrative.starting_knowledge,
    ...blueprint.world.locations.flatMap((location) => [
      location.name,
      location.description,
      ...location.search_context,
    ]),
    ...blueprint.evidence.map((evidence) => evidence.player_text),
  ].join("\n").toLowerCase();
}

export async function verifyBlueprintPath(blueprintPath) {
  const raw = await fs.readFile(blueprintPath, "utf-8");
  const blocking = [];
  const warning = [];
  const info = [];
  let blueprint;

  try {
    blueprint = BlueprintV2Schema.parse(JSON.parse(raw));
  } catch (error) {
    const diagnostics = createStageDiagnostics({
      stage: "verify",
      blueprintPath,
      ruleId: "schema.parse",
    });
    throw new Error(formatStageError(error instanceof Error ? error.message : String(error), diagnostics));
  }

  if (blueprint.world.locations.length < 3) {
    blocking.push({ rule_id: "counts.locations", message: "At least 3 locations are required." });
  }
  if (blueprint.world.characters.length < 3) {
    blocking.push({ rule_id: "counts.characters", message: "At least 3 characters are required." });
  }
  if (blueprint.evidence.length < 3) {
    blocking.push({ rule_id: "counts.evidence", message: "At least 3 evidence items are required." });
  }

  const solvePath = calculateSolvePath(blueprint);
  if (!solvePath) {
    blocking.push({ rule_id: "solve_path.impossible", message: "No solve path reaches all essential evidence." });
  }

  const actionBudgetLimit = Math.floor(0.75 * blueprint.metadata.time_budget);
  if (solvePath && solvePath.required_actions > actionBudgetLimit) {
    blocking.push({
      rule_id: "solve_path.over_budget",
      message: `Essential solve path needs ${solvePath.required_actions} actions, above ${actionBudgetLimit}.`,
    });
  } else if (solvePath && solvePath.required_actions === actionBudgetLimit) {
    warning.push({
      rule_id: "solve_path.tight_budget",
      message: "Essential solve path exactly matches the warning threshold.",
    });
  }

  const culprit = blueprint.world.characters.find((character) =>
    character.character_key === blueprint.ground_truth.culprit_character_key
  );
  const culpritName = culprit ? `${culprit.first_name} ${culprit.last_name}`.toLowerCase() : "";
  const publicText = publicTextBlocks(blueprint);
  if (
    culpritName &&
    (publicText.includes(`${culprit.first_name.toLowerCase()} did it`) ||
      publicText.includes(culpritName) && publicText.includes("culprit"))
  ) {
    blocking.push({
      rule_id: "spoiler.public_name",
      message: "Public text appears to reveal the culprit directly.",
    });
  }

  const essentialTalk = blueprint.evidence.filter((evidence) =>
    evidence.essential &&
    evidence.acquisition_paths.every((path) => path.surface === "talk")
  );
  if (essentialTalk.length === blueprint.evidence.filter((evidence) => evidence.essential).length) {
    warning.push({
      rule_id: "evidence.clustered_surface",
      message: "All essential evidence is clustered behind one surface.",
    });
  }

  info.push({
    rule_id: "verify.summary",
    message: `Checked ${blueprint.world.locations.length} locations, ${blueprint.world.characters.length} characters, and ${blueprint.evidence.length} evidence items.`,
  });

  const report = VerificationReportSchema.parse({
    stage: "verify",
    blueprint_id: blueprint.id,
    blueprint_path: blueprintPath,
    status: blocking.length > 0 ? "fail" : warning.length > 0 ? "warn" : "pass",
    blocking_findings: blocking,
    warning_findings: warning,
    info_findings: info,
    computed_metrics: {
      location_count: blueprint.world.locations.length,
      character_count: blueprint.world.characters.length,
      evidence_count: blueprint.evidence.length,
      essential_evidence_count: blueprint.evidence.filter((evidence) => evidence.essential).length,
      required_actions: solvePath?.required_actions ?? Number.MAX_SAFE_INTEGER,
      action_budget_limit: actionBudgetLimit,
    },
  });

  const { deterministicReportPath } = deriveArtifactPaths(blueprintPath);
  await fs.writeFile(deterministicReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  return {
    report,
    reportPath: deterministicReportPath,
    exitCode: blocking.length > 0 ? 1 : 0,
  };
}
