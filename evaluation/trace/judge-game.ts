/**
 * `./dev eval judge game <session id or trace file>`: judges how well the AI
 * game master played one game.
 *
 * Given a session id it extracts the game from the play database, read-only,
 * and stores the trace beside the result. Given a trace file (a stored one, or
 * one extracted earlier) it judges that again. Either way it rebuilds what the
 * game master saw each turn, runs the mechanical checks, and runs the registry's
 * `game` judges through the model runner on the `game-judge` binding, then writes
 * `result.json` and exits by the core rule (`exitCodeFor` in `core/result.ts`).
 *
 * An argument that names a file is a trace; one that does not, and does not look
 * like a path (no separator, no `.json`), is a session id. A path to nothing is
 * an error rather than a session id nobody has.
 *
 * Several arguments, `--bundle <folder>` (every game in a playtest bundle, with
 * its call log) or `--since <date>` (every game in `--database` started on or
 * after it) judge a batch: one parent run, written as `play --judge` writes
 * its own, with a child run per game, which is the run a single game writes.
 * Each game's model calls are joined to its events by `request_id`.
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue, ParsedArgs } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import { runEval } from "../core/dispatch.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { UsageError, UsageLimitError } from "../core/errors.ts";
import { loadCheck, loadJudge } from "../core/judge-loader.ts";
import { validateJudgeOutput } from "../core/judge-output.ts";
import { composeJudgeSystemPrompt, composeJudgeUserMessage } from "../core/judge-prompt.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { checksFor, judgesFor } from "../core/registry.ts";
import type { JudgeEntry } from "../core/registry.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { runIdentity } from "../core/run-identity.ts";
import type { SubjectFolder } from "../core/run-folder.ts";
import { runModel } from "../core/runner.ts";
import type { CallMemo } from "../core/runner.ts";
import { RESULT_SCHEMA_VERSION, exitCodeFor, readResult, summarize, writeResult } from "../core/result.ts";
import { bindingLabel, contentHash } from "../core/suite-attributes.ts";
import type { ModelCall, Result, RunError, Verdict } from "../core/result.ts";
import { judgedCase, majorFindingsVerdict } from "../judges/index.ts";
import { projectTraceSubject } from "../judges/subject.ts";
import { joinedTo, modelCallFromLine, readAICallLog } from "../lib/game-ai-calls.ts";
import { findChildResult, pickGames } from "./judge-batch.ts";
import type { PickedGames } from "./judge-batch.ts";
import { createLocalTraceSource, extractSessionTrace } from "./lib/datasource.ts";
import type { TraceCheckResult } from "./lib/mechanical.ts";
import { runTraceMechanicalChecks } from "./lib/mechanical.ts";
import { assertRawTrace } from "./lib/normalize.ts";
import type { RawTrace } from "./lib/normalize.ts";
import { reconstructTrace } from "./lib/reconstruct.ts";

/** The binding every game judge is called through. */
export const GAME_JUDGE_BINDING = "game-judge";

const TAG = "[judge game]";
const STORED_TRACE = "trace.json";

type Subject = { kind: "file"; path: string } | { kind: "session"; id: string };

/** Whether the argument is a trace file or a session id; see the file's header. */
export function locateSubject(arg: string): Subject {
  const resolved = path.resolve(arg);
  if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return { kind: "file", path: resolved };
  if (/[\\/]/.test(arg) || arg.endsWith(".json")) throw new UsageError(`no trace file at ${resolved}`);
  return { kind: "session", id: arg };
}

/** Games judged at once in a batch: each runs its judges in parallel, so this many times the judge calls. */
const DEFAULT_CONCURRENCY = 2;

const OPTIONS = {
  database: { type: "string" },
  bundle: { type: "string" },
  since: { type: "string" },
  concurrency: { type: "string" },
  judges: { type: "string" },
  "no-judges": { type: "boolean" },
  quiet: { type: "boolean" },
  "parent-run": { type: "string" },
} as const;

