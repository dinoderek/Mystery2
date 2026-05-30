import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

const REPO_ROOT = path.resolve(
  url.fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
);

export function repoRoot() {
  return REPO_ROOT;
}

export async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

export async function readText(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function loadSpec(specDir) {
  const absSpecDir = path.resolve(specDir);
  const brief = await readJson(path.join(absSpecDir, "input.brief.json"));
  return { specDir: absSpecDir, brief };
}

// The standard evaluation battery: which dimensions run on every blueprint and
// their default context. Central and story-agnostic — see
// evaluation/dimensions/registry.json. Replaces the old per-mystery
// outcome.spec.json dimension lists.
export async function loadDimensions() {
  const registryPath = path.join(
    REPO_ROOT,
    "evaluation",
    "dimensions",
    "registry.json",
  );
  const registry = await readJson(registryPath);
  if (!Array.isArray(registry.dimensions)) {
    throw new Error(`${registryPath} must define a "dimensions" array.`);
  }
  return registry.dimensions;
}

export async function loadCliConfig(configPath) {
  return readJson(path.resolve(configPath));
}

export async function loadDimensionDefinition(dimensionId) {
  const filename = dimensionIdToFilename(dimensionId);
  const filePath = path.join(REPO_ROOT, "evaluation", "dimensions", filename);
  const text = await readText(filePath);

  const schemaFilename = dimensionIdToFilename(dimensionId, "schema.ts");
  const schemaPath = path.join(REPO_ROOT, "evaluation", "dimensions", schemaFilename);
  let schema = null;
  try {
    await fs.access(schemaPath);
    const mod = await import(url.pathToFileURL(schemaPath).href);
    if (!mod.schema) {
      throw new Error(`${schemaFilename} must export a named 'schema' (Zod schema).`);
    }
    schema = mod.schema;
  } catch (err) {
    if (err.code !== "ENOENT" && !/no such file/i.test(err.message)) {
      throw err;
    }
  }

  return { id: dimensionId, filePath, text, schema, schemaPath: schema ? schemaPath : null };
}

export async function loadJudgeSystemPrompt() {
  return readText(path.join(REPO_ROOT, "evaluation", "prompts", "judge-system.md"));
}

export async function tryLoadAnalyzer(dimensionId) {
  const filename = dimensionIdToFilename(dimensionId, "mjs");
  const analyzerPath = path.join(REPO_ROOT, "evaluation", "checks", "analyzers", filename);
  try {
    await fs.access(analyzerPath);
  } catch {
    return null;
  }
  const mod = await import(url.pathToFileURL(analyzerPath).href);
  if (typeof mod.analyze !== "function") {
    throw new Error(`Analyzer for "${dimensionId}" does not export an analyze() function.`);
  }
  return { dimensionId, analyzerPath, analyze: mod.analyze };
}

function dimensionIdToFilename(id, ext = "md") {
  return `${id.replace(/_/g, "-")}.${ext}`;
}
