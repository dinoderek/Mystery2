import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import url from "node:url";

import {
  composeJudgeSystemPrompt,
  resolveVerdict,
  validateJudgeOutput,
} from "../judges/index.mjs";
import { projectTraceSubject } from "../judges/subject.mjs";
import { runCli } from "../pipeline/cli-runner.mjs";
import { startJudgeDigest } from "../pipeline/progress.mjs";
import {
  createRunTimer,
  formatDuration,
  formatTimingSummary,
} from "../pipeline/timing.mjs";

import { buildTraceEnvelope, combineDimension } from "./lib/envelope.mjs";
import {
  loadCliConfig,
  loadTraceDimensionDefinition,
  loadTraceDimensions,
  loadTraceJudgeSystemPrompt,
  traceRoot,
} from "./lib/load.mjs";
import { runTraceMechanicalChecks } from "./lib/mechanical.mjs";
import { assertRawTrace } from "./lib/normalize.mjs";
import { reconstructTrace } from "./lib/reconstruct.mjs";

function parseArgs(argv) {
  const args = {
    trace: null,
    session: null,
    config: null,
    runId: null,
    outputRoot: null,
    quiet: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--trace") args.trace = argv[++i];
    else if (arg === "--session") args.session = argv[++i];
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--output-root") args.outputRoot = argv[++i];
    else if (arg === "--quiet" || arg === "--no-progress") args.quiet = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return `Usage: node evaluation/trace/run.mjs (--trace <file> | --session <id>) [options]

Subject (one required):
  --trace <file>      Evaluate a pre-extracted raw trace artifact (JSON).
  --session <id>      Extract the session from Supabase first, then evaluate.
                      Requires SERVICE_ROLE_KEY (and a resolvable Supabase URL)
                      in the environment.

Options:
  --config <file>     Path to cli.json (default: evaluation/trace/config/cli.json).
                      Without a judge step configured, judges are skipped and
                      only mechanical checks run.
  --run-id <id>       Override the run id (default: timestamp-session).
  --output-root <dir> Root for run output (default: $MYSTERYEVALS_DIR or
                      ~/mysteryevals). Each run writes a self-contained
                      <root>/<date>/<time>/run-trace-<session>/ directory.
  --quiet, --no-progress  Suppress the per-step heartbeat (keeps milestone lines
                      and log-path hints). Useful for CI.
  -h, --help          Show this help.
`;
}

// One judge call with a retry budget covering CLI failures and schema
// validation of the model's output. Mirrors the blueprint pipeline's
// runJudgeWithRetries; kept local so the blueprint run.mjs stays untouched.
async function runTraceJudge({ step, config, systemPrompt, userMessage, logDir, schema, env }) {
  const retries = Number.isInteger(config.retries) ? Math.max(0, config.retries) : 0;
  const max = 1 + retries;
  const attempts = [];

  for (let i = 1; i <= max; i += 1) {
    const startedAt = Date.now();
    const attemptStep = max === 1 ? step : `${step}.attempt-${i}`;
    let extracted;
    try {
      const result = await runCli({ step: attemptStep, config, systemPrompt, userMessage, logDir, env });
      extracted = result.extracted;
    } catch (err) {
      attempts.push({ attempt: i, outcome: "cli_fail", duration_ms: Date.now() - startedAt, error: String(err.message ?? err).slice(0, 500) });
      if (i === max) return { ok: false, error: { stage: "judge", message: String(err.message ?? err) }, attempts };
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(extracted);
    } catch {
      parsed = null;
    }
    const validation = validateJudgeOutput(parsed, schema);
    if (validation.ok) {
      attempts.push({ attempt: i, outcome: "ok", duration_ms: Date.now() - startedAt });
      return { ok: true, data: validation.data, attempts };
    }
    attempts.push({ attempt: i, outcome: "schema_fail", duration_ms: Date.now() - startedAt, error: validation.message.slice(0, 500) });
    if (i === max) {
      return { ok: false, error: { stage: "judge_parse", message: validation.message, raw: extracted.slice(0, 1000) }, attempts };
    }
  }
  return { ok: false, error: { stage: "judge", message: "runTraceJudge fell through" }, attempts };
}

async function loadRawTrace({ args, root, runDir, timer }) {
  if (args.trace) {
    const tracePath = path.resolve(args.trace);
    process.stdout.write(`[trace-eval] trace=${path.relative(root, tracePath)} (preexisting)\n`);
    const trace = await timer.stage("load_trace", async () =>
      assertRawTrace(JSON.parse(await fs.readFile(tracePath, "utf8"))),
    );
    return { trace, extraction: { skipped: true, source: "preexisting", input_path: tracePath } };
  }

  // Extract inline from Supabase. Imported lazily so a --trace run (and the
  // unit tests) never need the Supabase client or its env.
  const { createSupabaseTraceSource, extractSessionTrace } = await import("./lib/datasource.mjs");
  const trace = await timer.stage("extract", async () => {
    const source = createSupabaseTraceSource();
    return extractSessionTrace(source, args.session);
  });
  // Persist the extracted raw trace into the run directory so the run is
  // self-contained and re-runnable with --trace.
  const tracePath = path.join(runDir, "trace.json");
  await fs.writeFile(tracePath, JSON.stringify(trace, null, 2));
  return { trace, extraction: { skipped: false, source: "supabase", session_id: args.session, written_to: tracePath } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.trace && !args.session)) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  const startedAt = new Date();
  const timer = createRunTimer();
  const root = traceRoot();

  const runDate = startedAt.toISOString().slice(0, 10);
  const runStamp = startedAt.toISOString().slice(11, 19).replace(/:/g, "-") + "Z";
  const outputRoot = path.resolve(
    args.outputRoot ?? process.env.MYSTERYEVALS_DIR ?? path.join(os.homedir(), "mysteryevals"),
  );

  const runState = {
    tracePath: null,
    sessionId: null,
    blueprintId: null,
    extraction: null,
    reconstruction: null,
    mechanical: [],
    dimensions: [],
    runError: null,
  };

  // The run id / output dir need the session id, which (for --trace) comes from
  // the artifact. Resolve a provisional dir, then we know enough to proceed.
  const provisionalSlug = args.session ?? "trace";
  const runDir = path.join(outputRoot, runDate, runStamp, `run-trace-${provisionalSlug}`);
  const logDir = path.join(runDir, "logs");
  await fs.mkdir(logDir, { recursive: true });

  const runId = args.runId ?? `${startedAt.toISOString().replace(/[:.]/g, "-")}-${provisionalSlug}`;
  process.stdout.write(`[trace-eval] run_id=${runId}\n[trace-eval] output_dir=${runDir}\n`);
  process.stdout.write(
    `[trace-eval] logs: ${logDir}  (per-step *.stream.jsonl are tailable live)\n`,
  );

  try {
    const { trace, extraction } = await loadRawTrace({ args, root, runDir, timer });
    runState.extraction = extraction;
    runState.tracePath = extraction.input_path ?? extraction.written_to ?? null;
    runState.sessionId = trace.session?.id ?? null;
    runState.blueprintId = trace.session?.blueprint_id ?? null;

    const reconstructed = await timer.stage(
      "reconstruct",
      async () => reconstructTrace(trace),
      (r) => ({ turns: r.turns.length, issues: r.issues.length }),
    );
    runState.reconstruction = {
      turns: reconstructed.turns.length,
      context_errors: reconstructed.issues.length,
      // Surface the per-turn issue detail in the envelope (not just a count) so
      // a human reading result.json sees which turns lost fidelity and why.
      issues: reconstructed.issues,
    };
    if (reconstructed.issues.length > 0) {
      process.stdout.write(
        `[trace-eval] reconstruction: ${reconstructed.issues.length} turn(s) with context errors\n`,
      );
    }
    await fs.writeFile(
      path.join(runDir, "reconstruction.json"),
      JSON.stringify(reconstructed, null, 2),
    );

    const { dimensions, mechanical_context } = await timer.stage("load_dimensions", () => loadTraceDimensions());

    runState.mechanical = await timer.stage(
      "mechanical",
      async () => runTraceMechanicalChecks({ rawTrace: trace, context: mechanical_context }),
      (checks) => ({ checks: checks.length }),
    );
    const mechFailed = runState.mechanical.filter((c) => c.status === "fail").length;
    process.stdout.write(
      `[trace-eval] mechanical: ${runState.mechanical.length - mechFailed}/${runState.mechanical.length} passed\n`,
    );

    let cliConfig = null;
    const configPath = args.config ?? path.join(root, "config", "cli.json");
    try {
      cliConfig = await loadCliConfig(configPath);
    } catch {
      cliConfig = null;
    }
    const judgeStep = cliConfig?.judge ?? null;
    if (!judgeStep) {
      process.stdout.write(`[trace-eval] no judge step in cli.json — running mechanical only\n`);
    }

    const judgeSystemBase = await timer.stage("load_judge_system_prompt", () => loadTraceJudgeSystemPrompt());
    // Every turn of a played trace is the game master's own output, so the
    // whole subject is judged. (A runtime-harness interaction projects into the
    // same shape with exactly one judged turn.)
    const judgeSubject = projectTraceSubject(reconstructed.turns);

    process.stdout.write(
      `[trace-eval] dimensions: ${dimensions.length} started in parallel\n`,
    );
    if (judgeStep && !args.quiet) {
      process.stdout.write(
        `[trace-eval]   tail -f ${path.join(logDir, "judge-*.stream.jsonl")}  (or judge-<dim>*.stream.jsonl for one)\n`,
      );
    }

    // Parallel-phase progress: one batched tick prints elapsed + done/total,
    // then up to a few new digest messages per still-running judge (plus its
    // token total). Each dimension's pass/fail line is printed by
    // evaluateDimension.
    const judgeDigest = judgeStep
      ? startJudgeDigest({
          dimIds: dimensions.map((d) => d.id),
          tag: "[trace-eval]",
          logDir,
          quiet: args.quiet,
        })
      : { markDone() {}, stop() {} };

    try {
      runState.dimensions = await timer.stage(
        "dimensions",
        () =>
          Promise.all(
            dimensions.map((dimRef) =>
              evaluateDimension({
                dimRef,
                blueprint: trace.blueprint,
                judgeSubject,
                judgeSystemBase,
                judgeStep,
                logDir,
                runDir,
                timer,
              }).finally(() => judgeDigest.markDone(dimRef.id)),
            ),
          ),
        (results) => ({ count: results.length, parallel: true }),
      );
    } finally {
      judgeDigest.stop();
    }
  } catch (err) {
    runState.runError = { stage: err.runErrorStage ?? "unknown", message: String(err.message ?? err) };
    process.stderr.write(`[trace-eval] error: ${runState.runError.message}\n`);
  }

  const endedAt = new Date();
  const timing = timer.summarize();
  const envelope = buildTraceEnvelope({
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    tracePath: runState.tracePath,
    sessionId: runState.sessionId,
    blueprintId: runState.blueprintId,
    extraction: runState.extraction,
    reconstruction: runState.reconstruction,
    mechanical: runState.mechanical,
    dimensions: runState.dimensions,
    runError: runState.runError,
    timing,
  });

  const resultPath = path.join(runDir, "result.json");
  const writeStartedAt = performance.now();
  await fs.writeFile(resultPath, JSON.stringify(envelope, null, 2));
  const writeMs = performance.now() - writeStartedAt;

  process.stdout.write(`\n${formatTimingSummary(timing)}\n`);
  process.stdout.write(`\n[trace-eval] result: ${resultPath} (write ${formatDuration(writeMs)})\n`);
  const dim = envelope.summary.dimensions;
  process.stdout.write(
    `[trace-eval] summary: mechanical ${envelope.summary.mechanical.pass}/${envelope.summary.mechanical.pass + envelope.summary.mechanical.fail} pass, ` +
      `dimensions ${dim.pass}/${dim.pass + dim.fail + dim.error + dim.skipped} pass (${dim.skipped} skipped)\n`,
  );

  if (runState.runError) process.exit(1);
}

