#!/usr/bin/env node
// Judge verdict validator. Standalone — invoked by the judge agent (and by
// the harness as a sanity check after the agent exits).
//
// Two-stage validation:
//   1. Shape check — delegates to evaluation/pipeline/validate.mjs (the
//      single source of truth for Zod schemas, added in PR #79). Polymorphic
//      by dimension id read from ./dimension-id.
//   2. Semantic reference / coverage checks — dimension-specific rules that
//      cannot be expressed in the Zod schema:
//        - solvability: every paths[].id ∈ blueprint.solution_paths[].id; cover all
//        - fairness:    every non_culprits[].character_id is a real non-culprit; cover all
//        - coherence:   none (issues' `subject` is free text)
//        - character_grounding: every characters[].character_id is real;
//                               first_name matches blueprint; cover every
//                               blueprint character; every topics[].topic is
//                               in context.probe_topics
//
// Usage: node validate-judge-output.mjs <path-to-verdict.json>
//
// Exit codes:
//   0 — both stages passed
//   1 — shape or semantic failure (details on stderr)
//   2 — file missing or unparseable, or workspace misconfigured
//   3 — usage error

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

const SCRIPT_PATH = url.fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..", "..", "..");
const SHAPE_VALIDATOR = path.join(REPO_ROOT, "evaluation/pipeline/validate.mjs");

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

