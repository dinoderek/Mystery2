// Schema validator CLI for the evaluation pipeline.
//
// Exposes the same Zod schemas the pipeline already imports so that an agent
// (or any caller) can validate a candidate JSON file against them before
// submission. The judge harness's validator
// (evaluation/judge-harness/scripts/validate-judge-output.mjs) delegates its
// shape check here, so an in-workspace judge agent self-validates its
// candidate verdict against the dimension schema before declaring done.
//
// Usage:
//   node evaluation/pipeline/validate.mjs <schema> <candidate.json>
//
// Schemas:
//   blueprint              — BlueprintV2Schema (the full generated blueprint)
//   solvability            — judge output for solvability
//   fairness               — judge output for fairness
//   coherence              — judge output for coherence
//   character_grounding    — judge output for character grounding
//   path_payoff            — judge output for path payoff
//
// Output:
//   On success: prints "OK" to stdout, exits 0.
//   On failure: prints JSON {ok:false, parse_error?:string, issues?:[...]}
//               to stdout, exits 1.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..");

const [schemaName, candidatePath] = process.argv.slice(2);
if (!schemaName || !candidatePath) {
  process.stderr.write(
    "Usage: node evaluation/pipeline/validate.mjs <schema> <candidate.json>\n" +
      "Schemas: blueprint, solvability, fairness, coherence, character_grounding\n",
  );
  process.exit(2);
}

const dimensionSchemas = new Set([
  "solvability",
  "fairness",
  "coherence",
  "character_grounding",
  "path_payoff",
]);

let schema;
if (schemaName === "blueprint") {
  ({ BlueprintV2Schema: schema } = await import(
    path.join(repoRoot, "packages/shared/src/blueprint-schema-v2.ts")
  ));
} else if (dimensionSchemas.has(schemaName)) {
  // Dimension ids use underscores everywhere except their schema filenames,
  // which use kebab-case to match the .md files next to them.
  const fileSlug = schemaName.replaceAll("_", "-");
  ({ schema } = await import(
    path.join(repoRoot, "evaluation/dimensions", `${fileSlug}.schema.ts`)
  ));
} else {
  process.stderr.write(
    `Unknown schema: ${schemaName}. Expected one of: blueprint, ${[
      ...dimensionSchemas,
    ].join(", ")}\n`,
  );
  process.exit(2);
}

let text;
try {
  text = await fs.readFile(candidatePath, "utf8");
} catch (err) {
  process.stderr.write(`Could not read ${candidatePath}: ${err.message}\n`);
  process.exit(2);
}

let parsed;
try {
  parsed = JSON.parse(text);
} catch (err) {
  process.stdout.write(
    JSON.stringify({ ok: false, parse_error: err.message }, null, 2) + "\n",
  );
  process.exit(1);
}

const result = schema.safeParse(parsed);
if (result.success) {
  process.stdout.write("OK\n");
  process.exit(0);
}

const issues = result.error.issues.map((i) => ({
  path: i.path.join("."),
  code: i.code,
  message: i.message,
  ...(i.expected ? { expected: i.expected } : {}),
  ...(i.received ? { received: i.received } : {}),
}));
process.stdout.write(
  JSON.stringify({ ok: false, issues }, null, 2) + "\n",
);
process.exit(1);
