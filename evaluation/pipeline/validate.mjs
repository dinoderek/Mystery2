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
//   blueprint     — BlueprintV2Schema (the full generated blueprint)
//   <dimension>   — any dimension id whose evaluation/dimensions/<id>.schema.ts
//                   exists (resolved generically, so adding a dimension needs
//                   no edit here)
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
const dimensionsDir = path.join(repoRoot, "evaluation", "dimensions");

async function knownSchemaNames() {
  const files = await fs.readdir(dimensionsDir);
  const dims = files
    .filter((f) => f.endsWith(".schema.ts"))
    .map((f) => f.replace(/\.schema\.ts$/, "").replaceAll("-", "_"))
    .sort();
  return ["blueprint", ...dims];
}

const [schemaName, candidatePath] = process.argv.slice(2);
if (!schemaName || !candidatePath) {
  process.stderr.write(
    "Usage: node evaluation/pipeline/validate.mjs <schema> <candidate.json>\n" +
      `Schemas: ${(await knownSchemaNames()).join(", ")}\n`,
  );
  process.exit(2);
}

let schema;
if (schemaName === "blueprint") {
  ({ BlueprintV2Schema: schema } = await import(
    path.join(repoRoot, "packages/shared/src/blueprint-schema-v2.ts")
  ));
} else {
  // Dimension ids use underscores everywhere except their schema filenames,
  // which use kebab-case to match the .md files next to them. Resolved
  // generically from the files on disk — a new dimension's schema is picked
  // up with no edit here (matching loadDimensionDefinition in load.mjs).
  const fileSlug = schemaName.replaceAll("_", "-");
  const schemaPath = path.join(dimensionsDir, `${fileSlug}.schema.ts`);
  try {
    await fs.access(schemaPath);
  } catch {
    process.stderr.write(
      `Unknown schema: ${schemaName}. Expected one of: ${(await knownSchemaNames()).join(", ")}\n`,
    );
    process.exit(2);
  }
  ({ schema } = await import(schemaPath));
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