const HELP = formatHelp({
  usage: "judge game <session id or trace file>... | --bundle <folder> | --since <date>",
  summary:
    "Judges how well the game master played a game: the mechanical checks, then the gm_* judges.\n" +
    "A session id is extracted from the play database, read-only, and its trace stored beside the result.\n" +
    "A trace file (a stored one, say) is judged again.\n" +
    "Several of them, --bundle or --since judge a batch: one parent run with a child run per game.",
  options: [
    ["--database <file>", "the database to read session ids from (default: this checkout's play database); with --since, a name or a file"],
    ["--bundle <folder>", "every game in <folder>/game.db, with <folder>/ai-calls.jsonl as the call log when present"],
    ["--since <date>", "every game in --database started on or after YYYY-MM-DD (UTC) or a full timestamp"],
    ["--concurrency <n>", `games judged at once; a batch only (default: ${DEFAULT_CONCURRENCY})`],
    ["--judges <id,id>", "run only these judges, or candidate judges, which run only when named; the rest are skipped"],
    ["--no-judges", "run the mechanical checks only; no model is called"],
    ["--quiet", "no live progress while the judges run"],
    ["--parent-run <id>", "the run this one grades games for, recorded as parent_run (set by play --judge and by a batch)"],
  ],
});

/** `--parent-run`: the id of the run this one belongs to; null when not given. */
function parentRunOf(values: Record<string, OptionValue>): string | null {
  const parent = values["parent-run"];
  if (parent === undefined) return null;
  if (typeof parent !== "string" || parent.trim() === "") throw new UsageError("--parent-run needs a run id");
  return parent.trim();
}

/** The judges this run asks, from `--judges` and `--no-judges`, and the reason for those it leaves out. */
function selectJudges(values: Record<string, OptionValue>): { run: JudgeEntry[]; leftOut: Map<string, string> } {
  const all = judgesFor("game");
  // A candidate may be named, but one that is not is left out of the result, not skipped.
  const nameable = judgesFor("game", { candidates: true });
  const leftOut = new Map<string, string>();
  if (values["no-judges"] === true) {
    if (values.judges !== undefined) throw new UsageError("--judges and --no-judges contradict each other");
    for (const entry of all) leftOut.set(entry.id, "--no-judges");
    return { run: [], leftOut };
  }
  if (typeof values.judges !== "string") return { run: all, leftOut };
  const wanted = values.judges.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !nameable.some((entry) => entry.id === id));
  if (wanted.length === 0 || unknown.length > 0) {
    throw new UsageError(
      `--judges takes game judge ids from: ${nameable.map((entry) => entry.id).join(", ")}` +
        (unknown.length > 0 ? ` (not: ${unknown.join(", ")})` : ""),
    );
  }
  for (const entry of all) if (!wanted.includes(entry.id)) leftOut.set(entry.id, "not named by --judges");
  return { run: nameable.filter((entry) => wanted.includes(entry.id)), leftOut };
}

interface StageTiming {
  name: string;
  duration_ms: number;
  failed?: boolean;
  detail?: Record<string, unknown>;
}

/** Times the stages of one run, and remembers which one broke it. */
class StageClock {
  readonly stages: StageTiming[] = [];
  failedStage: string | null = null;
  private readonly startedAt = performance.now();

  async stage<T>(name: string, work: () => T | Promise<T>, detail?: (value: T) => Record<string, unknown>): Promise<T> {
    const stageStartedAt = performance.now();
    try {
      const value = await work();
      this.stages.push({
        name,
        duration_ms: Math.round(performance.now() - stageStartedAt),
        ...(detail ? { detail: detail(value) } : {}),
      });
      return value;
    } catch (error) {
      this.stages.push({ name, duration_ms: Math.round(performance.now() - stageStartedAt), failed: true });
      this.failedStage ??= name;
      throw error;
    }
  }

  totalMs(): number {
    return Math.round(performance.now() - this.startedAt);
  }
}

interface Acquired {
  /** The game's id: the session id, else the one in the trace, else the file's name. */
  id: string;
  trace: RawTrace | null;
  error: RunError | null;
}

function brokeWith(stage: string, error: unknown): RunError {
  return { stage, message: String((error as Error)?.message ?? error) };
}