function shapeCheck(dimId, verdictPath) {
  // Delegate to evaluation/pipeline/validate.mjs (PR #79). Inherits its
  // exit-code contract (0 ok, 1 invalid, 2 usage).
  const res = spawnSync(
    process.execPath,
    [SHAPE_VALIDATOR, dimId, verdictPath],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  if (res.error) return { ok: false, message: `spawn error: ${res.error.message}` };
  if (res.status === 0) return { ok: true };
  const stdout = res.stdout?.toString("utf8") ?? "";
  const stderr = res.stderr?.toString("utf8") ?? "";
  return {
    ok: false,
    message: `shape validator exit ${res.status}`,
    stdout,
    stderr,
  };
}

function semanticChecksSolvability(verdict, blueprint) {
  const issues = [];
  const validIds = new Set((blueprint.solution_paths ?? []).map((p) => p.id));
  const seen = new Set();
  for (const p of verdict.paths ?? []) {
    if (!validIds.has(p.id)) {
      issues.push(
        `paths[].id "${p.id}" does not match any blueprint.solution_paths[].id (valid: ${[...validIds].join(", ") || "(none)"})`,
      );
    }
    if (seen.has(p.id)) issues.push(`paths[].id "${p.id}" appears more than once`);
    seen.add(p.id);
  }
  for (const id of validIds) {
    if (!seen.has(id)) {
      issues.push(`paths is missing an entry for blueprint solution_path "${id}"`);
    }
  }
  return issues;
}

function semanticChecksFairness(verdict, blueprint) {
  const issues = [];
  const allChars = new Map(
    (blueprint.world?.characters ?? []).map((c) => [c.id, c]),
  );
  const expectedNonCulpritIds = new Set(
    (blueprint.world?.characters ?? [])
      .filter((c) => !c.is_culprit)
      .map((c) => c.id),
  );
  const reportedIds = new Set();
  for (const n of verdict.non_culprits ?? []) {
    if (!allChars.has(n.character_id)) {
      issues.push(
        `non_culprits[].character_id "${n.character_id}" not in blueprint.world.characters`,
      );
      continue;
    }
    if (allChars.get(n.character_id).is_culprit) {
      issues.push(
        `non_culprits[].character_id "${n.character_id}" is actually the culprit (is_culprit=true)`,
      );
    }
    if (reportedIds.has(n.character_id)) {
      issues.push(
        `non_culprits[].character_id "${n.character_id}" appears more than once`,
      );
    }
    reportedIds.add(n.character_id);
  }
  for (const id of expectedNonCulpritIds) {
    if (!reportedIds.has(id)) {
      const c = allChars.get(id);
      issues.push(
        `non_culprits is missing blueprint non-culprit "${id}" (${c?.first_name ?? "?"})`,
      );
    }
  }
  return issues;
}

function semanticChecksCharacterGrounding(verdict, blueprint, context) {
  const issues = [];
  const allChars = new Map(
    (blueprint.world?.characters ?? []).map((c) => [c.id, c]),
  );
  const reportedIds = new Set();
  const probeTopics = new Set(context?.probe_topics ?? []);

  for (const c of verdict.characters ?? []) {
    if (!allChars.has(c.character_id)) {
      issues.push(
        `characters[].character_id "${c.character_id}" not in blueprint.world.characters`,
      );
      continue;
    }
    if (reportedIds.has(c.character_id)) {
      issues.push(`characters[].character_id "${c.character_id}" appears more than once`);
    }
    reportedIds.add(c.character_id);

    const truth = allChars.get(c.character_id);
    if (truth && c.first_name !== truth.first_name) {
      issues.push(
        `characters[].first_name for "${c.character_id}" is "${c.first_name}" but blueprint says "${truth.first_name}"`,
      );
    }

    if (probeTopics.size > 0) {
      for (const t of c.topics ?? []) {
        if (!probeTopics.has(t.topic)) {
          issues.push(
            `character "${c.character_id}" topic "${t.topic}" is not in context.probe_topics (must be copied verbatim)`,
          );
        }
      }
    }
  }
  for (const c of blueprint.world?.characters ?? []) {
    if (!reportedIds.has(c.id)) {
      issues.push(
        `characters is missing blueprint character "${c.id}" (${c.first_name})`,
      );
    }
  }
  return issues;
}

// coherence: no mechanical reference checks (issues' `subject` is free text)
function semanticChecksCoherence() {
  return [];
}

const SEMANTIC = {
  solvability: semanticChecksSolvability,
  fairness: semanticChecksFairness,
  coherence: semanticChecksCoherence,
  character_grounding: semanticChecksCharacterGrounding,
};

async function main() {
  const verdictPath = process.argv[2];
  if (!verdictPath) {
    process.stderr.write("usage: validate-judge-output.mjs <verdict.json>\n");
    process.exit(3);
  }
  let dimId;
  try {
    dimId = (await fs.readFile(path.resolve("dimension-id"), "utf8")).trim();
  } catch (err) {
    process.stderr.write(
      `could not read ./dimension-id from cwd (${err.message}). Run me from the workspace root.\n`,
    );
    process.exit(2);
  }
  if (!SEMANTIC[dimId]) {
    process.stderr.write(`unknown dimension id: "${dimId}"\n`);
    process.exit(2);
  }

  // Stage 1: shape via evaluation/pipeline/validate.mjs
  const shape = shapeCheck(dimId, verdictPath);
  if (!shape.ok) {
    process.stderr.write(`INVALID ${dimId} ${verdictPath} — shape failure\n`);
    if (shape.stdout) process.stderr.write(shape.stdout);
    if (shape.stderr) process.stderr.write(shape.stderr);
    process.exit(1);
  }

  // Stage 2: semantic refs / coverage
  let verdict;
  let blueprint;
  let context;
  try {
    verdict = await readJson(path.resolve(verdictPath));
  } catch (err) {
    process.stderr.write(`verdict.json: ${err.message}\n`);
    process.exit(2);
  }
  try {
    blueprint = await readJson(path.resolve("blueprint.json"));
  } catch (err) {
    process.stderr.write(`could not read ./blueprint.json: ${err.message}\n`);
    process.exit(2);
  }
  try {
    context = await readJson(path.resolve("context.json"));
  } catch {
    context = {};
  }

  const semanticIssues =
    dimId === "character_grounding"
      ? SEMANTIC[dimId](verdict, blueprint, context)
      : SEMANTIC[dimId](verdict, blueprint);

  if (semanticIssues.length > 0) {
    process.stderr.write(
      `INVALID ${dimId} ${verdictPath} — ${semanticIssues.length} reference/coverage issue(s):\n`,
    );
    for (const msg of semanticIssues) process.stderr.write(`  - ref/${msg}\n`);
    process.exit(1);
  }

  process.stdout.write(`OK: ${verdictPath} (${dimId}) [shape + refs]\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${err.message ?? err}\n`);
  process.exit(2);
});
