import fs from "node:fs/promises";
import { BlueprintV2Schema, VerificationReportSchema } from "./contracts.mjs";
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

function buildVerificationReport({
  blueprintPath,
  blueprintId = null,
  blocking = [],
  warning = [],
  info = [],
  computedMetrics = {
    location_count: 0,
    character_count: 0,
    evidence_count: 0,
    essential_evidence_count: 0,
    required_actions: 0,
    action_budget_limit: 0,
  },
  solvePath = null,
}) {
  return VerificationReportSchema.parse({
    stage: "verify",
    blueprint_id: blueprintId,
    blueprint_path: blueprintPath,
    status: blocking.length > 0 ? "fail" : warning.length > 0 ? "warn" : "pass",
    blocking_findings: blocking,
    warning_findings: warning,
    info_findings: info,
    computed_metrics: computedMetrics,
    solve_path: solvePath,
  });
}

export async function verifyBlueprintPath(blueprintPath) {
  const raw = await fs.readFile(blueprintPath, "utf-8");
  const { deterministicReportPath } = deriveArtifactPaths(blueprintPath);
  const blocking = [];
  const warning = [];
  const info = [];
  let parsed = null;
  let blueprint;

  try {
    parsed = JSON.parse(raw);
    blueprint = BlueprintV2Schema.parse(parsed);
  } catch (error) {
    const report = buildVerificationReport({
      blueprintPath,
      blueprintId:
        typeof parsed?.id === "string" && /^[0-9a-f-]{36}$/iu.test(parsed.id)
          ? parsed.id
          : null,
      blocking: [{
        rule_id: "schema.parse",
        message: error instanceof Error ? error.message : String(error),
      }],
      info: [{
        rule_id: "verify.summary",
        message: "Blueprint could not be fully parsed or validated.",
      }],
    });
    await fs.writeFile(deterministicReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
    return {
      report,
      reportPath: deterministicReportPath,
      exitCode: 1,
    };
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

  const report = buildVerificationReport({
    blueprintPath,
    blueprintId: blueprint.id,
    blocking,
    warning,
    info,
    computedMetrics: {
      location_count: blueprint.world.locations.length,
      character_count: blueprint.world.characters.length,
      evidence_count: blueprint.evidence.length,
      essential_evidence_count: blueprint.evidence.filter((evidence) => evidence.essential).length,
      required_actions: solvePath?.required_actions ?? Number.MAX_SAFE_INTEGER,
      action_budget_limit: actionBudgetLimit,
    },
    solvePath: solvePath
      ? {
        starting_location_key: solvePath.starting_location_key,
        starting_evidence_keys: solvePath.starting_evidence_keys,
        collected_evidence_keys: solvePath.collected_evidence_keys,
        actions: solvePath.actions,
      }
      : null,
  });
  await fs.writeFile(deterministicReportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");

  return {
    report,
    reportPath: deterministicReportPath,
    exitCode: blocking.length > 0 ? 1 : 0,
  };
}