/** Reads the trace file or extracts the session. Either may fail, and the run still writes a result. */
async function acquire(
  subject: Subject,
  options: { database: string | undefined; context: EvalContext },
  clock: StageClock,
): Promise<Acquired> {
  if (subject.kind === "file") {
    const fallbackId = path.basename(subject.path, path.extname(subject.path));
    try {
      const trace = await clock.stage("load_trace", () =>
        assertRawTrace(JSON.parse(fs.readFileSync(subject.path, "utf8"))),
      );
      return { id: trace.session.id ?? fallbackId, trace, error: null };
    } catch (error) {
      return { id: fallbackId, trace: null, error: brokeWith("load_trace", error) };
    }
  }
  try {
    const trace = await clock.stage("extract", async () => {
      const source = createLocalTraceSource({
        databasePath: options.database ?? null,
        repoRoot: options.context.root,
        env: options.context.env,
      });
      try {
        return await extractSessionTrace(source, subject.id);
      } finally {
        source.close?.();
      }
    });
    return { id: subject.id, trace, error: null };
  } catch (error) {
    return { id: subject.id, trace: null, error: brokeWith("extract", error) };
  }
}

/** The mechanical checks the registry lists for a game, run once through the function they share. */
async function runMechanical(trace: RawTrace): Promise<Verdict[]> {
  const entries = checksFor("game");
  const context: Record<string, unknown> = Object.assign({}, ...entries.map((entry) => entry.context ?? {}));
  const run = (await loadCheck(entries[0].id)) as typeof runTraceMechanicalChecks;
  const results: TraceCheckResult[] = run({
    rawTrace: trace,
    context: Object.keys(context).length > 0 ? context : null,
  });
  return results.map((result) => ({ id: result.id, tier: "mechanical", status: result.status, details: result.details }));
}

export interface JudgeRun {
  binding: ResolvedBinding;
  trace: RawTrace;
  /** The subject the judges read, from the reconstructed turns. */
  judgeSubject: unknown;
  logDir: string;
  /** Finished judge calls to answer from (`CallMemo` in `core/runner.ts`). */
  memo?: CallMemo;
}

/**
 * What every game judge of one stored game reads: the trace, checked, and
 * the subject projected from its reconstructed turns. Throws when the trace
 * is not one `judge game` reads.
 */
export function prepareGameJudging(trace: unknown): Pick<JudgeRun, "trace" | "judgeSubject"> {
  const raw = assertRawTrace(trace);
  return { trace: raw, judgeSubject: projectTraceSubject(reconstructTrace(raw).turns) };
}

/**
 * A game judge's user message: the case itself, without a case age, and the
 * subject, whose every turn carries the age it was narrated at. Exported for tests and for anyone wanting to
 * see exactly what a judge is handed.
 */
export function buildGameJudgeUserMessage(
  id: string,
  context: Record<string, unknown> | null,
  run: Pick<JudgeRun, "trace" | "judgeSubject">,
): string {
  return composeJudgeUserMessage(id, context, { blueprint: judgedCase(run.trace.blueprint), subject: run.judgeSubject });
}

/** One game judge: its prompt, one model call, and the verdict its rule reaches. */
export async function judgeOne(entry: JudgeEntry, run: JudgeRun): Promise<{ verdict: Verdict; ms: number }> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const definition = await loadJudge(entry);
    const context = entry.context ? structuredClone(entry.context) : null;
    const outcome = await runModel({
      binding: run.binding,
      step: `judge-${entry.id}`,
      systemPrompt: composeJudgeSystemPrompt(definition, context as Record<string, unknown> | null),
      userMessage: buildGameJudgeUserMessage(entry.id, context as Record<string, unknown> | null, run),
      logDir: run.logDir,
      memo: run.memo,
      parse: (answer) => {
        let parsed: unknown = null;
        try {
          parsed = JSON.parse(answer);
        } catch {
          // Not JSON: the shape check below says so.
        }
        const shape = validateJudgeOutput(parsed, definition.schema);
        if (!shape.ok) throw new Error(shape.message);
        return shape.data as Record<string, unknown>;
      },
    });
    if (!outcome.ok) {
      return { verdict: { id: entry.id, tier: "judge", status: "error", reason: outcome.error, call: outcome.call }, ms: elapsed() };
    }
    const data = outcome.value;
    return {
      verdict: {
        id: entry.id,
        tier: "judge",
        // A judge fails iff it reported a major finding; the model's own verdict
        // is kept, and a disagreement is shown rather than hidden.
        ...majorFindingsVerdict(data),
        call: outcome.call,
        answer: data,
      },
      ms: elapsed(),
    };
  } catch (error) {
    if (error instanceof UsageLimitError) throw error;
    return {
      verdict: { id: entry.id, tier: "judge", status: "error", reason: String((error as Error)?.message ?? error) },
      ms: elapsed(),
    };
  }
}

