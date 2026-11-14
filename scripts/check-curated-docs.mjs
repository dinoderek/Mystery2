#!/usr/bin/env node
// Drift checker for the curated extracts in
// evaluation/generator-harness/template/docs/.
//
// Each extract pins the sources it was derived from (see lib/curated-docs.mjs for
// the header format). This recomputes every pin and reports:
//
//   DRIFT    a pinned source or section changed since the extract was reviewed
//   MISSING  a pinned file or section does not exist
//   MARKER   a source's extract markers are malformed, or mark a section no
//            extract pins
//
// On drift it also names the last commit at which the pin still matched, so
// the review starts from a diff of exactly what changed.
//
// Exit codes: 0 clean, 1 problems found, 2 internal error.
//
// Run from anywhere: node scripts/check-curated-docs.mjs

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import { parsePins, parseSections, sectionHash } from "./lib/curated-docs.mjs";

const SCRIPT_PATH = url.fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const DOCS_DIR = path.join(REPO_ROOT, "evaluation", "generator-harness", "template", "docs");
const HISTORY_DEPTH = 200;

function git(args, input) {
  return execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8", input });
}

/** What a pin's hash is today, from `text` (a section pin) or the file (a blob pin). */
function hashOf(pin, text) {
  if (!pin.section) return git(["hash-object", "--stdin"], text).trim();
  const { sections } = parseSections(text);
  return sections.has(pin.section) ? sectionHash(sections.get(pin.section)) : null;
}

/**
 * The newest commit at which the pin still held, so drift can be reviewed as a
 * diff. Null when history is too shallow to reach it (CI checks out one commit).
 */
function lastMatchingCommit(pin) {
  let revs;
  try {
    revs = git(["log", `-n${HISTORY_DEPTH}`, "--format=%H", "--", pin.path])
      .split("\n")
      .filter(Boolean);
  } catch {
    return null;
  }
  for (const rev of revs) {
    let text;
    try {
      text = git(["show", `${rev}:${pin.path}`]);
    } catch {
      continue;
    }
    if (hashOf(pin, text) === pin.expected) return rev.slice(0, 12);
  }
  return null;
}

function markdownUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

/** Checks one pin of `doc`, adding what is wrong with it to `problems`. */
function checkPin(doc, pin, problems, pinnedSections) {
  const abs = path.join(REPO_ROOT, pin.path);
  if (!fs.existsSync(abs)) {
    problems.push(`MISSING ${doc} -> ${pin.pin}: no such file`);
    return;
  }
  if (pin.section) {
    if (!pinnedSections.has(pin.path)) pinnedSections.set(pin.path, new Set());
    pinnedSections.get(pin.path).add(pin.section);
  }

  const actual = hashOf(pin, fs.readFileSync(abs, "utf8"));
  if (actual === null) {
    problems.push(
      `MISSING ${doc} -> ${pin.pin}: no <!-- extract:${pin.section} --> section in ${pin.path}`,
    );
    return;
  }
  if (actual !== pin.expected) {
    const since = lastMatchingCommit(pin);
    problems.push(
      `DRIFT ${doc} -> ${pin.pin}\n` +
        `  pinned:  ${pin.expected}\n` +
        `  current: ${actual}\n` +
        (since
          ? `  review:  git diff ${since} -- ${pin.path}`
          : `  review:  no matching commit in the last ${HISTORY_DEPTH} (shallow clone?)`),
    );
  }
}

/** Markers are only worth their noise while an extract depends on them. */
function checkMarkers(problems, pinnedSections) {
  for (const doc of markdownUnder(path.join(REPO_ROOT, "docs"))) {
    const source = path.relative(REPO_ROOT, doc).split(path.sep).join("/");
    if (!pinnedSections.has(source)) pinnedSections.set(source, new Set());
  }
  for (const [source, ids] of pinnedSections) {
    const { sections, errors } = parseSections(
      fs.readFileSync(path.join(REPO_ROOT, source), "utf8"),
    );
    for (const error of errors) problems.push(`MARKER ${source}: ${error}`);
    for (const id of sections.keys()) {
      if (!ids.has(id)) {
        problems.push(`MARKER ${source}: section "${id}" is marked but no extract pins it`);
      }
    }
  }
}

function main() {
  const docs = fs.readdirSync(DOCS_DIR).filter((f) => f.endsWith(".md"));
  const problems = [];
  const pinnedSections = new Map(); // source path → Set of pinned ids
  let checked = 0;

  for (const doc of docs) {
    const pins = parsePins(fs.readFileSync(path.join(DOCS_DIR, doc), "utf8"));
    if (pins.length === 0) {
      problems.push(`MISSING ${doc}: no pinned sources in its header`);
      continue;
    }
    for (const pin of pins) {
      checked += 1;
      checkPin(doc, pin, problems, pinnedSections);
    }
  }
  checkMarkers(problems, pinnedSections);

  if (problems.length === 0) {
    process.stdout.write(`OK: ${docs.length} curated doc(s), ${checked} pin(s) verified\n`);
    process.exit(0);
  }
  process.stderr.write(problems.join("\n") + "\n");
  process.stderr.write(
    `\n${problems.length} problem(s). For drift: review the diff against the extract, ` +
      `update the extract if it no longer holds, then record the current hash.\n`,
  );
  process.exit(1);
}

try {
  main();
} catch (err) {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
}
