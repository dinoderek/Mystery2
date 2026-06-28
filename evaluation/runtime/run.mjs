#!/usr/bin/env node
// Runtime AI evaluation harness — entrypoint.
//
// Usage:
//   node evaluation/runtime/run.mjs <case-or-dir...> [options]
//
// Each positional is a case file (default-exporting ONE case or an ARRAY of
// cases) or a directory of case files. A case evaluates ONE action against a
// fully-specified prior state, so its input is deterministic and identical
// across models.
//
// Options:
//   --backend <spec[,spec]>  one or more backends to run per case
//                            (endpoint | cli:claude | cli:openai | cli:stub).
//                            Defaults to the case's backend, else "endpoint".
//   --ai-profile <id>        server ai_profile for the endpoint backend
//   --judges <a,b>           override the judges to run
//   --out <dir>              runs output root (default: evaluation/runtime/runs)
//
// For each (case x backend): collect the interaction, persist interaction.json
// FIRST, then judge into result.json. A run summary lists every result.

import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveEnv } from "./lib/env.mjs";
import { loadBackend } from "./lib/backends/index.mjs";
import { runJudges } from "./lib/judges/index.mjs";
import { buildInteraction, buildResult } from "./lib/envelope.mjs";

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

function timestampSlug(date) {
  return date.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}

function validateCase(testCase, source) {
  if (!testCase?.id || !testCase.action?.type || !testCase.given) {
    throw new Error(`Case in ${source} must have { id, given, action: { type, ... } }`);
  }
  return testCase;
}

async function loadCasesFrom(p) {
  const abs = path.resolve(process.cwd(), p);
  const stat = await fs.stat(abs);
  const files = [];
  if (stat.isDirectory()) {
    for (const name of (await fs.readdir(abs)).sort()) {
      if (name.endsWith(".mjs")) files.push(path.join(abs, name));
    }
  } else {
    files.push(abs);
  }
  const cases = [];
  for (const file of files) {
    const mod = await import(pathToFileURL(file).href);
    const exported = mod.default ?? mod.cases ?? mod.case;
    const list = Array.isArray(exported) ? exported : [exported];
    for (const c of list) cases.push(validateCase(c, path.relative(process.cwd(), file)));
  }
  return cases;
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9._-]+/g, "-");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length === 0) {
    console.error("Usage: node evaluation/runtime/run.mjs <case-or-dir...> [--backend spec[,spec]] [--ai-profile id] [--judges a,b]");
    process.exit(1);
  }

  const cases = (await Promise.all(args._.map(loadCasesFrom))).flat();
  const env = resolveEnv();
  const outRoot = args.out ?? path.join("evaluation", "runtime", "runs");
  const runId = `${timestampSlug(new Date())}-${Math.random().toString(36).slice(2, 6)}`;
  const runDir = path.resolve(process.cwd(), outRoot, runId);
  await fs.mkdir(runDir, { recursive: true });

  console.log(`[runtime-eval] run=${runId} cases=${cases.length}`);
  const summary = [];

  for (const testCase of cases) {
    const backendSpecs = (args.backend ?? testCase.backend ?? "endpoint")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const judgeIds = args.judges ? args.judges.split(",").map((s) => s.trim()) : testCase.judges ?? [];

    for (const backendSpec of backendSpecs) {
      const label = `${testCase.id} [${backendSpec}]`;
      const startedAt = new Date();
      try {
        const { backend, variant } = await loadBackend(backendSpec);
        const collectStart = Date.now();
        const collected = await backend.collect(testCase, {
          env,
          variant,
          aiProfile: args["ai-profile"] ?? testCase.aiProfile ?? "default",
        });
        const collectMs = Date.now() - collectStart;
        const endedAt = new Date();

        const interaction = buildInteraction({
          runId,
          startedAt: startedAt.toISOString(),
          endedAt: endedAt.toISOString(),
          testCase,
          backend: backendSpec,
          model: collected.model,
          blueprintPath: collected.blueprintPath,
          targetAge: collected.blueprint?.metadata?.target_age ?? null,
          response: collected.response,
          timing: { total_ms: collectMs },
        });

        const caseDir = path.join(runDir, `${slug(testCase.id)}__${slug(backendSpec)}`);
        await fs.mkdir(caseDir, { recursive: true });
        await fs.writeFile(path.join(caseDir, "interaction.json"), JSON.stringify(interaction, null, 2) + "\n");

        const judgeResults = runJudges(judgeIds, interaction, testCase.judgeConfig ?? {});
        const result = buildResult({ interaction, judgeResults });
        await fs.writeFile(path.join(caseDir, "result.json"), JSON.stringify(result, null, 2) + "\n");

        const verdicts = judgeResults
          .map((j) => `${j.id}:${j.status}${j.id === "flesch" && j.score !== null ? `(grade ${j.score})` : ""}`)
          .join(" ");
        console.log(`[runtime-eval] ${label} -> ${verdicts || "(no judges)"}`);
        summary.push({
          case_id: testCase.id,
          backend: backendSpec,
          model: collected.model,
          judges: result.summary.judges,
          dir: path.relative(process.cwd(), caseDir),
        });
      } catch (err) {
        console.error(`[runtime-eval] ${label} -> ERROR: ${err instanceof Error ? err.message : err}`);
        summary.push({ case_id: testCase.id, backend: backendSpec, error: String(err instanceof Error ? err.message : err) });
      }
    }
  }

  await fs.writeFile(path.join(runDir, "summary.json"), JSON.stringify({ run_id: runId, results: summary }, null, 2) + "\n");
  console.log(`[runtime-eval] wrote ${path.relative(process.cwd(), path.join(runDir, "summary.json"))}`);

  const failed = summary.filter((s) => s.error || (s.judges && (s.judges.fail + s.judges.error) > 0));
  process.exit(failed.length > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error(`[runtime-eval] error: ${err instanceof Error ? err.stack : err}`);
  process.exit(1);
});