function describeJudge(verdict: Verdict, ms: number): string {
  const details = (verdict.details ?? {}) as Record<string, unknown>;
  const counts = verdict.status === "error" ? ` — ${verdict.reason}` : ` — ${details.major_count} major, ${details.minor_count} minor`;
  const disagreed = details.verdict_disagreement ? ` (model said ${details.model_verdict})` : "";
  return `${TAG}[${verdict.id}] ${verdict.status}${disagreed}${counts} (${formatDuration(ms)})`;
}

async function runJudges(
  entries: readonly JudgeEntry[],
  run: JudgeRun,
  { quiet, context }: { quiet: boolean; context: EvalContext },
  clock: StageClock,
): Promise<Array<{ verdict: Verdict; ms: number }>> {
  context.out(`${TAG} judges: ${entries.length} started in parallel`);
  const steps = entries.map((entry) => `judge-${entry.id}`);
  const digest = startDigest("judging", steps, { logDir: run.logDir, tag: TAG, quiet, write: context.out });
  try {
    return await clock.stage(
      "judges",
      () =>
        mapPool(entries, entries.length, async (entry) => {
          const judged = await judgeOne(entry, run);
          digest.markDone(`judge-${entry.id}`);
          context.out(describeJudge(judged.verdict, judged.ms));
          return judged;
        }),
      (judged) => ({ count: judged.length, parallel: true }),
    );
  } finally {
    digest.stop();
  }
}

interface Judged {
  verdicts: Verdict[];
  judgeTimes: Array<{ id: string; ms: number }>;
}

/** A trace's content, for its hash: everything but when and where it was extracted, which a second extraction of the same game changes. */
export function traceContent(trace: RawTrace): unknown {
  const content: Partial<RawTrace> = { ...trace };
  delete content.extracted_at;
  delete content.source;
  return content;
}

/** Everything done to an acquired trace: reconstruct it, check it, judge it. */
async function judgeTrace(
  trace: RawTrace,
  folder: SubjectFolder,
  plan: { selection: ReturnType<typeof selectJudges>; binding: ResolvedBinding | null; quiet: boolean },
  context: EvalContext,
  clock: StageClock,
): Promise<Judged> {
  const reconstructed = await clock.stage(
    "reconstruct",
    () => reconstructTrace(trace),
    (r) => ({ turns: r.turns.length, issues: r.issues.length }),
  );
  fs.writeFileSync(path.join(folder.dir, "reconstruction.json"), `${JSON.stringify(reconstructed, null, 2)}\n`);
  if (reconstructed.issues.length > 0) {
    context.out(`${TAG} reconstruction: ${reconstructed.issues.length} turn(s) with context errors`);
  }

  const mechanical = await clock.stage("mechanical", () => runMechanical(trace), (v) => ({ checks: v.length }));
  const failed = mechanical.filter((verdict) => verdict.status === "fail").length;
  context.out(`${TAG} mechanical: ${mechanical.length - failed}/${mechanical.length} passed`);

  const skipped: Verdict[] = [...plan.selection.leftOut].map(([id, reason]) => ({
    id,
    tier: "judge",
    status: "skipped",
    reason,
  }));
  if (!plan.binding || plan.selection.run.length === 0) return { verdicts: [...mechanical, ...skipped], judgeTimes: [] };

  const run: JudgeRun = {
    binding: plan.binding,
    trace,
    judgeSubject: projectTraceSubject(reconstructed.turns),
    logDir: folder.logDir,
  };
  const judged = await runJudges(plan.selection.run, run, { quiet: plan.quiet, context }, clock);
  return {
    verdicts: [...mechanical, ...judged.map((entry) => entry.verdict), ...skipped],
    judgeTimes: judged.map((entry) => ({ id: entry.verdict.id, ms: entry.ms })),
  };
}

