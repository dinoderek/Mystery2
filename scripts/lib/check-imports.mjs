/**
 * The import-layer check: cruise the source roots against `FORBIDDEN`, then
 * hold the result to the baseline of known violations. A violation not in the
 * baseline is new; a baseline entry that no longer occurs is stale, and both
 * fail, so the baseline can only shrink. `dependency-cruiser` can ignore known
 * violations but never reports a stale one, hence this comparison.
 */

import fs from "node:fs";
import path from "node:path";

import { cruise } from "dependency-cruiser";

import { FORBIDDEN } from "./import-rules.mjs";
import { SOURCE_ROOTS } from "./source-roots.mjs";

/**
 * The violations in `roots` under `baseDir`, as sorted, unique one-line keys:
 * `<rule>: <from> -> <to>`, with `(via a > b)` for the members of a cycle.
 *
 * @param {{ baseDir: string, roots?: string[] }} options
 * @returns {Promise<string[]>}
 */
export async function findViolations({ baseDir, roots = SOURCE_ROOTS }) {
  // `dependency-cruiser` names the files it was handed relative to the working
  // directory and what they import relative to `baseDir`; the two must agree,
  // and a symlinked `baseDir` (macOS's tmpdir) must be spelled as it resolves.
  const base = fs.realpathSync(baseDir);
  const previous = process.cwd();
  process.chdir(base);
  let result;
  try {
    result = await cruise(
      roots.filter((root) => fs.existsSync(path.join(base, root))),
      {
        baseDir: base,
        ruleSet: { forbidden: FORBIDDEN },
        validate: true,
        // Without it `import type` leaves no edge, and so no rule can see it.
        tsPreCompilationDeps: true,
        doNotFollow: { path: "node_modules" },
      },
      // SvelteKit's alias; `.svelte-kit/tsconfig.json` is generated, not committed.
      { alias: { $lib: path.join(base, "web/src/lib") } },
    );
  } finally {
    process.chdir(previous);
  }
  const keys = result.output.summary.violations.map((violation) => {
    const via = violation.cycle?.map((step) => step.name).join(" > ");
    return `${violation.rule.name}: ${violation.from} -> ${violation.to}${via ? ` (via ${via})` : ""}`;
  });
  return [...new Set(keys)].sort();
}

/**
 * @param {string[]} found
 * @param {string[]} known
 * @returns {{ added: string[], stale: string[] }}
 */
export function compareToBaseline(found, known) {
  return {
    added: found.filter((key) => !known.includes(key)),
    stale: known.filter((key) => !found.includes(key)),
  };
}

/** @param {string} file */
export function readBaseline(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

/** @param {string} file @param {string[]} keys */
export function writeBaseline(file, keys) {
  fs.writeFileSync(file, `${JSON.stringify(keys, null, 2)}\n`);
}

/**
 * The failure text, or `null` when the check passes.
 *
 * @param {{ added: string[], stale: string[] }} diff
 */
export function describeDiff({ added, stale }) {
  const lines = [];
  if (added.length > 0) {
    lines.push(
      `${added.length} import(s) break a layer rule and are not in the baseline:`,
      ...added.map((key) => `  ${key}`),
      "Fix the import. The baseline lists only what predates the rule.",
    );
  }
  if (stale.length > 0) {
    lines.push(
      `${stale.length} baseline entr${stale.length === 1 ? "y" : "ies"} no longer occur:`,
      ...stale.map((key) => `  ${key}`),
      "Remove them: `npm run check:imports -- --prune`.",
    );
  }
  return lines.length === 0 ? null : lines.join("\n");
}
