#!/usr/bin/env node
// Re-run judges over a stored interaction.json — NO endpoint or model calls.
// This is the inner loop while iterating on judges.
//
// Usage:
//   node evaluation/runtime/rejudge.mjs <interaction.json> [options]
//
// Options:
//   --judges <a,b>   judges to run (default: derive from sibling result.json, else "flesch")
//   --case <file>    case file to read judgeConfig from (default: none)
//   --out <file>     where to write the result (default: result.rejudge.json beside the interaction)

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { runJudges } from "./lib/judges/index.mjs";
import { buildResult } from "./lib/envelope.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      args[token.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      args._.push(token);
    }
  }
  return args;
}

async function readJsonIfExists(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8"));
  } catch {
    return null;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const interactionFile = args._[0];
  if (!interactionFile) {
    console.error("Usage: node evaluation/runtime/rejudge.mjs <interaction.json> [--judges a,b] [--case file]");
    process.exit(1);
  }
  const interactionPath = path.resolve(process.cwd(), interactionFile);
  const interaction = JSON.parse(await fs.readFile(interactionPath, "utf-8"));
  const runDir = path.dirname(interactionPath);

  // Judge selection: explicit flag > sibling result.json > default "flesch".
  let judgeIds;
  if (args.judges) {
    judgeIds = args.judges.split(",").map((s) => s.trim());
  } else {
    const prior = await readJsonIfExists(path.join(runDir, "result.json"));
    judgeIds = prior?.judges?.map((j) => j.id) ?? ["flesch"];
  }

  let judgeConfig = {};
  if (args.case) {
    const mod = await import(pathToFileURL(path.resolve(process.cwd(), args.case)).href);
    judgeConfig = (mod.default ?? mod.case)?.judgeConfig ?? {};
  }

  const judgeResults = runJudges(judgeIds, interaction, judgeConfig);
  const result = buildResult({ interaction, judgeResults });

  const outPath = args.out
    ? path.resolve(process.cwd(), args.out)
    : path.join(runDir, "result.rejudge.json");
  await fs.writeFile(outPath, JSON.stringify(result, null, 2) + "\n");

  for (const j of judgeResults) {
    const extra = j.id === "flesch" && j.score !== null ? ` (worst grade ${j.score})` : "";
    console.log(`[rejudge] ${j.id}: ${j.status.toUpperCase()}${extra}`);
  }
  console.log(`[rejudge] wrote ${path.relative(process.cwd(), outPath)}`);

  const failed = result.summary.judges.fail + result.summary.judges.error;
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(`[rejudge] error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