/** The options a child run is given from the batch's own: what to judge with, and this run as its parent. */
function childArgsFor(parsed: ParsedArgs, parentRun: string): string[] {
  const { common, values } = parsed;
  const args = common.configPath ? ["--config", common.configPath] : [];
  if (common.suite) args.push("--suite", common.suite);
  if (common.label) args.push("--label", common.label);
  for (const [binding, model] of Object.entries(common.modelOverrides)) args.push("--model-override", `${binding}=${model}`);
  if (typeof values.judges === "string") args.push("--judges", values.judges);
  if (values["no-judges"] === true) args.push("--no-judges");
  args.push("--parent-run", parentRun);
  return args;
}

/** A positive integer option, else the default. */
function concurrencyOf(values: Record<string, OptionValue>): number {
  if (values.concurrency === undefined) return DEFAULT_CONCURRENCY;
  const number = Number(values.concurrency);
  if (!Number.isInteger(number) || number < 1) throw new UsageError("--concurrency needs a positive integer");
  return number;
}

/** The subjects of a batch: the games picked, else each argument, each once. */
function batchSubjects(picked: PickedGames | null, positionals: readonly string[]): Subject[] {
  if (picked) return picked.ids.map((id): Subject => ({ kind: "session", id }));
  return [...new Set(positionals)].map(locateSubject);
}

/**
 * The model calls the game's events joined to in the call log, and the lines
 * themselves, kept beside the game's trace as `ai-calls.jsonl`. A log that
 * cannot be read costs the game its calls, not its verdicts.
 */
function joinCalls(callLog: string | null, trace: RawTrace | null, folder: SubjectFolder): { calls: ModelCall[]; error: RunError | null } {
  if (callLog === null || trace === null) return { calls: [], error: null };
  try {
    const lines = readAICallLog(callLog, joinedTo(trace.events));
    if (lines.length > 0) {
      fs.writeFileSync(path.join(folder.dir, "ai-calls.jsonl"), lines.map((line) => `${JSON.stringify(line)}\n`).join(""));
    }
    return { calls: lines.map((line) => modelCallFromLine(line)), error: null };
  } catch (error) {
    return { calls: [], error: brokeWith("model_calls", error) };
  }
}

/** What one game of a batch came to: its child run's result, the calls joined to it, and what broke, most serious first. */
interface BatchGame {
  child: Result | null;
  calls: ModelCall[];
  errors: RunError[];
}

/**
 * Runs the child `judge game` on one game's stored trace and joins its calls.
 * Whatever goes wrong with this game is returned as an error, never thrown, so
 * the other games finish.
 */
async function judgeBatchGame(
  game: Acquired,
  folder: SubjectFolder,
  { childArgs, callLog, context }: { childArgs: string[]; callLog: string | null; context: EvalContext },
): Promise<BatchGame> {
  const errors: RunError[] = game.error ? [game.error] : [];
  let child: Result | null = null;
  try {
    if (game.trace) {
      const logFile = path.join(folder.dir, "judge.log");
      const write = (text: string) => fs.appendFileSync(logFile, `${text}\n`);
      fs.writeFileSync(path.join(folder.dir, STORED_TRACE), `${JSON.stringify(game.trace, null, 2)}\n`);
      const judgeRoot = path.join(folder.dir, "judge");
      const exitCode = await runEval(
        ["judge", "game", path.join(folder.dir, STORED_TRACE), "--output-root", judgeRoot, "--quiet", ...childArgs],
        { root: context.root, env: context.env, out: write, err: write },
        [judgeGame],
      );
      const resultFile = findChildResult(judgeRoot);
      child = resultFile ? await readResult(resultFile) : null;
      if (!child) errors.push({ stage: "judge", message: `judge game exited ${exitCode} and wrote no result.json; see ${logFile}` });
      else if (child.run_error) errors.push(child.run_error);
    }
  } catch (error) {
    errors.push(brokeWith("judge", error));
  }
  const joined = joinCalls(callLog, game.trace, folder);
  if (joined.error) errors.push(joined.error);
  return { child, calls: joined.calls, errors };
}

