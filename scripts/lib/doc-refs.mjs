/**
 * Finds the repo paths, `npm run` scripts and relative links a doc names, so
 * `scripts/check-doc-refs.mjs` can fail the gate when one no longer exists.
 * Docs rot quietly: a renamed file or a removed script leaves the prose
 * confidently pointing at nothing, and nobody notices until they follow it.
 *
 * Deliberately conservative. A code span counts as a path only when its first
 * segment is a directory that really exists next to one of the bases it could
 * be relative to — so `anthropic/claude-sonnet-4` (a model id) or `win|lose`
 * are never mistaken for paths, while a stale `scripts/seed-storage.ts` is.
 */

import fs from "node:fs";
import path from "node:path";

const FENCE_RE = /^\s*(```|~~~)/;
const CODE_SPAN_RE = /`([^`\n]+)`/g;
const LINK_RE = /\]\(([^)\s]+)\)/g;
const SCRIPT_RE = /\bnpm\s+(?:-w\s+([\w-]+)\s+)?run\s+(?:-s\s+)?([\w:.-]+)/g;
const PLACEHOLDER_RE = /[<>{}*$|\s]|\.\.\./;

/**
 * Every reference in a Markdown doc, with its 1-based line. Scripts are read
 * everywhere, fenced examples included, because that is where commands live;
 * paths and links only outside fences, where a layout sketch of a generated
 * workspace would otherwise read as a list of missing files.
 */
export function extractRefs(markdown) {
  const refs = [];
  let inFence = false;
  markdown.split("\n").forEach((text, index) => {
    const line = index + 1;
    if (FENCE_RE.test(text)) {
      inFence = !inFence;
      return;
    }
    for (const m of text.matchAll(SCRIPT_RE)) {
      refs.push({ kind: "script", workspace: m[1] ?? null, value: m[2], line });
    }
    if (inFence) return;
    for (const m of text.matchAll(CODE_SPAN_RE)) {
      const value = normalizePath(m[1]);
      if (value) refs.push({ kind: "path", value, line });
    }
    for (const m of text.matchAll(LINK_RE)) {
      const target = m[1];
      if (/^[a-z]+:/i.test(target) || target.startsWith("#")) continue;
      refs.push({ kind: "link", value: target.split("#")[0], line });
    }
  });
  return refs;
}

/** A code span as a candidate relative path, or null if it cannot be one. */
function normalizePath(span) {
  if (!span.includes("/") || PLACEHOLDER_RE.test(span)) return null;
  if (/^(\/|~|\.\.?\/|[a-z]+:)/i.test(span)) return null;
  return span.replace(/:\d+(-\d+)?$/, "").replace(/#.*$/, "");
}

/**
 * Where a path reference could be relative to: the repo root, the doc's own
 * directory, and `web/` (the UI doc names `src/...` as SvelteKit does).
 */
export function candidateBases(repoRoot, docPath) {
  return [repoRoot, path.dirname(docPath), path.join(repoRoot, "web")];
}

/**
 * Resolves a path reference. `null` when the span is not a path at all (its
 * first segment exists under no base); otherwise whether it exists, and the
 * absolute paths it could mean — the ones whose first segment is real.
 */
export function checkPath(value, bases) {
  const first = value.split("/")[0];
  const candidates = bases
    .filter((base) => fs.existsSync(path.join(base, first)))
    .map((base) => path.join(base, value));
  if (candidates.length === 0) return null;
  return { exists: candidates.some((c) => fs.existsSync(c)), candidates };
}

/** The scripts a workspace's package.json defines. */
export function readScripts(packageJsonPath) {
  return new Set(Object.keys(JSON.parse(fs.readFileSync(packageJsonPath, "utf8")).scripts ?? {}));
}
