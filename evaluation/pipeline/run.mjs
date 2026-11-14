// Generates a blueprint from a brief with the LLM CLI bound in the generate
// config, then judges it through the evaluation core, exactly as
// `./dev eval judge blueprint` does. Generation is this script's own; judging
// is the core's, so the result is the core's `result.json`, with the model
// calls that made the blueprint recorded as its `production`.
//
//   npm run eval -- --spec <spec directory or brief file> [options]
//
// To judge a blueprint that already exists, use `./dev eval judge blueprint`.

import path from "node:path";
import process from "node:process";
import url from "node:url";

import { buildBlueprintGenerationChatInput } from "../../packages/blueprint-generator/src/index.ts";
import { BlueprintV2Schema } from "../../packages/shared/src/blueprint-schema-v2.ts";

import { judgeBindingFor, parseSelection, summaryLines } from "../blueprint/commands.ts";
import { readJsonFile, resolveBrief } from "../blueprint/inputs.ts";
import { judgeBlueprintSubject, runErrorOf, writeBlueprintResult } from "../blueprint/subject.ts";
import { parseCommandArgs } from "../core/args.ts";
import { ConfigError, InputError, UsageError } from "../core/errors.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { promptSha256 } from "../core/runner.ts";
import { createRunTimer } from "../core/timing.ts";
import { runCliWithRetries } from "./cli-runner.mjs";

const ROOT = path.resolve(url.fileURLToPath(import.meta.url), "..", "..", "..");
const DEFAULT_GENERATE_CONFIG = path.join("evaluation", "config", "cli.json");

const USAGE = `Usage: npm run eval -- --spec <path> [options]

Generates a blueprint from a brief, then judges it as \`./dev eval judge
blueprint\` does and writes the core's result.json (evaluation/README.md).

Required:
  --spec <path>             A spec directory holding input.brief.json, or a
                            brief JSON file.

Options:
  --generate-config <file>  The generate binding (default:
                            evaluation/config/cli.json).
  --judges <a,b>            Judge only these dimensions; the rest are skipped.
  --no-judges               Generate and run the checks; skip the judges.
  --quiet, --no-progress    No live progress digest.
  --config <file>           The bindings file the judge binding is read from
                            (default: evaluation/config.json, else
                            evaluation/config.example.json).
  --output-root <dir>       Where runs are written (default: $MYSTERYEVALS_DIR,
                            else ~/mysteryevals).
  --model-override <binding>=<model>   Another model for one binding, one run.
  -h, --help                Show this help.
`;

const ATTEMPT_OUTCOMES = { ok: "ok", cli_fail: "exit", parse_fail: "invalid" };

/** The generate binding as a run records it. */
function generateBindingOf(generateConfig) {
  return {
    name: "generate",
    command: generateConfig.cmd,
    cmd: generateConfig.cmd,
    args: generateConfig.args ?? [],
    extract_path: generateConfig.extract_path ?? null,
    model: null,
    timeout_ms: generateConfig.timeout_ms ?? 120000,
    retries: generateConfig.retries ?? 0,
  };
}

/** The model call that made the blueprint, with every attempt it took. */
function generationCall(chatInput, attempts) {
  return {
    binding: "generate",
    model: null,
    prompt_sha256: promptSha256(chatInput.systemPrompt, chatInput.userMessageContent),
    duration_ms: attempts.reduce((sum, a) => sum + a.duration_ms, 0),
    cost_usd: null,
    attempts: attempts.map((a) => ({
      attempt: a.attempt,
      outcome: ATTEMPT_OUTCOMES[a.outcome] ?? "exit",
      duration_ms: a.duration_ms,
      cost_usd: null,
      ...(a.error ? { error: a.error } : {}),
    })),
  };
}

/** Rejects generated text that is not a Blueprint V2, so the attempt is retried. */
function validateGenerated(extracted) {
  let parsed;
  try {
    parsed = JSON.parse(extracted);
  } catch (err) {
    throw new Error(
      `Generated blueprint is not valid JSON (${err.message}). First 200 chars: ${extracted.slice(0, 200)}`,
      { cause: err },
    );
  }
  const check = BlueprintV2Schema.safeParse(parsed);
  if (check.success) return;
  const issues = check.error.issues
    .slice(0, 5)
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  const more = check.error.issues.length > 5 ? ` (+${check.error.issues.length - 5} more issues)` : "";
  throw new Error(`Generated blueprint failed BlueprintV2Schema: ${issues}${more}`);
}

