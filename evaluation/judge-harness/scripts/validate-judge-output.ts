#!/usr/bin/env node
// Judge verdict validator. Standalone — invoked by the judge agent (and by
// the harness as a sanity check after the agent exits).
//
// Two stages, both from the judge's registry entry (evaluation/core/registry.ts)
// through the core's output validator (evaluation/core/judge-output.ts):
//   1. Shape — the verdict satisfies the dimension's schema.
//   2. Ids — every id, path and topic it cites exists in ./blueprint.json, it
//      covers what the entry says it must, and it repeats nothing it must not.
//      The registry entry declares these checks per dimension.
//
// Usage: node validate-judge-output.ts <path-to-verdict.json>
//
// Reads ./dimension-id, ./blueprint.json and (optionally) ./context.json from
// the working directory, which is the judge workspace.
//
// Exit codes:
//   0 — both stages passed
//   1 — shape or id failure (details on stderr)
//   2 — file missing or unparseable, unknown dimension, or workspace misconfigured
//   3 — usage error

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { loadJudge } from "../../core/judge-loader.ts";
import { validateJudgeAnswer } from "../../core/judge-output.ts";

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

/** Read a workspace file as JSON, or exit 2 saying which one and why. */
async function readOrExit(file: string, what: string): Promise<unknown> {
  try {
    return await readJson(path.resolve(file));
  } catch (err) {
    process.stderr.write(`could not read ${what} (${messageOf(err)}).\n`);
    process.exit(2);
  }
}

async function main() {
  const verdictPath = process.argv[2];
  if (!verdictPath) {
    process.stderr.write("usage: validate-judge-output.ts <verdict.json>\n");
    process.exit(3);
  }
  let dimId;
  try {
    dimId = (await fs.readFile(path.resolve("dimension-id"), "utf8")).trim();
  } catch (err) {
    process.stderr.write(
      `could not read ./dimension-id from cwd (${messageOf(err)}). Run me from the workspace root.\n`,
    );
    process.exit(2);
  }

  let definition;
  try {
    definition = await loadJudge(dimId);
  } catch (err) {
    process.stderr.write(`${messageOf(err)}\n`);
    process.exit(2);
  }

  const verdict = await readOrExit(verdictPath, verdictPath);
  const blueprint = await readOrExit("blueprint.json", "./blueprint.json");
  const context = (await readJson(path.resolve("context.json")).catch(() => ({}))) as Record<string, unknown>;

  const result = validateJudgeAnswer(definition, verdict, blueprint, context);
  if (!result.ok) {
    const label = result.stage === "shape" ? "shape failure" : `${result.messages.length} reference/coverage issue(s)`;
    process.stderr.write(`INVALID ${dimId} ${verdictPath} — ${label}:\n`);
    for (const message of result.messages) process.stderr.write(`  - ${result.stage}/${message}\n`);
    process.exit(1);
  }

  process.stdout.write(`OK: ${verdictPath} (${dimId}) [shape + refs]\n`);
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`fatal: ${messageOf(err)}\n`);
  process.exit(2);
});
