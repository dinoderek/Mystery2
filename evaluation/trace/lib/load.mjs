// Loaders for the trace-evaluation pipeline. Mirrors the blueprint pipeline's
// load.mjs but rooted at evaluation/trace/ so the two dimension batteries stay
// independent.

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const TRACE_ROOT = path.resolve(HERE, "..");

export function traceRoot() {
  return TRACE_ROOT;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

function dimensionIdToFilename(id, ext = "md") {
  return `${id.replace(/_/g, "-")}.${ext}`;
}

// The trace dimension battery: the judge dimensions run on every trace plus
// their default context. Mechanical checks are always-on and not listed here.
export async function loadTraceDimensions() {
  const registryPath = path.join(TRACE_ROOT, "dimensions", "registry.json");
  const registry = await readJson(registryPath);
  if (!Array.isArray(registry.dimensions)) {
    throw new Error(`${registryPath} must define a "dimensions" array.`);
  }
  return { dimensions: registry.dimensions, mechanical_context: registry.mechanical_context ?? null };
}

export async function loadTraceDimensionDefinition(dimensionId) {
  const filePath = path.join(
    TRACE_ROOT,
    "dimensions",
    dimensionIdToFilename(dimensionId),
  );
  const text = await fs.readFile(filePath, "utf8");

  const schemaPath = path.join(
    TRACE_ROOT,
    "dimensions",
    dimensionIdToFilename(dimensionId, "schema.ts"),
  );
  let schema = null;
  try {
    await fs.access(schemaPath);
    const mod = await import(url.pathToFileURL(schemaPath).href);
    if (!mod.schema) {
      throw new Error(
        `${dimensionId} schema must export a named 'schema' (Zod schema).`,
      );
    }
    schema = mod.schema;
  } catch (err) {
    if (err.code !== "ENOENT" && !/no such file/i.test(err.message)) throw err;
  }

  return { id: dimensionId, filePath, text, schema };
}

export async function loadTraceJudgeSystemPrompt() {
  return fs.readFile(
    path.join(TRACE_ROOT, "prompts", "judge-system.md"),
    "utf8",
  );
}

export async function loadCliConfig(configPath) {
  return readJson(path.resolve(configPath));
}