async function evaluateDimension({ dimRef, blueprint, judgeSubject, judgeSystemBase, judgeStep, logDir, runDir, timer }) {
  const dimId = dimRef.id;
  const tag = `[trace-eval][${dimId}]`;
  const dimTimer = timer.dimension(dimId);
  try {
    const dim = await dimTimer.step("load_definition", () => loadTraceDimensionDefinition(dimId));
    const systemPrompt = await dimTimer.step("compose_prompt", async () =>
      composeJudgeSystemPrompt({
        base: judgeSystemBase,
        dimensionText: dim.text,
        schema: dim.schema,
        context: dimRef.context ?? null,
      }),
    );
    const userMessage = JSON.stringify({
      dimension_id: dimId,
      context: dimRef.context ?? null,
      blueprint,
      subject: judgeSubject,
    });

    if (!judgeStep) {
      process.stdout.write(`${tag} judge: skipped (no cli.json judge step)\n`);
      return combineDimension({
        id: dimId,
        analyzer: null,
        judge: { kind: "judge", status: "skipped" },
        error: null,
      });
    }

    const outcome = await dimTimer.step(
      "judge",
      () =>
        runTraceJudge({
          step: `judge-${dimId}`,
          config: judgeStep,
          systemPrompt,
          userMessage,
          logDir,
          schema: dim.schema,
          env: { EVAL_DIMENSION_ID: dimId, EVAL_RUN_DIR: runDir },
        }),
      (o) => ({ attempts: o.attempts.length }),
    );

    if (outcome.ok) {
      // Same rule as the runtime harness: a dimension fails iff the judge
      // reported a major finding. The model's own `verdict` is kept in the
      // envelope (raw) and any disagreement is surfaced rather than hidden.
      const verdict = resolveVerdict(outcome.data);
      const status = verdict.status;
      const disagreed = verdict.verdict_disagreement ? " (model said " + verdict.model_verdict + ")" : "";
      process.stdout.write(
        `${tag} judge: ${status}${disagreed} — ${verdict.major_count} major, ${verdict.minor_count} minor ` +
          `(${formatDuration(dimTimer.lastStepMs())})\n`,
      );
      return combineDimension({
        id: dimId,
        analyzer: null,
        judge: {
          kind: "judge",
          status,
          reasoning: outcome.data.reasoning ?? "",
          major_count: verdict.major_count,
          minor_count: verdict.minor_count,
          model_verdict: verdict.model_verdict,
          verdict_disagreement: verdict.verdict_disagreement,
          raw: outcome.data,
          attempts: outcome.attempts,
        },
        error: null,
      });
    }
    process.stdout.write(`${tag} judge: error (${outcome.error.stage})\n`);
    return combineDimension({ id: dimId, analyzer: null, judge: null, error: { ...outcome.error, attempts: outcome.attempts } });
  } catch (err) {
    return combineDimension({ id: dimId, analyzer: null, judge: null, error: { stage: "judge", message: String(err.message ?? err) } });
  } finally {
    dimTimer.finalize();
  }
}

const isMain = import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href;
if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[trace-eval] fatal: ${err.message}\n`);
    process.exit(1);
  });
}

export { runTraceJudge, evaluateDimension };
