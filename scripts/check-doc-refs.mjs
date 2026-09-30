#!/usr/bin/env node
/**
 * Fails when a doc names a repo path, an `npm run` script, or a relative link
 * that does not exist. Part of phase 1 of the gate (`npm run check:doc-refs`).
 *
 * Checked: `AGENTS.md`, `QUICKSTART.md`, `docs/`, and every package or
 * pipeline README. Not checked: `docs/design/` (historical records, kept as
 * they were written) and the generator/judge harness templates, whose paths
 * are relative to a workspace that only exists at run time. Paths git ignores
 * are runtime output — a database, a coverage report — and are skipped.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import { candidateBases, checkPath, extractRefs, readScripts } from "./lib/doc-refs.mjs";

const REPO_ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

const EXCLUDED = [/^docs\/design\//, /^evaluation\/[\w-]+-harness\/template\//];

function docsToCheck() {
  return execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*.md"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\n")
    .filter(Boolean)
    .filter(
      (f) =>
        f === "AGENTS.md" ||
        f === "QUICKSTART.md" ||
        f.startsWith("docs/") ||
        path.basename(f) === "README.md",
    )
    .filter((f) => !EXCLUDED.some((re) => re.test(f)))
    .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));
}

/** The subset of repo-relative paths git ignores. */
function ignoredByGit(paths) {
  if (paths.length === 0) return new Set();
  try {
    return new Set(
      execFileSync("git", ["check-ignore", "--no-index", "--stdin"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        input: paths.join("\n"),
      })
        .split("\n")
        .filter(Boolean),
    );
  } catch (err) {
    // Exit 1 means "none of them are ignored".
    if (err.status === 1) return new Set();
    throw err;
  }
}

function main() {
  const scripts = {
    root: readScripts(path.join(REPO_ROOT, "package.json")),
    web: readScripts(path.join(REPO_ROOT, "web", "package.json")),
  };
  const broken = [];

  const docs = docsToCheck();
  for (const doc of docs) {
    const abs = path.join(REPO_ROOT, doc);
    for (const ref of extractRefs(fs.readFileSync(abs, "utf8"))) {
      const where = `${doc}:${ref.line}`;
      if (ref.kind === "script") {
        const workspace = ref.workspace ?? "root";
        if (!scripts[workspace]?.has(ref.value)) {
          const cmd = ref.workspace ? `npm -w ${ref.workspace} run` : "npm run";
          broken.push({ where, what: `${cmd} ${ref.value}`, candidates: [] });
        }
      } else if (ref.kind === "link") {
        const target = path.resolve(path.dirname(abs), ref.value);
        if (!fs.existsSync(target)) {
          broken.push({ where, what: `link ${ref.value}`, candidates: [target] });
        }
      } else {
        const result = checkPath(ref.value, candidateBases(REPO_ROOT, abs));
        if (result && !result.exists) {
          broken.push({ where, what: ref.value, candidates: result.candidates });
        }
      }
    }
  }

  const relative = (abs) => path.relative(REPO_ROOT, abs).split(path.sep).join("/");
  // Asked twice: a directory-only pattern (`runs/`) matches only with the slash.
  const forms = (abs) => [relative(abs), `${relative(abs)}/`];
  const ignored = ignoredByGit(broken.flatMap((b) => b.candidates.flatMap(forms)));
  const real = broken.filter((b) => !b.candidates.some((c) => forms(c).some((f) => ignored.has(f))));

  if (real.length === 0) {
    process.stdout.write(`OK: ${docs.length} doc(s), no broken references\n`);
    return;
  }
  for (const b of real) process.stderr.write(`BROKEN ${b.where}  ${b.what}\n`);
  process.stderr.write(
    `\n${real.length} reference(s) to something that does not exist. ` +
      `Fix the doc, or the name if the doc is right.\n`,
  );
  process.exit(1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
}
