#!/usr/bin/env node
// Blueprint V2 validator. Standalone — invoked by the generator agent (and by
// the harness as a sanity check after the agent exits).
//
// Usage: node validate-blueprint.ts <path-to-blueprint.json>
//
// A blueprint that passes the schema then gets the mechanical checks that need
// no brief (the clue graph, locks and hidden spots) and the `age_appropriate`
// analyzer, with the context its registry entry gives. Every failure is
// printed together, so the agent can fix them all before the blueprint is
// judged.
//
// Exit codes:
//   0 — blueprint passed BlueprintV2Schema, the mechanical checks and the
//       age_appropriate analyzer
//   1 — the schema, a mechanical check or the analyzer failed (printed to stderr)
//   2 — file missing or invalid JSON
//   3 — usage error
//
// Imports the Zod schema from the repo via a relative path. Node resolves
// imports from the script's *real* path (following symlinks), so this works
// whether the validator is called directly from
// evaluation/generator-harness/scripts/ or via a symlink in a workspace.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

// Real path of this script -> ../../../packages/shared/src/blueprint-schema-v2.ts
import { BlueprintV2Schema } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { analyze, type AgeAppropriateInput } from "../../checks/analyzers/age-appropriate.ts";
import { runMechanicalChecks } from "../../checks/mechanical.ts";
import { getJudgeEntry } from "../../core/registry.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main() {
  const blueprintPath = process.argv[2];
  if (!blueprintPath) {
    process.stderr.write("usage: validate-blueprint.ts <blueprint.json>\n");
    process.exit(3);
  }

  let raw;
  try {
    raw = await fs.readFile(path.resolve(blueprintPath), "utf8");
  } catch (err) {
    process.stderr.write(`read error: ${messageOf(err)}\n`);
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`invalid JSON: ${messageOf(err)}\n`);
    process.exit(2);
  }

  const result = BlueprintV2Schema.safeParse(parsed);
  if (!result.success) {
    process.stderr.write(
      `INVALID: ${blueprintPath} — ${result.error.issues.length} issue(s):\n`,
    );
    for (const issue of result.error.issues) {
      const where = issue.path.length ? issue.path.join(".") : "(root)";
      const got = "received" in issue ? ` (got: ${(JSON.stringify(issue.received) ?? "undefined").slice(0, 80)})` : "";
      process.stderr.write(`  - ${where}: ${issue.message}${got}\n`);
    }
    process.exit(1);
  }

  let ok = true;
  const failedChecks = runMechanicalChecks({ blueprintCandidate: parsed }).filter((check) => check.status === "fail");
  if (failedChecks.length > 0) {
    ok = false;
    process.stderr.write(`FAILED CHECKS: ${blueprintPath} — ${failedChecks.length} check(s). "Discovery graph" and "Hard Constraints" in prompts/generator-prompt.md say how to fix each:\n`);
    for (const check of failedChecks) {
      process.stderr.write(`  - ${check.id}: ${JSON.stringify(check.details)}\n`);
    }
  }

  const age = analyze({ blueprint: parsed, context: getJudgeEntry("age_appropriate").context as AgeAppropriateInput["context"] });
  if (age.status !== "pass") {
    ok = false;
    process.stderr.write(`TOO HARD TO READ: ${blueprintPath} — ${age.details.summary}. Shorten the sentences and use shorter words in:\n`);
    for (const violation of age.details.violations ?? []) {
      process.stderr.write(`  - ${violation.path}: grade ${violation.grade}, "${violation.preview}"\n`);
    }
  }

  if (!ok) process.exit(1);
  process.stdout.write(`OK: ${blueprintPath} (BlueprintV2; mechanical checks pass; ${age.details.summary})\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${messageOf(err)}\n`);
  process.exit(2);
});