/**
 * Judges a batch of games: one parent run with a subject per game, as `play --judge`
 * writes, and for each game a child run, the one `judge game` writes for it alone,
 * in the game's `judge/` folder with this run as its parent. A game that cannot be
 * read, or whose child breaks, is reported on its own result and the others finish.
 */
async function runJudgeBatch(
  argv: string[],
  parsed: ParsedArgs,
  picked: PickedGames | null,
  concurrency: number,
  context: EvalContext,
): Promise<number> {
  const { common, values, positionals } = parsed;
  const database = picked?.database ?? (typeof values.database === "string" ? values.database : undefined);
  const subjects = batchSubjects(picked, positionals);
  if (database && !picked && subjects.some((subject) => subject.kind === "file")) {
    throw new UsageError("--database names where to read session ids from; a trace file needs no database");
  }
  const selection = selectJudges(values);
  const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
  const binding = selection.run.length > 0 ? resolveBinding(config, GAME_JUDGE_BINDING, { root: context.root }) : null;
  if (subjects.length === 0) {
    context.err(`${TAG} no games ${picked?.where ?? ""}`.trimEnd());
    return exitCodeFor([]);
  }

  const acquired: Acquired[] = [];
  for (const subject of subjects) acquired.push(await acquire(subject, { database, context }, new StageClock()));
  const clock = new StageClock();
  const run = createRunFolder({
    outputRoot: resolveOutputRoot(common.outputRoot, context.env),
    command: "judge game",
    argv,
    root: context.root,
    identity: runIdentity(common, context.root, parentRunOf(values)),
    bindings: binding ? [binding] : [],
    attributes: {
      options: {},
      inputs: acquired.map((game) => ({ id: game.id, hash: game.trace ? contentHash(traceContent(game.trace)) : null })),
      judges: selection.run.map((entry) => entry.id),
      models: { judge: binding ? [bindingLabel(binding)] : [] },
      samples: null,
      concurrency,
    },
  });
  const folders = acquired.map((game) => run.subject({ kind: "game", id: game.id }));
  const childArgs = childArgsFor(parsed, run.info().id);
  context.out(`${TAG} run folder: ${run.dir}`);
  context.out(`${TAG} ${acquired.length} game(s), ${concurrency} at a time`);

  await mapPool(acquired, concurrency, async (game, index) => {
    const folder = folders[index];
    const startedAt = performance.now();
    const judged = await judgeBatchGame(game, folder, { childArgs, callLog: picked?.callLog ?? null, context });
    const verdicts = judged.child?.verdicts ?? [];
    // A result holds one run error: the game's own, else the call log's. Each is reported once.
    const runError = judged.errors[0] ?? null;
    for (const error of judged.errors) context.err(`${TAG}[${game.id}] error: ${error.message}`);
    await writeResult(folder.resultFile, {
      schema_version: RESULT_SCHEMA_VERSION,
      run: run.info(),
      subject: { kind: "game", id: game.id, path: game.trace ? STORED_TRACE : null },
      production: judged.calls.length > 0 ? { calls: judged.calls } : null,
      verdicts,
      summary: summarize(verdicts, runError),
      run_error: runError,
      timing: judged.child?.timing ?? null,
    });
    const { counts } = summarize(verdicts, runError);
    context.out(
      `${TAG}[${game.id}] ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error, ${counts.skipped} skipped` +
        `, ${judged.calls.length} model call(s) (${formatDuration(Math.round(performance.now() - startedAt))})`,
    );
  });

  const index = await run.finish();
  const total = index.subjects.length;
  const passed = index.subjects.filter((subject) => subject.summary.passed).length;
  context.out(`${TAG} ${passed}/${total} game(s) passed (${formatDuration(clock.totalMs())})`);
  context.out(`${TAG} run folder: ${run.dir}`);
  return index.exit_code;
}


