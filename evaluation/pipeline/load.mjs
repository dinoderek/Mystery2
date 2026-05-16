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
  const outcome = await readJson(path.join(absSpecDir, "outcome.spec.json"));
  const briefRelPath = outcome.input_brief ?? "input.brief.json";
  const brief = await readJson(path.join(absSpecDir, briefRelPath));
  return { specDir: absSpecDir, brief, outcome };
}

export async function loadCliConfig(configPath) {
  return readJson(path.resolve(configPath));
}

export async function loadDimensionDefinition(dimensionId) {
  const filename = dimensionIdToFilename(dimensionId);
  const filePath = path.join(REPO_ROOT, "evaluation", "dimensions", filename);
  const text = await readText(filePath);
  return { id: dimensionId, filePath, text };
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