/** Runs the generate binding with its retries; returns the outcome and the prompt it was sent. */
async function generate({ generateConfig, brief, subjectDir, logDir, timer, quiet, write }) {
  const chatInput = await timer.stage("build_generation_input", () => buildBlueprintGenerationChatInput(brief));
  write(`[eval] generating blueprint via cli=${generateConfig.cmd}`);
  if (!quiet) write(`[eval] generate: started → tail -f ${path.join(logDir, "generate*.stream.jsonl")}`);
  const digest = startDigest("generate", ["generate"], { logDir, quiet, write });
  try {
    // `chatInput.systemPrompt` is the canonical generator prompt plus the age
    // guidance for the brief. The agent wrapper builds its workspace at
    // <EVAL_RUN_DIR>/generator/ and copies it in as the agent's prompt.
    const outcome = await timer.stage(
      "generate",
      () =>
        runCliWithRetries({
          step: "generate",
          config: generateConfig,
          systemPrompt: chatInput.systemPrompt,
          userMessage: chatInput.userMessageContent,
          logDir,
          retries: generateConfig.retries ?? 0,
          env: { EVAL_RUN_DIR: subjectDir },
          validateExtracted: validateGenerated,
        }),
      (result) => ({ attempts: result.attempts.length }),
    );
    if (!quiet && outcome.ok) write(`[eval] generate: ok (${formatDuration(timer.lastStageMs())})`);
    return { outcome, chatInput };
  } finally {
    digest.stop();
  }
}

async function readGenerateConfig(file) {
  const config = await readJsonFile(path.resolve(ROOT, file), "generate config");
  if (!config?.generate?.cmd) {
    throw new ConfigError(`${file} has no "generate" binding. Copy evaluation/config/cli.example.json to evaluation/config/cli.json.`);
  }
  return config.generate;
}

async function main(argv, write) {
  const { common, values } = parseCommandArgs(argv, {
    options: {
      spec: { type: "string" },
      "generate-config": { type: "string" },
      judges: { type: "string" },
      "no-judges": { type: "boolean" },
      quiet: { type: "boolean" },
      "no-progress": { type: "boolean" },
    },
  });
  if (common.help) {
    write(USAGE);
    return 0;
  }
  if (typeof values.spec !== "string") throw new UsageError("--spec is required");
  const quiet = values.quiet === true || values["no-progress"] === true;
  const selection = parseSelection(values);
  const context = { root: ROOT, env: process.env, out: write, err: write };
  const judgeBinding = judgeBindingFor(selection, context, common);
  const generateConfig = await readGenerateConfig(
    typeof values["generate-config"] === "string" ? values["generate-config"] : DEFAULT_GENERATE_CONFIG,
  );

  const timer = createRunTimer();
  const source = await resolveBrief(values.spec);
  const brief = await timer.stage("load_spec", () => readJsonFile(source.file, "brief"));
  const generateBinding = generateBindingOf(generateConfig);
  const run = createRunFolder({
    outputRoot: resolveOutputRoot(common.outputRoot, process.env),
    command: "eval",
    argv,
    root: ROOT,
    bindings: judgeBinding ? [generateBinding, judgeBinding] : [generateBinding],
  });
  const folder = run.subject({ kind: "blueprint", id: source.slug });
  write(`[eval] brief=${path.relative(ROOT, source.file)}`);
  write(`[eval] run=${run.dir}`);

  const subject = { run, folder, id: source.slug, timer, production: null };
  let result;
  try {
    const { outcome, chatInput } = await generate({
      generateConfig,
      brief,
      subjectDir: folder.dir,
      logDir: folder.logDir,
      timer,
      quiet,
      write,
    });
    subject.production = [generationCall(chatInput, outcome.attempts)];
    if (!outcome.ok) {
      const error = new Error(`Generation failed after ${outcome.attempts.length} attempt(s): ${outcome.error.message}`);
      error.runErrorStage = "generate";
      throw error;
    }
    result = await judgeBlueprintSubject(subject, {
      brief,
      blueprint: JSON.parse(outcome.extracted),
      binding: judgeBinding,
      selection,
      quiet,
      write,
    });
  } catch (error) {
    result = await writeBlueprintResult(subject, { verdicts: [], runError: runErrorOf(error), stored: false });
  }
  const index = await run.finish();
  for (const line of summaryLines(result, folder.resultFile)) write(line);
  return index.exit_code;
}

if (import.meta.url === url.pathToFileURL(process.argv[1] ?? "").href) {
  const write = (text) => process.stdout.write(`${text}\n`);
  main(process.argv.slice(2), write).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      const clean = error instanceof UsageError || error instanceof ConfigError || error instanceof InputError;
      process.stderr.write(`[eval] ${clean ? error.message : `fatal: ${error.stack ?? error}`}\n`);
      process.exitCode = 1;
    },
  );
}
