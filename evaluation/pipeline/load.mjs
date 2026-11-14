import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import { loadAnalyzer, loadJudge } from "../core/judge-loader.ts";
import { judgesFor } from "../core/registry.ts";

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

// Resolve a --spec argument to a concrete brief path plus a slug used for run
// ids and output directory names. The argument may be EITHER a spec directory
// containing input.brief.json (the original convention) OR a path to a brief
// JSON file directly — so callers no longer have to wrap a lone brief in a
// directory just to satisfy the loader.
export async function resolveSpec(specPath) {
  const abs = path.resolve(specPath);
  let stat;
  try {
    stat = await fs.stat(abs);
  } catch (err) {
    if (err.code === "ENOENT") {
      throw new Error(`Spec path not found: ${abs}`, { cause: err });
    }
    throw err;
  }
  if (stat.isDirectory()) {
    return {
      briefPath: path.join(abs, "input.brief.json"),
      slug: path.basename(abs),
    };
  }
  // A brief file was passed directly. Derive the slug from its enclosing
  // directory when it follows the input.brief.json convention, otherwise from
  // the file name (dropping a trailing .brief.json or .json).
  const base = path.basename(abs);
  const slug =
    base === "input.brief.json"
      ? path.basename(path.dirname(abs))
      : base.replace(/\.brief\.json$/i, "").replace(/\.json$/i, "");
  return { briefPath: abs, slug };
}

export async function loadSpec(specPath) {
  const { briefPath, slug } = await resolveSpec(specPath);
  const brief = await readJson(briefPath);
  return { specDir: path.dirname(briefPath), briefPath, slug, brief };
}

// The standard evaluation battery: which dimensions run on every blueprint and
// their default context. Central and story-agnostic: it is the registry's
// blueprint judges (evaluation/core/registry.ts), in registry order.
export async function loadDimensions() {
  return judgesFor("blueprint").map((entry) => ({
    id: entry.id,
    ...(entry.context ? { context: structuredClone(entry.context) } : {}),
  }));
}

export async function loadCliConfig(configPath) {
  return readJson(path.resolve(configPath));
}

export const loadDimensionDefinition = loadJudge;

export async function tryLoadAnalyzer(dimensionId) {
  return loadAnalyzer(dimensionId);
}
