export function createStageDiagnostics({
  stage,
  blueprintPath = null,
  blueprintId = null,
  runId = null,
  ruleId = null,
  providerErrorClass = null,
}) {
  return {
    stage,
    blueprint_path: blueprintPath,
    blueprint_id: blueprintId,
    run_id: runId,
    rule_id: ruleId,
    provider_error_class: providerErrorClass,
  };
}

export function formatStageError(message, diagnostics) {
  return [
    message,
    `stage=${diagnostics.stage}`,
    diagnostics.blueprint_path ? `blueprint_path=${diagnostics.blueprint_path}` : null,
    diagnostics.blueprint_id ? `blueprint_id=${diagnostics.blueprint_id}` : null,
    diagnostics.run_id ? `run_id=${diagnostics.run_id}` : null,
    diagnostics.rule_id ? `rule_id=${diagnostics.rule_id}` : null,
    diagnostics.provider_error_class
      ? `provider_error_class=${diagnostics.provider_error_class}`
      : null,
  ].filter(Boolean).join(" ");
}
