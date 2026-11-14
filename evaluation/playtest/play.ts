/**
 * `./dev eval play`: self-play. An AI investigator plays whole games through the
 * real server, or `--replay` replays a recorded game's inputs.
 *
 *   ./dev eval play --blueprint the-missing-heartwood [options]
 *   ./dev eval play --replay <run>/<game>/script.json [options]
 *
 * It starts the game on a server of its own, against a throwaway database, and
 * plays each game with an investigator (one Claude call per turn through the
 * model runner and the `investigator` binding, playing a persona) while the
 * game narrates through the claude CLI. Every game is a subject of the run: a
 * folder with its `result.json`, a readable transcript, the investigator's
 * inputs as a script for replay, every step and every narrator call. The run
 * gets `report.html`, every game on one page. See evaluation/playtest/README.md.
 *
 * With --replay the inputs come from a recorded game's script.json, with no
 * investigator calls, so a narrator or prompt change can be compared on the same
 * inputs. The replay stops where the game no longer matches the recording
 * (another place, mode, or person to talk to) and records where.
 *
 * With --judge, each game is graded as soon as it ends, while the next ones
 * play: `judge game` runs on it (the mechanical checks and the gm_* judges), and
 * every narration gets a reading level. The command exits by the core's rule:
 * 0 when every game ran and every check passed, 1 when a game could not be
 * played or graded, 2 when a judge failed a game.
 */

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue, ParsedArgs } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { InputError, UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { createRunFolder, resolveOutputRoot, slugify } from "../core/run-folder.ts";
import type { RunFolder, SubjectFolder } from "../core/run-folder.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from "../core/result.ts";
import type { Result, RunError } from "../core/result.ts";
import { startThrowawayServer } from "../runtime/lib/replay-server.ts";
import type { StartServer, ThrowawayServer } from "../runtime/lib/replay-server.ts";
import { signIn } from "./lib/api.ts";
import { copyDatabase, readPlayedEvents } from "./lib/database.ts";
import { DEFAULT_MAX_STEPS, playGame } from "./lib/game.ts";
import type { PlayedGame } from "./lib/game.ts";
import { INVESTIGATOR_BINDING, listPersonas, modelInvestigator, scriptedInvestigator } from "./lib/investigator.ts";
import type { Investigator, ScriptedInvestigator } from "./lib/investigator.ts";
import { extractTrace, gradeGame, renderGrades } from "./lib/judge.ts";
import type { Grades } from "./lib/judge.ts";
import { writeGameFolder } from "./lib/output.ts";
import type { GameSummary, PlaytestBlueprint, ReplayInfo } from "./lib/output.ts";
import { writeReport } from "./lib/report-page.ts";
import { loadScript } from "./lib/replay.ts";
import type { ReplayScript } from "./lib/replay.ts";

/** The binding `--judge` grades each game through (`evaluation/config.example.json`). */
const GAME_JUDGE_BINDING = "game-judge";

const TAG = "[play]";
const DEFAULT_GAMES = 1;
const DEFAULT_CONCURRENCY = 2;

const OPTIONS = {
  blueprint: { type: "string" },
  replay: { type: "string" },
  persona: { type: "string" },
  games: { type: "string" },
  concurrency: { type: "string" },
  "max-steps": { type: "string" },
  narrator: { type: "string" },
  "narrator-model": { type: "string" },
  judge: { type: "boolean" },
  port: { type: "string" },
} as const;

const HELP = formatHelp({
  usage: "play (--blueprint <x> | --replay <script.json>)",
  summary:
    "Self-play: an AI investigator plays whole games through the real server, on a throwaway database.\n" +
    "Each game is a subject with its result.json; the run gets report.html. Blueprints are looked up in the\n" +
    "repo's blueprints/ only; one generated elsewhere is named by its path.",
  options: [
    ["--blueprint <x>", "a blueprint id, file name, title, or path to a JSON file (with --replay: the script's blueprint)"],
    ["--replay <script.json>", "replay a recorded game's inputs; no investigator is called"],
    ["--persona <name>", `a file in personas/ (default: detective; not with --replay)`],
    ["--games <n>", `games to play (default: ${DEFAULT_GAMES})`],
    ["--concurrency <n>", `games at once (default: ${DEFAULT_CONCURRENCY})`],
    ["--max-steps <n>", `investigator inputs per game before giving up (default: ${DEFAULT_MAX_STEPS}; with --replay, the whole script)`],
    ["--narrator <claude|mock>", "the game's narrator (default: claude)"],
    ["--narrator-model <m>", "the model the claude narrator uses (default: sonnet)"],
    ["--judge", `grade each game with judge game, through the ${GAME_JUDGE_BINDING} binding (off by default)`],
    ["--port <n>", "the server's port (default: a free one)"],
  ],
});

interface PlayOptions {
  blueprint: string | null;
  replay: string | null;
  persona: string;
  games: number;
  concurrency: number;
  maxSteps: number | null;
  narrator: "claude" | "mock";
  narratorModel: string;
  judge: boolean;
  port: number | null;
}

function positiveInteger(flag: string, value: OptionValue, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new UsageError(`${flag} needs a positive integer`);
  return number;
}

function str(value: OptionValue): string | null {
  return typeof value === "string" ? value : null;
}

/** The options as typed, checked against each other. */
function readOptions({ common, values }: ParsedArgs): PlayOptions {
  const narrator = str(values.narrator) ?? "claude";
  if (narrator !== "claude" && narrator !== "mock") throw new UsageError("--narrator must be claude or mock");
  const options: PlayOptions = {
    blueprint: str(values.blueprint),
    replay: str(values.replay),
    persona: str(values.persona) ?? "detective",
    games: positiveInteger("--games", values.games, DEFAULT_GAMES) as number,
    concurrency: positiveInteger("--concurrency", values.concurrency, DEFAULT_CONCURRENCY) as number,
    maxSteps: positiveInteger("--max-steps", values["max-steps"], null),
    narrator,
    narratorModel: str(values["narrator-model"]) ?? "sonnet",
    judge: values.judge === true,
    port: positiveInteger("--port", values.port, null),
  };
  if (options.replay) {
    if (values.persona !== undefined) throw new UsageError("--replay takes its inputs from the script; drop --persona");
    if (INVESTIGATOR_BINDING in common.modelOverrides) {
      throw new UsageError(`--replay calls no investigator; drop --model-override ${INVESTIGATOR_BINDING}=...`);
    }
    return options;
  }
  if (!options.blueprint) throw new UsageError("--blueprint or --replay is required");
  if (!listPersonas().includes(options.persona)) {
    throw new UsageError(`Unknown persona "${options.persona}". Known: ${listPersonas().join(", ")}`);
  }
  return options;
}

/** A blueprint by path, or by id, file name or title among the repo's. */
function findBlueprint(query: string, repoBlueprints: string, hint: string): { file: string; blueprint: PlaytestBlueprint } {
  if (fs.existsSync(query) && fs.statSync(query).isFile()) {
    return { file: path.resolve(query), blueprint: JSON.parse(fs.readFileSync(query, "utf8")) };
  }
  const wanted = query.toLowerCase().replace(/\.json$/, "");
  const names = fs.existsSync(repoBlueprints) ? fs.readdirSync(repoBlueprints).filter((entry) => entry.endsWith(".json")) : [];
  for (const name of names) {
    const file = path.join(repoBlueprints, name);
    const blueprint = JSON.parse(fs.readFileSync(file, "utf8")) as PlaytestBlueprint;
    if (
      blueprint.id === query ||
      name.replace(/\.json$/, "").toLowerCase() === wanted ||
      blueprint.metadata?.title?.toLowerCase() === wanted
    ) {
      return { file, blueprint };
    }
  }
  throw new UsageError(`No blueprint matches "${query}" (looked for a file, and in ${repoBlueprints}).${hint}`);
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/** The environment the server narrates under. */
function narratorEnv(options: PlayOptions): Record<string, string> {
  if (options.narrator === "mock") {
    return {
      AI_PROVIDER: "mock",
      AI_MODEL: "mock/runtime-default",
      OPENROUTER_URL: "http://127.0.0.1:9/unreachable",
      CLAUDE_CLI_PATH: "/nonexistent/claude-cli-disabled-for-mock-narrator",
    };
  }
  return {
    AI_PROVIDER: "claude-cli",
    AI_MODEL: options.narratorModel,
    // Three attempts at 90s stay under the 300s a fetch waits for headers, so
    // a slow narrator turn fails as a turn instead of dropping the request.
    AI_CLAUDE_CLI_TIMEOUT_MS: "90000",
  };
}

/** What every game of one run shares. */
interface Play {
  root: string;
  context: EvalContext;
  options: PlayOptions;
  script: ReplayScript | null;
  scriptFile: string | null;
  persona: string;
  blueprint: PlaytestBlueprint;
  run: RunFolder;
  server: ThrowawayServer;
  callLogFile: string;
  investigatorBinding: ResolvedBinding | null;
  judgeArgs: string[];
  /** Games are graded one at a time, in the order they end, so at most four judge calls run at once however many games play. */
  grading: Promise<void>;
}

/** A game that was played, whatever came of it. */
interface PlayedRecord {
  kind: "played";
  number: number;
  folder: SubjectFolder;
  game: PlayedGame;
  summary: GameSummary;
  investigator: Investigator;
  /** Set once the game's trace is stored beside its result. */
  traceStored: boolean;
  grades: Grades | { error: string } | null;
  judgeResult: Result | null;
}

/** A game that could not be played at all (sign-in, game start). */
interface FailedRecord {
  kind: "failed";
  number: number;
  folder: SubjectFolder;
  message: string;
}

type GameRecord = PlayedRecord | FailedRecord;

function say(play: Play, number: number, text: string): void {
  play.context.out(`${TAG}[game ${number}] ${text}`);
}

function makeInvestigator(play: Play, logDir: string): Investigator | ScriptedInvestigator {
  const { script } = play;
  if (script) return scriptedInvestigator(script.inputs, { checkpoints: script.checkpoints, end: script.end });
  return modelInvestigator({ persona: play.persona, binding: play.investigatorBinding as ResolvedBinding, logDir });
}

/** Moves the investigator's logs, kept before the game had an id, into the game's own folder. */
function adoptLogs(from: string, folder: SubjectFolder): void {
  if (!fs.existsSync(from)) return;
  fs.mkdirSync(path.dirname(folder.logDir), { recursive: true });
  fs.renameSync(from, folder.logDir);
}

async function extractForGrading(play: Play, record: PlayedRecord): Promise<string | null> {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-playtest-grade-"));
  try {
    // A copy taken now: a consistent snapshot while the server is still writing.
    const database = path.join(scratch, "game.db");
    await copyDatabase(play.server.databaseFile, database);
    await extractTrace({
      repoRoot: play.root,
      database,
      gameId: record.game.gameId,
      gameDir: record.folder.dir,
      configRoot: play.server.configRoot,
      env: play.context.env,
    });
    record.traceStored = true;
    return null;
  } catch (error) {
    return (error as Error).message;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Grades one game whose trace is stored; a game that cannot be graded says why in its summary and transcript. */
async function gradeOne(play: Play, record: PlayedRecord, extractError: string | null): Promise<void> {
  const { number, folder, summary } = record;
  try {
    if (extractError) throw new Error(extractError);
    const { grades, result } = await gradeGame({
      gameDir: folder.dir,
      targetAge: play.blueprint.metadata.target_age as number,
      root: play.root,
      env: play.context.env,
      judgeArgs: play.judgeArgs,
    });
    record.grades = grades;
    record.judgeResult = result;
    const verdicts = Object.entries(grades.judges).map(([id, verdict]) => `${id} ${verdict.status}`);
    say(play, number, `graded: ${verdicts.join(", ") || "no judges"}; flesch ${grades.readability.pass}/${grades.readability.total}`);
  } catch (error) {
    record.grades = { error: (error as Error).message };
    play.context.err(`${TAG}[game ${number}] grading failed: ${(error as Error).message}`);
  }
  summary.grades = record.grades;
  fs.writeFileSync(path.join(folder.dir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  fs.appendFileSync(path.join(folder.dir, "transcript.md"), renderGrades(record.grades));
}

/** Extracts a game that has just ended and queues its grading behind the games already waiting. */
async function queueGrading(play: Play, record: PlayedRecord): Promise<void> {
  const extractError = await extractForGrading(play, record);
  play.grading = play.grading.then(() => gradeOne(play, record, extractError));
}

async function playOne(play: Play, number: number): Promise<GameRecord> {
  const started = Date.now();
  const logDir = path.join(play.run.dir, `.investigator-${number}`);
  let game: PlayedGame;
  let investigator: Investigator | ScriptedInvestigator;
  try {
    const api = await signIn(play.server.url, `playtest-${slugify(play.persona)}-${number}`);
    investigator = makeInvestigator(play, logDir);
    game = await playGame({
      api,
      blueprint: { id: play.blueprint.id, title: play.blueprint.metadata.title },
      investigator,
      // One step past the script, to compare where the game ended up.
      maxSteps: play.options.maxSteps ?? (play.script ? play.script.inputs.length + 1 : DEFAULT_MAX_STEPS),
      onStep: (step) =>
        say(play, number, `step ${step.step} (${step.mode_before}, ${step.time_before} left) > ${step.input}`),
    });
  } catch (error) {
    // The others carry on.
    const message = (error as Error).message;
    play.context.err(`${TAG}[game ${number}] failed: ${message}`);
    const folder = play.run.subject({ kind: "game", id: `game-${number}` });
    adoptLogs(logDir, folder);
    return { kind: "failed", number, folder, message };
  }

  const folder = play.run.subject({ kind: "game", id: game.gameId });
  adoptLogs(logDir, folder);
  const replay: ReplayInfo | null = play.script
    ? { of: path.relative(play.root, play.scriptFile as string), clueDrift: (investigator as ScriptedInvestigator).clueDrift }
    : null;
  const summary = writeGameFolder({
    dir: folder.dir,
    number,
    game,
    blueprint: play.blueprint,
    persona: play.persona,
    narratorModel: play.options.narrator === "mock" ? "mock" : play.options.narratorModel,
    investigatorModel: play.script ? "replay" : (play.investigatorBinding?.model ?? "unknown"),
    callLogFile: play.callLogFile,
    wallMs: Date.now() - started,
    replay,
    events: readPlayedEvents(play.server.databaseFile, game.gameId),
  });
  say(
    play,
    number,
    `${summary.outcome ?? summary.stop_reason}: ${summary.clues_found}/${summary.clues_total} clues, ${summary.turns_used}/${summary.time_budget} turns`,
  );
  const record: PlayedRecord = { kind: "played", number, folder, game, summary, investigator, traceStored: false, grades: null, judgeResult: null };
  if (play.options.judge) await queueGrading(play, record);
  return record;
}

/** Why a game's result says the run broke, or null when it ran to a stop. */
function gameRunError(record: GameRecord): RunError | null {
  if (record.kind === "failed") return { stage: "play", message: record.message };
  const { game, grades, judgeResult } = record;
  if (game.stopReason === "errors" || game.stopReason === "investigator-error") {
    return { stage: "play", message: game.error ?? game.stopReason };
  }
  if (grades && "error" in grades) return { stage: "judge", message: grades.error };
  return judgeResult?.run_error ?? null;
}

/** Writes a game's `result.json`: the verdicts of its grading, if it was graded, and the model calls that played it. */
async function writeGameResult(play: Play, record: GameRecord): Promise<void> {
  const runError = gameRunError(record);
  const verdicts = record.kind === "played" ? (record.judgeResult?.verdicts ?? []) : [];
  const calls = record.kind === "played" ? [...record.investigator.calls] : [];
  await writeResult(record.folder.resultFile, {
    schema_version: RESULT_SCHEMA_VERSION,
    run: play.run.info(),
    subject: {
      kind: "game",
      id: record.kind === "played" ? record.game.gameId : `game-${record.number}`,
      path: record.kind === "played" && record.traceStored ? "trace.json" : null,
    },
    production: calls.length > 0 ? { calls } : null,
    verdicts,
    summary: summarize(verdicts, runError),
    run_error: runError,
    timing: null,
  });
}

/** The options `judge game` is given from this run's own common ones. */
function judgeArgsFor(common: ParsedArgs["common"]): string[] {
  const args = common.configPath ? ["--config", common.configPath] : [];
  const model = common.modelOverrides[GAME_JUDGE_BINDING];
  if (model) args.push("--model-override", `${GAME_JUDGE_BINDING}=${model}`);
  return args;
}

/** The bindings this run calls, resolved before anything starts: one that cannot run is an error. */
function resolveBindings(parsed: ParsedArgs, options: PlayOptions, root: string): ResolvedBinding[] {
  const config = loadConfig({ root, configPath: parsed.common.configPath, modelOverrides: parsed.common.modelOverrides });
  const names = [...(options.replay ? [] : [INVESTIGATOR_BINDING]), ...(options.judge ? [GAME_JUDGE_BINDING] : [])];
  return names.map((name) => resolveBinding(config, name, { root }));
}

function describeRun(play: Play): string[] {
  const { options, script, persona, blueprint } = play;
  const narrator = options.narrator === "mock" ? "mock" : options.narratorModel;
  return [
    `${TAG} ${blueprint.metadata.title} as "${persona}", ${options.games} game(s)`,
    script
      ? `${TAG} narrator: ${narrator}; replaying ${script.inputs.length} inputs from ${path.relative(play.root, play.scriptFile as string)}`
      : `${TAG} narrator: ${narrator}; investigator: ${play.investigatorBinding?.model ?? "unknown"}`,
    ...(script && !script.checkpoints
      ? [`${TAG} warning: the script has no checkpoints, so the replay cannot tell when the game diverges.`]
      : []),
    `${TAG} run folder: ${play.run.dir}`,
  ];
}

/** Plays the run's games, grades them, and writes every game's result. */
async function playAll(play: Play): Promise<GameRecord[]> {
  const numbers = Array.from({ length: play.options.games }, (_, index) => index + 1);
  const records = await mapPool(numbers, play.options.concurrency, (number) => playOne(play, number));
  if (play.options.judge) {
    play.context.out(`${TAG} waiting for the last grades...`);
    await play.grading;
  }
  for (const record of records) await writeGameResult(play, record);
  return records;
}

async function runPlay(argv: string[], context: EvalContext, startServer: StartServer): Promise<number> {
  const parsed = parseCommandArgs(argv, { options: OPTIONS });
  const options = readOptions(parsed);
  const root = context.root;
  const scriptFile = options.replay ? path.resolve(options.replay) : null;
  let script: ReplayScript | null = null;
  if (scriptFile) {
    try {
      script = loadScript(scriptFile);
    } catch (error) {
      throw new InputError(`Cannot replay ${scriptFile}: ${(error as Error).message}`);
    }
  }
  const hint = script && !options.blueprint ? " A script played on a blueprint outside the repo needs --blueprint <path>." : "";
  const { file: blueprintFile, blueprint } = findBlueprint(
    options.blueprint ?? (script as ReplayScript).blueprintId,
    path.join(root, "blueprints"),
    hint,
  );
  if (script && blueprint.id !== script.blueprintId) {
    throw new UsageError(`The script was played on "${script.blueprintId}", not "${blueprint.id}".`);
  }
  const bindings = resolveBindings(parsed, options, root);

  const run = createRunFolder({
    outputRoot: resolveOutputRoot(parsed.common.outputRoot, context.env),
    command: "play",
    argv,
    root,
    bindings,
  });
  const callLogFile = path.join(run.dir, "ai-calls.all.jsonl");
  const server = await startServer({
    repoRoot: root,
    port: options.port ?? (await freePort()),
    env: { ...narratorEnv(options), AI_CALL_LOG: callLogFile },
  });

  const play: Play = {
    root,
    context,
    options,
    script,
    scriptFile,
    persona: script ? script.persona : options.persona,
    blueprint,
    run,
    server,
    callLogFile,
    investigatorBinding: bindings.find((binding) => binding.name === INVESTIGATOR_BINDING) ?? null,
    judgeArgs: judgeArgsFor(parsed.common),
    grading: Promise.resolve(),
  };
  for (const line of describeRun(play)) context.out(line);

  try {
    // A blueprint from outside the repo is dropped into the throwaway config
    // root; the server re-reads its blueprint folders on each request.
    if (path.dirname(blueprintFile) !== path.join(root, "blueprints")) {
      const dir = path.join(server.configRoot, "blueprints");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(blueprintFile, path.join(dir, path.basename(blueprintFile)));
    }
    await playAll(play);
  } finally {
    try {
      // Kept: a game can be graded or inspected later with
      // `./dev eval judge game <game id> --database <run>/game.db`.
      if (fs.existsSync(server.databaseFile)) await copyDatabase(server.databaseFile, path.join(run.dir, "game.db"));
    } finally {
      await server.stop();
    }
  }

  const index = await run.finish();
  try {
    context.out(`${TAG} report: ${await writeReport(run.dir, { repoRoot: root })}`);
  } catch (error) {
    // The games and their files are already written; only the page is missing.
    context.err(`${TAG} could not write the report: ${(error as Error).message}`);
  }
  context.out(`${TAG} run folder: ${run.dir}`);
  return index.exit_code;
}

export function createPlayCommand({ startServer = startThrowawayServer }: { startServer?: StartServer } = {}): EvalCommand {
  return {
    name: "play",
    summary: "Self-play: an AI investigator plays whole games through the real server (or replays a recorded game)",
    help: HELP,
    run: (argv, context) => runPlay(argv, context, startServer),
  };
}

export const playCommand = createPlayCommand();
