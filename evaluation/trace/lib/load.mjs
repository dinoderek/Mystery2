// Loaders for the trace-evaluation pipeline. What runs on a played game, and
// how each judge is defined, comes from the registry (evaluation/core/).

import fs from "node:fs/promises";
import path from "node:path";
import url from "node:url";

import { loadJudge } from "../../core/judge-loader.ts";
import { checksFor, judgesFor } from "../../core/registry.ts";

const HERE = path.dirname(url.fileURLToPath(import.meta.url));
const TRACE_ROOT = path.resolve(HERE, "..");

export function traceRoot() {
  return TRACE_ROOT;
}

// The trace dimension battery: the judge dimensions run on every trace plus
// the settings of its mechanical checks, which are always on and not listed
// as dimensions.
export async function loadTraceDimensions() {
  const dimensions = judgesFor("game").map((entry) => ({
    id: entry.id,
    ...(entry.context ? { context: structuredClone(entry.context) } : {}),
  }));
  const mechanical = Object.assign({}, ...checksFor("game").map((entry) => entry.context ?? {}));
  return {
    dimensions,
    mechanical_context: Object.keys(mechanical).length > 0 ? mechanical : null,
  };
}

// The game-master judges are written against the subject projection rather
// than against a trace, which is what lets the runtime harness run the very
// same brief and schema over a single turn.
export async function loadTraceDimensionDefinition(dimensionId) {
  return loadJudge(dimensionId);
}

export async function loadCliConfig(configPath) {
  return JSON.parse(await fs.readFile(path.resolve(configPath), "utf8"));
}
