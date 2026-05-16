import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import url from "node:url";

import { buildBlueprintGenerationChatInput } from "../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

import { runMechanicalChecks } from "../checks/mechanical.mjs";
import { runCli } from "./cli-runner.mjs";
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
  evaluation/runs/<run_id>/blueprint.json
  evaluation/runs/<run_id>/result.json
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

  const { brief, outcome } = await loadSpec(specDir);

  let blueprintJson;
  let generationMeta;
  if (args.blueprint) {
    const blueprintPath = path.resolve(args.blueprint);
    process.stdout.write(`[eval] blueprint=${path.relative(root, blueprintPath)} (preexisting)\n`);
    blueprintJson = JSON.parse(await fs.readFile(blueprintPath, "utf8"));
    generationMeta = { skipped: true, source: "preexisting", input_path: blueprintPath };
  } else {
    const configPath =
      args.config ?? path.join(root, "evaluation", "config", "cli.json");
    let cliConfig;
    try {
      cliConfig = await loadCliConfig(configPath);
    } catch (err) {
      throw new Error(
        `Could not load CLI config at ${configPath}. Copy evaluation/config/cli.example.json to cli.json and customize, or pass --blueprint to skip generation. (${err.message})`,
      );
    }
    process.stdout.write(`[eval] generating blueprint via cli=${cliConfig.generate?.cmd}\n`);
    const generationStart = Date.now();
    const chatInput = await buildBlueprintGenerationChatInput(brief);
    const userMessage = chatInput.userMessageContent;
    const { extracted } = await runCli({
      step: "generate",
      config: cliConfig.generate,
      systemPrompt: chatInput.systemPrompt,
      userMessage,
      logDir,
    });
    try {
      blueprintJson = JSON.parse(extracted);
    } catch (err) {
      throw new Error(
        `Generated blueprint is not valid JSON. See ${path.join(logDir, "generate.stdout.log")}. (${err.message})`,
      );
    }
    generationMeta = {
      skipped: false,
      source: "cli",
      duration_ms: Date.now() - generationStart,
      cmd: cliConfig.generate.cmd,
    };
  }

  const blueprintPath = path.join(runDir, "blueprint.json");
  await fs.writeFile(blueprintPath, JSON.stringify(blueprintJson, null, 2));

  process.stdout.write(`[eval] running mechanical checks\n`);
  const mechanical = runMechanicalChecks({
    brief,
    blueprintCandidate: blueprintJson,
  });
  const mechFailed = mechanical.filter((c) => c.status === "fail");
  process.stdout.write(
    `[eval] mechanical: ${mechanical.length - mechFailed.length}/${mechanical.length} passed\n`,
  );

  // Use parsed blueprint for analyzers/judge if schema validation succeeded.
  let parsedBlueprint = null;
  const bpCheck = BlueprintV2Schema.safeParse(blueprintJson);
  if (bpCheck.success) parsedBlueprint = bpCheck.data;

  let cliConfigForJudge = null;
  if (!args.blueprint) {
    cliConfigForJudge = await loadCliConfig(
      args.config ?? path.join(root, "evaluation", "config", "cli.json"),
    );
  } else if (args.config) {
    try {
      cliConfigForJudge = await loadCliConfig(args.config);
    } catch {
      cliConfigForJudge = null;
    }
  } else {
    const defaultConfigPath = path.join(root, "evaluation", "config", "cli.json");
    try {
      cliConfigForJudge = await loadCliConfig(defaultConfigPath);
    } catch {
      cliConfigForJudge = null;
    }
  }

  const judgeSystemBase = await loadJudgeSystemPrompt();

  const dimensions = [];
  for (const dimRef of outcome.dimensions) {
    const dimId = dimRef.id;
    process.stdout.write(`[eval] dimension=${dimId}\n`);
    let analyzerResult = null;
    let judgeResult = null;
    let dimError = null;

    if (!parsedBlueprint) {
      dimensions.push(
        combineDimension({
          id: dimId,
          analyzer: null,
          judge: null,
          error: {
            stage: "prep",
            message: "Blueprint failed schema validation; analyzers and judge skipped.",
          },
        }),
      );
      continue;
    }

    try {
      const analyzer = await tryLoadAnalyzer(dimId);
      if (analyzer) {
        const r = analyzer.analyze({
          brief,
          blueprint: parsedBlueprint,
          context: dimRef.context ?? null,
        });
        analyzerResult = { ...r, kind: "analyzer" };
        process.stdout.write(`[eval]   analyzer: ${r.status}\n`);
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
          context: judgeContext,
        });
        const userMessage = JSON.stringify({
          dimension_id: dimId,
          context: judgeContext,
          story_brief: brief,
          blueprint: blueprintJson,
        });

        if (!cliConfigForJudge?.judge) {
          process.stdout.write(`[eval]   judge: skipped (no cli.json judge step)\n`);
        } else {
          const { extracted } = await runCli({
            step: `judge-${dimId}`,
            config: cliConfigForJudge.judge,
            systemPrompt,
            userMessage,
            logDir,
          });
          let parsed;
          try {
            parsed = JSON.parse(extracted);
          } catch {
            parsed = null;
          }
          if (!parsed || typeof parsed !== "object" || !("verdict" in parsed)) {
            dimError = {
              stage: "judge_parse",
              message: "Judge output did not match expected shape (missing verdict).",
              raw: extracted.slice(0, 1000),
            };
          } else {
            const status = parsed.verdict === "pass" ? "pass" : "fail";
            judgeResult = {
              kind: "judge",
              status,
              reasoning: parsed.reasoning ?? "",
              raw: parsed,
            };
            process.stdout.write(`[eval]   judge: ${status}\n`);
          }
        }
      } catch (err) {
        dimError = { stage: "judge", message: err.message };
      }
    }

    dimensions.push(
      combineDimension({ id: dimId, analyzer: analyzerResult, judge: judgeResult, error: dimError }),
    );
  }

  const endedAt = new Date();
  const envelope = buildEnvelope({
    runId,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    specDir: path.relative(root, specDir),
    blueprintPath: path.relative(root, blueprintPath),
    generation: generationMeta,
    mechanical,
    dimensions,
  });

  const resultPath = path.join(runDir, "result.json");
  await fs.writeFile(resultPath, JSON.stringify(envelope, null, 2));

  process.stdout.write(`\n[eval] result: ${path.relative(root, resultPath)}\n`);
  process.stdout.write(
    `[eval] summary: mechanical ${envelope.summary.mechanical.pass}/${
      envelope.summary.mechanical.pass + envelope.summary.mechanical.fail
    } pass, dimensions ${envelope.summary.dimensions.pass}/${
      envelope.summary.dimensions.pass +
      envelope.summary.dimensions.fail +
      envelope.summary.dimensions.error
    } pass\n`,
  );
}

function composeJudgeSystemPrompt({ base, dimensionText, context }) {
  let composed = `${base}\n\n---\n\n${dimensionText}`;
  if (context && typeof context === "object") {
    composed += `\n\n---\n\n## Per-spec context\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n`;
  }
  return composed;
}

const isMain =
  import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  main().catch((err) => {
    process.stderr.write(`[eval] error: ${err.message}\n`);
    process.exit(1);
  });
}
