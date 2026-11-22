#!/usr/bin/env node
// Clue-graph case validator for the generator workspace: the case's mechanical
// check exactly as `./dev generate` runs it (`runClueGraphChecks`), with its
// brief, so the agent sees every fault the harness will quote back to it. The
// brief is the brief.json beside the case, else the one in the current
// directory, so a case elsewhere in the workspace is checked against the
// workspace's brief.
//
// Usage: node scripts/validate-case.ts ./case.json
//
// Exit codes:
//   0 — the case passed
//   1 — the case failed; each fault is printed on stderr, naming its field
//   2 — the case or the brief is missing or not JSON
//   3 — usage error
//
// Node resolves imports from the script's real path, so this works through the
// workspace's symlink.

import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { runClueGraphChecks } from "../../checks/clue-graph-case.ts";

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    process.stderr.write(`${file}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

const caseFile = process.argv[2];
if (!caseFile || process.argv.length > 3) {
  process.stderr.write("usage: validate-case.ts <case.json>\n");
  process.exit(3);
}
const resolved = path.resolve(caseFile);
const beside = path.join(path.dirname(resolved), "brief.json");
const message = (await readJson(existsSync(beside) ? beside : path.resolve("brief.json"))) as { story_brief?: unknown };
const candidate = await readJson(resolved);

const [check] = runClueGraphChecks({ brief: message.story_brief ?? message, blueprintCandidate: candidate });
if (check.status === "pass") {
  process.stdout.write(`OK: ${caseFile}\n`);
  process.exit(0);
}
const issues = (check.details as { issues: string[] }).issues;
for (const issue of issues) process.stderr.write(`${issue}\n`);
process.stderr.write(`FAIL: ${issues.length} fault(s)\n`);
process.exit(1);
