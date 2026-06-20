import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import process from "node:process";
import url from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

import { buildBlueprintGenerationChatInput } from "../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

import { runMechanicalChecks } from "../checks/mechanical.mjs";
import { runCli, runCliWithRetries } from "./cli-runner.mjs";
import { buildEnvelope, combineDimension } from "./envelope.mjs";
import { startPhaseHeartbeat, startStepDigest } from "./progress.mjs";
import {
  loadCliConfig,
  loadDimensionDefinition,
  loadDimensions,
  loadJudgeSystemPrompt,
  loadSpec,
  repoRoot,
  resolveSpec,
  tryLoadAnalyzer,
} from "./load.mjs";
import {
  createRunTimer,
  formatDuration,
  formatTimingSummary,
} from "./timing.mjs";

function parseArgs(argv) {
  const args = {
    spec: null,
    config: null,
    blueprint: null,
    runId: null,
    outputRoot: null,
    quiet: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") args.spec = argv[++i];
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--blueprint") args.blueprint = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--output-root") args.outputRoot = argv[++i];
    else if (arg === "--quiet" || arg === "--no-progress") args.quiet = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return `Usage: node evaluation/pipeline/run.mjs --spec <path> [options]

Required:
  --spec <path>          Either a spec directory containing input.brief.json,
                         or a path to a brief JSON file directly.

Options:
  --config <file>        Path to cli.json (default: evaluation/config/cli.json).
  --blueprint <file>     Skip the generate step and use this existing blueprint
                         JSON instead.
  --run-id <id>          Override the run id (default: timestamp-spec_slug).
  --output-root <dir>    Root directory for run output (default: $MYSTERYEVALS_DIR
                         or ~/mysteryevals). Each run gets its own self-contained
                         output directory <root>/<date>/<time>/run-<brief>/ that
                         holds ALL artifacts — result, blueprint, logs, and the
                         generator/judge agent workspaces.
  --quiet, --no-progress Suppress the live agent digest and heartbeat (keeps the
                         milestone lines and log-path hints). Useful for CI.
  -h, --help             Show this help.

Output directory (<root>/<date>/<time>/run-<brief>/):
  result.json                              the structured envelope (always written)
  blueprint.json                           the generated or supplied blueprint
  logs/*.{stdout,stderr,invocation}.{log,json}   per-step CLI logs
  generator/                               generator agent workspace (preserved)
  evaluators/<dimension>/                  each judge agent workspace (preserved)
`;
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  if (args.help || !args.spec) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  const startedAt = new Date();
  const timer = createRunTimer();
  const root = repoRoot();
  let briefPath;
  let specSlug;
  try {
    ({ briefPath, slug: specSlug } = await resolveSpec(args.spec));
  } catch (err) {
    process.stderr.write(`[eval] ${err.message}\n`);
    process.exit(1);
  }
  const specDir = path.dirname(briefPath);
  const runId =
    args.runId ??
    `${startedAt.toISOString().replace(/[:.]/g, "-")}-${specSlug}`;
  // One self-contained output directory per run holds ALL artifacts (result,
  // blueprint, logs, and the generator/judge agent workspaces). It lives
  // OUTSIDE the repo by default so debug iterations don't churn git. Layout:
  //   <outputRoot>/<date>/<time>/run-<brief>/
  // where <date> and <time> are UTC tokens. Every run gets its own directory,
  // so nothing from a prior run is ever overwritten or deleted.
  const runDate = startedAt.toISOString().slice(0, 10);
  const runStamp =
    startedAt.toISOString().slice(11, 19).replace(/:/g, "-") + "Z";
  const outputRoot = path.resolve(
    args.outputRoot ??
      process.env.MYSTERYEVALS_DIR ??
      path.join(os.homedir(), "mysteryevals"),
  );
  const runDir = path.join(outputRoot, runDate, runStamp, `run-${specSlug}`);
  const logDir = path.join(runDir, "logs");
  await fs.mkdir(logDir, { recursive: true });

  process.stdout.write(`[eval] run_id=${runId}\n`);
  process.stdout.write(`[eval] brief=${path.relative(root, briefPath)}\n`);
  process.stdout.write(`[eval] output_dir=${runDir}\n`);
  process.stdout.write(
    `[eval] logs: ${logDir}  (per-step *.stream.jsonl are tailable live)\n`,
  );

  const runState = {
    blueprintPath: null,
    generation: null,
    mechanical: [],
    dimensions: [],
    runError: null,
  };

  try {
    await runPipeline({
      args,
      root,
      briefPath,
      runDir,
      logDir,
      runState,
      timer,
    });
  } catch (err) {
    runState.runError = {
      stage: err.runErrorStage ?? "unknown",
      message: String(err.message ?? err),
    };
    process.stderr.write(`[eval] error: ${runState.runError.message}\n`);
  }

  const endedAt = new Date();
  const timing = timer.summarize();
  const envelope = buildEnvelope({
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    specDir: path.relative(root, specDir),
    blueprintPath: runState.blueprintPath,
    generation: runState.generation,
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
  process.stdout.write(
    `\n[eval] result: ${resultPath} (write ${formatDuration(writeMs)})\n`,
  );
  const dimTotal =
    envelope.summary.dimensions.pass +
    envelope.summary.dimensions.fail +
    envelope.summary.dimensions.error +
    envelope.summary.dimensions.skipped;
  process.stdout.write(
    `[eval] summary: mechanical ${envelope.summary.mechanical.pass}/${
      envelope.summary.mechanical.pass + envelope.summary.mechanical.fail
    } pass, dimensions ${envelope.summary.dimensions.pass}/${dimTotal} pass (${
      envelope.summary.dimensions.skipped
    } skipped), retries ${envelope.summary.retries.generate}+${envelope.summary.retries.judge_total}\n`,
  );

  if (runState.runError) process.exit(1);
}

async function runPipeline({
  args,
  root,
  briefPath,
  runDir,
  logDir,
  runState,
  timer,
}) {
  const { brief } = await timer.stage("load_spec", () => loadSpec(briefPath));
  const dimensions = await timer.stage("load_dimensions", () =>
    loadDimensions(),
  );

  let blueprintJson;
  let cliConfig = null;
  if (args.blueprint) {
    const blueprintPath = path.resolve(args.blueprint);
    process.stdout.write(
      `[eval] blueprint=${path.relative(root, blueprintPath)} (preexisting)\n`,
    );
    blueprintJson = await timer.stage("load_blueprint", async () =>
      JSON.parse(await fs.readFile(blueprintPath, "utf8")),
    );
    runState.generation = {
      skipped: true,
      source: "preexisting",
      input_path: blueprintPath,
    };
    if (args.config) {
      try {
        cliConfig = await loadCliConfig(args.config);
      } catch {
        cliConfig = null;
      }
    } else {
      const defaultConfigPath = path.join(
        root,
        "evaluation",
        "config",
        "cli.json",
      );
      try {
        cliConfig = await loadCliConfig(defaultConfigPath);
      } catch {
        cliConfig = null;
      }
    }
  } else {
    const configPath =
      args.config ?? path.join(root, "evaluation", "config", "cli.json");
    cliConfig = await timer.stage("load_cli_config", async () => {
      try {
        return await loadCliConfig(configPath);
      } catch (err) {
        throw new Error(
          `Could not load CLI config at ${configPath}. Copy evaluation/config/cli.example.json to cli.json and customize, or pass --blueprint to skip generation. (${err.message})`,
        );
      }
    });
    process.stdout.write(
      `[eval] generating blueprint via cli=${cliConfig.generate?.cmd}\n`,
    );
    const chatInput = await timer.stage("build_generation_input", () =>
      buildBlueprintGenerationChatInput(brief),
    );
    const userMessage = chatInput.userMessageContent;
    // The agent-based wrapper ignores the pipeline-rendered system prompt and
    // reads the canonical generator prompt + schema from disk via the
    // workspace. We still pass `chatInput.systemPrompt` so the contract with
    // any non-agent wrapper still works.
    //
    // The wrapper builds its generator workspace at <EVAL_RUN_DIR>/generator/,
    // keeping the agent workspace inside this run's output directory.
    const generateRetries = cliConfig.generate?.retries ?? 0;
    if (generateRetries > 0) {
      process.stdout.write(
        `[eval]   generate retries configured: ${generateRetries}\n`,
      );
    }
    if (!args.quiet) {
      process.stdout.write(
        `[eval] generate: started → tail -f ${path.join(logDir, "generate*.stream.jsonl")}\n`,
      );
    }
    const generateProgress = startStepDigest({
      label: "generate",
      logDir,
      stepPrefix: "generate",
      quiet: args.quiet,
    });
    let generateOutcome;
    try {
      generateOutcome = await timer.stage(
        "generate",
        () =>
          runCliWithRetries({
            step: "generate",
            config: cliConfig.generate,
            systemPrompt: chatInput.systemPrompt,
            userMessage,
            logDir,
            retries: generateRetries,
            env: { EVAL_RUN_DIR: runDir },
            validateExtracted: (extracted) => {
              let parsed;
              try {
                parsed = JSON.parse(extracted);
              } catch (err) {
                throw new Error(
                  `Generated blueprint is not valid JSON (${err.message}). First 200 chars: ${extracted.slice(0, 200)}`,
                );
              }
              const check = BlueprintV2Schema.safeParse(parsed);
              if (!check.success) {
                const issues = check.error.issues
                  .slice(0, 5)
                  .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
                  .join("; ");
                throw new Error(
                  `Generated blueprint failed BlueprintV2Schema: ${issues}` +
                    (check.error.issues.length > 5
                      ? ` (+${check.error.issues.length - 5} more issues)`
                      : ""),
                );
              }
            },
          }),
        (outcome) => ({ attempts: outcome.attempts.length }),
      );
    } finally {
      generateProgress.stop();
    }
    if (!args.quiet && generateOutcome.ok) {
      process.stdout.write(
        `[eval] generate: ok (${formatDuration(timer.lastStageMs())})\n`,
      );
    }
    const totalDurationMs = generateOutcome.attempts.reduce(
      (sum, a) => sum + a.duration_ms,
      0,
    );
    runState.generation = {
      skipped: false,
      source: "cli",
      duration_ms: totalDurationMs,
      cmd: cliConfig.generate.cmd,
      attempts: generateOutcome.attempts,
    };
    if (!generateOutcome.ok) {
      const err = new Error(
        `Generation failed after ${generateOutcome.attempts.length} attempt(s): ${generateOutcome.error.message}`,
      );
      err.runErrorStage = "generate";
      throw err;
    }
    try {
      blueprintJson = JSON.parse(generateOutcome.extracted);
    } catch (parseErr) {
      const lastAttemptIdx = generateOutcome.attempts.length;
      const logName =
        generateOutcome.attempts.length === 1
          ? "generate.stdout.log"
          : `generate.attempt-${lastAttemptIdx}.stdout.log`;
      const err = new Error(
        `Generated blueprint is not valid JSON. See ${path.join(logDir, logName)}. (${parseErr.message})`,
      );
      err.runErrorStage = "generate_parse";
      throw err;
    }
  }

  const blueprintPath = path.join(runDir, "blueprint.json");
  await timer.stage("write_blueprint", () =>
    fs.writeFile(blueprintPath, JSON.stringify(blueprintJson, null, 2)),
  );
  runState.blueprintPath = blueprintPath;

  process.stdout.write(`[eval] running mechanical checks\n`);
  runState.mechanical = await timer.stage(
    "mechanical",
    async () =>
      runMechanicalChecks({
        brief,
        blueprintCandidate: blueprintJson,
      }),
    (checks) => ({ checks: checks.length }),
  );
  const mechFailed = runState.mechanical.filter((c) => c.status === "fail");
  process.stdout.write(
    `[eval] mechanical: ${runState.mechanical.length - mechFailed.length}/${runState.mechanical.length} passed (${formatDuration(timer.lastStageMs())})\n`,
  );

  let parsedBlueprint = null;
  const bpCheck = await timer.stage("blueprint_schema_validate", async () =>
    BlueprintV2Schema.safeParse(blueprintJson),
  );
  if (bpCheck.success) parsedBlueprint = bpCheck.data;

  const judgeSystemBase = await timer.stage("load_judge_system_prompt", () =>
    loadJudgeSystemPrompt(),
  );
  const judgeStep = cliConfig?.judge ?? null;

  process.stdout.write(
    `[eval] dimensions: ${dimensions.length} started in parallel\n`,
  );
  if (judgeStep && !args.quiet) {
    process.stdout.write(
      `[eval]   tail -f ${path.join(logDir, "judge-*.stream.jsonl")}  (or judge-<dim>*.stream.jsonl for one)\n`,
    );
  }

  // Parallel-phase progress: a single heartbeat summarising done/running counts
  // (interleaving 6 live agent digests would be unreadable — tail the per-judge
  // stream files above for detail), plus a tally line as each dimension lands.
  const dimsStartedAt = performance.now();
  const total = dimensions.length;
  let done = 0;
  const running = new Set(dimensions.map((d) => d.id));
  const dimsHeartbeat = judgeStep
    ? startPhaseHeartbeat({
        quiet: args.quiet,
        status: () =>
          `[eval] dimensions: ${formatDuration(performance.now() - dimsStartedAt)} — ${done}/${total} done` +
          (running.size ? `; running: ${[...running].join(", ")}` : ""),
      })
    : { stop() {} };

  try {
    runState.dimensions = await timer.stage(
      "dimensions",
      () =>
        Promise.all(
          dimensions.map((dimRef) =>
            evaluateDimension({
              dimRef,
              brief,
              parsedBlueprint,
              blueprintJson,
              judgeSystemBase,
              judgeStep,
              logDir,
              runDir,
              timer,
            }).finally(() => {
              running.delete(dimRef.id);
              done += 1;
              if (judgeStep && !args.quiet) {
                process.stdout.write(
                  `[eval] dimensions: ${done}/${total} done` +
                    (running.size
                      ? `; running: ${[...running].join(", ")}`
                      : "") +
                    `\n`,
                );
              }
            }),
          ),
        ),
      (results) => ({ count: results.length, parallel: true }),
    );
  } finally {
    dimsHeartbeat.stop();
  }
}

async function evaluateDimension({
  dimRef,
  brief,
  parsedBlueprint,
  blueprintJson,
  judgeSystemBase,
  judgeStep,
  logDir,
  runDir,
  timer,
}) {
  const dimId = dimRef.id;
  const tag = `[eval][${dimId}]`;
  const dimTimer = timer.dimension(dimId);

  try {
    if (!parsedBlueprint) {
      process.stdout.write(
        `${tag} skipped (blueprint failed schema validation)\n`,
      );
      return combineDimension({
        id: dimId,
        analyzer: null,
        judge: null,
        error: {
          stage: "prep",
          message:
            "Blueprint failed schema validation; analyzers and judge skipped.",
        },
      });
    }

    let analyzerResult = null;
    let judgeResult = null;
    let dimError = null;

    try {
      const analyzer = await dimTimer.step("load_analyzer", () =>
        tryLoadAnalyzer(dimId),
      );
      if (analyzer) {
        const r = await dimTimer.step("analyzer", async () =>
          analyzer.analyze({
            brief,
            blueprint: parsedBlueprint,
            context: dimRef.context ?? null,
          }),
        );
        analyzerResult = { ...r, kind: "analyzer" };
        process.stdout.write(
          `${tag} analyzer: ${r.status} (${formatDuration(dimTimer.lastStepMs())})\n`,
        );
      }
    } catch (err) {
      dimError = { stage: "analyzer", message: err.message };
    }

    if (!dimError) {
      try {
        const dim = await dimTimer.step("load_definition", () =>
          loadDimensionDefinition(dimId),
        );
        const judgeContext = dimRef.context ?? null;
        const systemPrompt = await dimTimer.step("compose_prompt", async () =>
          composeJudgeSystemPrompt({
            base: judgeSystemBase,
            dimensionText: dim.text,
            schema: dim.schema,
            context: judgeContext,
          }),
        );
        const userMessage = JSON.stringify({
          dimension_id: dimId,
          context: judgeContext,
          story_brief: brief,
          blueprint: blueprintJson,
        });

        if (!judgeStep) {
          process.stdout.write(
            `${tag} judge: skipped (no cli.json judge step)\n`,
          );
        } else {
          const judgeOutcome = await dimTimer.step(
            "judge",
            () =>
              runJudgeWithRetries({
                step: `judge-${dimId}`,
                config: judgeStep,
                systemPrompt,
                userMessage,
                logDir,
                schema: dim.schema,
                env: {
                  EVAL_DIMENSION_ID: dimId,
                  EVAL_RUN_DIR: runDir,
                },
              }),
            (outcome) => ({ attempts: outcome.attempts.length }),
          );
          const judgeMs = dimTimer.lastStepMs();
          if (judgeOutcome.ok) {
            const status =
              judgeOutcome.data.verdict === "pass" ? "pass" : "fail";
            judgeResult = {
              kind: "judge",
              status,
              reasoning: judgeOutcome.data.reasoning ?? "",
              raw: judgeOutcome.data,
              attempts: judgeOutcome.attempts,
            };
            const retries = judgeOutcome.attempts.length - 1;
            const retryNote =
              retries > 0 ? ` (after ${retries} retry/retries)` : "";
            process.stdout.write(
              `${tag} judge: ${status}${retryNote} (${formatDuration(judgeMs)})\n`,
            );
          } else {
            dimError = {
              ...judgeOutcome.error,
              attempts: judgeOutcome.attempts,
            };
            process.stdout.write(
              `${tag} judge: error (${dimError.stage}, ${judgeOutcome.attempts.length} attempt(s), ${formatDuration(judgeMs)})\n`,
            );
          }
        }
      } catch (err) {
        dimError = { stage: "judge", message: err.message };
      }
    }

    return combineDimension({
      id: dimId,
      analyzer: analyzerResult,
      judge: judgeResult,
      error: dimError,
    });
  } finally {
    dimTimer.finalize();
  }
}

// Wraps the judge call with a single retry budget that covers both
// CLI-shell-out failures (non-zero exit, timeout, stdout not JSON, extract_path
// miss) AND the Zod schema validation of the model's output. Each attempt
// gets its own log files when retries > 0.
async function runJudgeWithRetries({
  step,
  config,
  systemPrompt,
  userMessage,
  logDir,
  schema,
  env = null,
}) {
  const retries = Number.isInteger(config.retries)
    ? Math.max(0, config.retries)
    : 0;
  const max = 1 + retries;
  const attempts = [];

  for (let i = 1; i <= max; i += 1) {
    const startedAt = Date.now();
    const attemptStep = max === 1 ? step : `${step}.attempt-${i}`;

    let extracted;
    try {
      const result = await runCli({
        step: attemptStep,
        config,
        systemPrompt,
        userMessage,
        logDir,
        env,
      });
      extracted = result.extracted;
    } catch (err) {
      attempts.push({
        attempt: i,
        outcome: "cli_fail",
        duration_ms: Date.now() - startedAt,
        error: String(err.message ?? err).slice(0, 500),
      });
      if (i === max) {
        return {
          ok: false,
          error: { stage: "judge", message: String(err.message ?? err) },
          attempts,
        };
      }
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
      attempts.push({
        attempt: i,
        outcome: "ok",
        duration_ms: Date.now() - startedAt,
      });
      return { ok: true, data: validation.data, attempts };
    }
    attempts.push({
      attempt: i,
      outcome: "schema_fail",
      duration_ms: Date.now() - startedAt,
      error: validation.message.slice(0, 500),
    });
    if (i === max) {
      return {
        ok: false,
        error: {
          stage: "judge_parse",
          message: validation.message,
          raw: extracted.slice(0, 1000),
        },
        attempts,
      };
    }
  }
  // Unreachable.
  return {
    ok: false,
    error: { stage: "judge", message: "runJudgeWithRetries fell through" },
    attempts,
  };
}

function composeJudgeSystemPrompt({ base, dimensionText, schema, context }) {
  let composed = `${base}\n\n---\n\n${dimensionText}`;
  if (schema) {
    const jsonSchema = zodToJsonSchema(schema, { target: "jsonSchema7" });
    composed +=
      `\n\n---\n\n## Output JSON Schema (authoritative)\n\n` +
      `Your response MUST be a single JSON object matching this schema. ` +
      `If the prose contract above and this schema disagree, the schema wins.\n\n` +
      `\`\`\`json\n${JSON.stringify(jsonSchema, null, 2)}\n\`\`\`\n`;
  }
  if (context && typeof context === "object") {
    composed += `\n\n---\n\n## Per-spec context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
  }
  return composed;
}

function validateJudgeOutput(parsed, schema) {
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, message: "Judge output is not a JSON object." };
  }
  if (!schema) {
    if (!("verdict" in parsed)) {
      return {
        ok: false,
        message: "Judge output did not match expected shape (missing verdict).",
      };
    }
    return { ok: true, data: parsed };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      message: `Judge output failed schema validation: ${issues}`,
    };
  }
  return { ok: true, data: result.data };
}

const isMain =
  import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[eval] fatal: ${err.message}\n`);
    process.exit(1);
  });
}
