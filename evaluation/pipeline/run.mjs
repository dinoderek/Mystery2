import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";

import { buildBlueprintGenerationChatInput } from "../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

import { runMechanicalChecks } from "../checks/mechanical.mjs";
import { runCli, runCliWithRetries } from "./cli-runner.mjs";
import { buildEnvelope, combineDimension } from "./envelope.mjs";
import {
  loadCliConfig,
  loadDimensionDefinition,
  loadJudgeSystemPrompt,
  loadSpec,
  repoRoot,
  tryLoadAnalyzer,
} from "./load.mjs";

function parseArgs(argv) {
  const args = { spec: null, config: null, blueprint: null, runId: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--spec") args.spec = argv[++i];
    else if (arg === "--config") args.config = argv[++i];
    else if (arg === "--blueprint") args.blueprint = argv[++i];
    else if (arg === "--run-id") args.runId = argv[++i];
    else if (arg === "--help" || arg === "-h") args.help = true;
  }
  return args;
}

function usage() {
  return `Usage: node evaluation/pipeline/run.mjs --spec <spec-dir> [options]

Required:
  --spec <dir>           Path to a spec directory containing input.brief.json
                         and outcome.spec.json.

Options:
  --config <file>        Path to cli.json (default: evaluation/config/cli.json).
  --blueprint <file>     Skip the generate step and use this existing blueprint
                         JSON instead.
  --run-id <id>          Override the run id (default: timestamp-spec_slug).
  -h, --help             Show this help.

Outputs:
  evaluation/runs/<run_id>/blueprint.json   (when generation succeeds)
  evaluation/runs/<run_id>/result.json      (always written)
  evaluation/runs/<run_id>/logs/*.{stdout,stderr,invocation}.{log,json}
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
  const root = repoRoot();
  const specDir = path.resolve(args.spec);
  const specSlug = path.basename(specDir);
  const runId =
    args.runId ?? `${startedAt.toISOString().replace(/[:.]/g, "-")}-${specSlug}`;
  const runDir = path.join(root, "evaluation", "runs", runId);
  const logDir = path.join(runDir, "logs");
  await fs.mkdir(logDir, { recursive: true });

  process.stdout.write(`[eval] run_id=${runId}\n`);
  process.stdout.write(`[eval] spec_dir=${path.relative(root, specDir)}\n`);

  const runState = {
    blueprintPath: null,
    generation: null,
    mechanical: [],
    dimensions: [],
    runError: null,
  };

  try {
    await runPipeline({ args, root, specDir, runDir, logDir, runState });
  } catch (err) {
    runState.runError = {
      stage: err.runErrorStage ?? "unknown",
      message: String(err.message ?? err),
    };
    process.stderr.write(`[eval] error: ${runState.runError.message}\n`);
  }

  const endedAt = new Date();
  const envelope = buildEnvelope({
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    specDir: path.relative(root, specDir),
    blueprintPath: runState.blueprintPath
      ? path.relative(root, runState.blueprintPath)
      : null,
    generation: runState.generation,
    mechanical: runState.mechanical,
    dimensions: runState.dimensions,
    runError: runState.runError,
  });

  const resultPath = path.join(runDir, "result.json");
  await fs.writeFile(resultPath, JSON.stringify(envelope, null, 2));

  process.stdout.write(`\n[eval] result: ${path.relative(root, resultPath)}\n`);
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

async function runPipeline({ args, root, specDir, runDir, logDir, runState }) {
  const { brief, outcome } = await taggedStage("load_spec", () => loadSpec(specDir));

  let blueprintJson;
  let cliConfig = null;
  if (args.blueprint) {
    const blueprintPath = path.resolve(args.blueprint);
    process.stdout.write(`[eval] blueprint=${path.relative(root, blueprintPath)} (preexisting)\n`);
    blueprintJson = await taggedStage("load_blueprint", async () =>
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
      const defaultConfigPath = path.join(root, "evaluation", "config", "cli.json");
      try {
        cliConfig = await loadCliConfig(defaultConfigPath);
      } catch {
        cliConfig = null;
      }
    }
  } else {
    const configPath =
      args.config ?? path.join(root, "evaluation", "config", "cli.json");
    cliConfig = await taggedStage("load_cli_config", async () => {
      try {
        return await loadCliConfig(configPath);
      } catch (err) {
        throw new Error(
          `Could not load CLI config at ${configPath}. Copy evaluation/config/cli.example.json to cli.json and customize, or pass --blueprint to skip generation. (${err.message})`,
        );
      }
    });
    process.stdout.write(`[eval] generating blueprint via cli=${cliConfig.generate?.cmd}\n`);
    const chatInput = await buildBlueprintGenerationChatInput(brief);
    const userMessage = chatInput.userMessageContent;
    const generateRetries = cliConfig.generate?.retries ?? 0;
    if (generateRetries > 0) {
      process.stdout.write(`[eval]   generate retries configured: ${generateRetries}\n`);
    }
    const generateOutcome = await runCliWithRetries({
      step: "generate",
      config: cliConfig.generate,
      systemPrompt: chatInput.systemPrompt,
      userMessage,
      logDir,
      retries: generateRetries,
    });
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
  await fs.writeFile(blueprintPath, JSON.stringify(blueprintJson, null, 2));
  runState.blueprintPath = blueprintPath;

  process.stdout.write(`[eval] running mechanical checks\n`);
  runState.mechanical = runMechanicalChecks({
    brief,
    blueprintCandidate: blueprintJson,
  });
  const mechFailed = runState.mechanical.filter((c) => c.status === "fail");
  process.stdout.write(
    `[eval] mechanical: ${runState.mechanical.length - mechFailed.length}/${runState.mechanical.length} passed\n`,
  );

  let parsedBlueprint = null;
  const bpCheck = BlueprintV2Schema.safeParse(blueprintJson);
  if (bpCheck.success) parsedBlueprint = bpCheck.data;

  const judgeSystemBase = await loadJudgeSystemPrompt();
  const judgeStep = cliConfig?.judge ?? null;

  process.stdout.write(
    `[eval] evaluating ${outcome.dimensions.length} dimension(s) in parallel\n`,
  );

  runState.dimensions = await Promise.all(
    outcome.dimensions.map((dimRef) =>
      evaluateDimension({
        dimRef,
        brief,
        parsedBlueprint,
        blueprintJson,
        judgeSystemBase,
        judgeStep,
        logDir,
      }),
    ),
  );
}

async function evaluateDimension({
  dimRef,
  brief,
  parsedBlueprint,
  blueprintJson,
  judgeSystemBase,
  judgeStep,
  logDir,
}) {
  const dimId = dimRef.id;
  const tag = `[eval][${dimId}]`;

  if (!parsedBlueprint) {
    process.stdout.write(`${tag} skipped (blueprint failed schema validation)\n`);
    return combineDimension({
      id: dimId,
      analyzer: null,
      judge: null,
      error: {
        stage: "prep",
        message: "Blueprint failed schema validation; analyzers and judge skipped.",
      },
    });
  }

  let analyzerResult = null;
  let judgeResult = null;
  let dimError = null;

  try {
    const analyzer = await tryLoadAnalyzer(dimId);
    if (analyzer) {
      const r = analyzer.analyze({
        brief,
        blueprint: parsedBlueprint,
        context: dimRef.context ?? null,
      });
      analyzerResult = { ...r, kind: "analyzer" };
      process.stdout.write(`${tag} analyzer: ${r.status}\n`);
    }
  } catch (err) {
    dimError = { stage: "analyzer", message: err.message };
  }

  if (!dimError) {
    try {
      const dim = await loadDimensionDefinition(dimId);
      const judgeContext = dimRef.context ?? null;
      const systemPrompt = composeJudgeSystemPrompt({
        base: judgeSystemBase,
        dimensionText: dim.text,
        schema: dim.schema,
        context: judgeContext,
      });
      const userMessage = JSON.stringify({
        dimension_id: dimId,
        context: judgeContext,
        story_brief: brief,
        blueprint: blueprintJson,
      });

      if (!judgeStep) {
        process.stdout.write(`${tag} judge: skipped (no cli.json judge step)\n`);
      } else {
        const judgeOutcome = await runJudgeWithRetries({
          step: `judge-${dimId}`,
          config: judgeStep,
          systemPrompt,
          userMessage,
          logDir,
          schema: dim.schema,
        });
        if (judgeOutcome.ok) {
          const status = judgeOutcome.data.verdict === "pass" ? "pass" : "fail";
          judgeResult = {
            kind: "judge",
            status,
            reasoning: judgeOutcome.data.reasoning ?? "",
            raw: judgeOutcome.data,
            attempts: judgeOutcome.attempts,
          };
          const retries = judgeOutcome.attempts.length - 1;
          const retryNote = retries > 0 ? ` (after ${retries} retry/retries)` : "";
          process.stdout.write(`${tag} judge: ${status}${retryNote}\n`);
        } else {
          dimError = { ...judgeOutcome.error, attempts: judgeOutcome.attempts };
          process.stdout.write(
            `${tag} judge: error (${dimError.stage}, ${judgeOutcome.attempts.length} attempt(s))\n`,
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
}) {
  const retries = Number.isInteger(config.retries) ? Math.max(0, config.retries) : 0;
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
  return { ok: false, error: { stage: "judge", message: "runJudgeWithRetries fell through" }, attempts };
}

async function taggedStage(stage, fn) {
  try {
    return await fn();
  } catch (err) {
    if (!err.runErrorStage) err.runErrorStage = stage;
    throw err;
  }
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
