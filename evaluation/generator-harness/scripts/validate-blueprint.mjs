#!/usr/bin/env node
// Blueprint V2 validator. Standalone — invoked by the generator agent (and by
// the harness as a sanity check after the agent exits).
//
// Usage: node validate-blueprint.mjs <path-to-blueprint.json>
//
// Exit codes:
//   0 — blueprint parsed and passed BlueprintV2Schema
//   1 — schema validation failed (issues printed to stderr)
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

async function main() {
  const blueprintPath = process.argv[2];
  if (!blueprintPath) {
    process.stderr.write("usage: validate-blueprint.mjs <blueprint.json>\n");
    process.exit(3);
  }

  let raw;
  try {
    raw = await fs.readFile(path.resolve(blueprintPath), "utf8");
  } catch (err) {
    process.stderr.write(`read error: ${err.message}\n`);
    process.exit(2);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`invalid JSON: ${err.message}\n`);
    process.exit(2);
  }

  const result = BlueprintV2Schema.safeParse(parsed);
  if (result.success) {
    process.stdout.write(`OK: ${blueprintPath} (BlueprintV2)\n`);
    process.exit(0);
  }

  process.stderr.write(
    `INVALID: ${blueprintPath} — ${result.error.issues.length} issue(s):\n`,
  );
  for (const issue of result.error.issues) {
    const where = issue.path.length ? issue.path.join(".") : "(root)";
    const got = "received" in issue ? ` (got: ${JSON.stringify(issue.received).slice(0, 80)})` : "";
    process.stderr.write(`  - ${where}: ${issue.message}${got}\n`);
  }
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
});