async function runJudgeGame(argv: string[], context: EvalContext): Promise<number> {
  const parsed = parseCommandArgs(argv, { options: OPTIONS, positionals: { min: 0, max: Infinity } });
  const { common, values, positionals } = parsed;
  const concurrency = concurrencyOf(values);
  const picked = await pickGames(values, positionals, context);
  if (picked || positionals.length > 1) return runJudgeBatch(argv, parsed, picked, concurrency, context);
  if (positionals.length === 0) throw new UsageError("name a session id or trace file, or pick games with --bundle or --since");
  const subject = locateSubject(positionals[0]);
  const database = typeof values.database === "string" ? values.database : undefined;
  if (database && subject.kind === "file") {
    throw new UsageError("--database names where to read a session id from; a trace file needs no database");
  }
  const selection = selectJudges(values);
  // Resolved before anything is read or written: a binding that cannot run is an error, not a skipped judge.
  const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
  const binding = selection.run.length > 0 ? resolveBinding(config, GAME_JUDGE_BINDING, { root: context.root }) : null;

  const clock = new StageClock();
  const acquired = await acquire(subject, { database, context }, clock);
  const run = createRunFolder({
    outputRoot: resolveOutputRoot(common.outputRoot, context.env),
    command: "judge game",
    argv,
    root: context.root,
    identity: runIdentity(common, context.root, parentRunOf(values)),
    bindings: binding ? [binding] : [],
    attributes: {
      // `--database` says only where the game is read from; its trace's hash is what was judged.
      options: {},
      inputs: [{ id: acquired.id, hash: acquired.trace ? contentHash(traceContent(acquired.trace)) : null }],
      judges: selection.run.map((entry) => entry.id),
      models: { judge: binding ? [bindingLabel(binding)] : [] },
      samples: null,
      concurrency: null,
    },
  });
  const folder = run.subject({ kind: "game", id: acquired.id });
  context.out(`${TAG} run folder: ${run.dir}`);

  let verdicts: Verdict[] = [];
  let runError = acquired.error;
  let judgeTimes: Judged["judgeTimes"] = [];
  if (acquired.trace) {
    fs.mkdirSync(folder.dir, { recursive: true });
    fs.writeFileSync(path.join(folder.dir, STORED_TRACE), `${JSON.stringify(acquired.trace, null, 2)}\n`);
    try {
      ({ verdicts, judgeTimes } = await judgeTrace(
        acquired.trace,
        folder,
        { selection, binding, quiet: values.quiet === true },
        context,
        clock,
      ));
    } catch (error) {
      runError = brokeWith(clock.failedStage ?? "unknown", error);
      context.err(`${TAG} error: ${runError.message}`);
    }
  } else if (acquired.error) {
    context.err(`${TAG} error: ${acquired.error.message}`);
  }

  const result = await writeResult(folder.resultFile, {
    schema_version: RESULT_SCHEMA_VERSION,
    run: run.info(),
    subject: { kind: "game", id: acquired.id, path: acquired.trace ? STORED_TRACE : null },
    production: null,
    verdicts,
    summary: summarize(verdicts, runError),
    run_error: runError,
    timing: {
      total_ms: clock.totalMs(),
      stages: clock.stages,
      dimensions: judgeTimes.map((entry) => ({
        id: entry.id,
        duration_ms: entry.ms,
        steps: [{ name: "judge", duration_ms: entry.ms }],
      })),
    },
  });
  const index = await run.finish();
  const { counts } = result.summary;
  context.out(`${TAG} result: ${folder.resultFile}`);
  context.out(
    `${TAG} summary: ${counts.pass} pass, ${counts.fail} fail, ${counts.error} error, ${counts.skipped} skipped` +
      ` (${formatDuration(clock.totalMs())})`,
  );
  return index.exit_code;
}

export const judgeGame: EvalCommand = {
  name: "judge game",
  summary: "Judge played games: the mechanical checks and the gm_* judges (session ids, trace files, a --bundle or --since)",
  help: HELP,
  run: runJudgeGame,
};
