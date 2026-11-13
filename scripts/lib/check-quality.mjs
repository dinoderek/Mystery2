/**
 * The quality check: ESLint with `eslint.quality.config.mjs` over the source
 * roots, its violations held to the bulk suppressions in a baseline file. ESLint
 * fails a run whose baseline lists a violation that no longer occurs, which is
 * what lets the baseline only shrink; `prune` rewrites it without them.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

import { SOURCE_ROOTS } from "./source-roots.mjs";

const REPO_ROOT = path.resolve(
  path.dirname(url.fileURLToPath(import.meta.url)),
  "../..",
);
const ESLINT_BIN = path.join(REPO_ROOT, "node_modules/eslint/bin/eslint.js");

export const QUALITY_CONFIG = path.join(REPO_ROOT, "eslint.quality.config.mjs");
export const QUALITY_BASELINE = path.join(REPO_ROOT, "quality-baseline.json");

/**
 * @param {{ cwd?: string, baseline?: string, prune?: boolean }} [options]
 * @returns {{ status: number, output: string }}
 */
export function runQuality({
  cwd = REPO_ROOT,
  baseline = QUALITY_BASELINE,
  prune = false,
} = {}) {
  const roots = SOURCE_ROOTS.filter((root) =>
    fs.existsSync(path.join(cwd, root)),
  );
  const result = spawnSync(
    process.execPath,
    [
      ESLINT_BIN,
      "--config",
      QUALITY_CONFIG,
      "--no-warn-ignored",
      "--suppressions-location",
      baseline,
      ...(prune ? ["--prune-suppressions"] : []),
      ...roots,
    ],
    { cwd, encoding: "utf8" },
  );
  return {
    status: result.status ?? 2,
    output: `${result.stdout}${result.stderr}`,
  };
}
