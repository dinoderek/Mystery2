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
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { loadCheck, loadJudge } from "../core/judge-loader.ts";
import { validateJudgeOutput } from "../core/judge-output.ts";
import { composeJudgeSystemPrompt, composeJudgeUserMessage } from "../core/judge-prompt.ts";
import { mapPool } from "../core/pool.ts";
import { formatDuration, startDigest } from "../core/progress.ts";
import { checksFor, judgesFor } from "../core/registry.ts";
import type { JudgeEntry } from "../core/registry.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import type { SubjectFolder } from "../core/run-folder.ts";
import { runModel } from "../core/runner.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult } from "../core/result.ts";
import type { RunError, Verdict } from "../core/result.ts";
import { resolveVerdict } from "../judges/index.ts";
import { projectTraceSubject } from "../judges/subject.ts";
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

const OPTIONS = {
  database: { type: "string" },
  judges: { type: "string" },
  "no-judges": { type: "boolean" },
  quiet: { type: "boolean" },
} as const;

const HELP = formatHelp({
  usage: "judge game <session id or trace file>",
  summary:
    "Judges how well the game master played one game: the mechanical checks, then the gm_* judges.\n" +
    "A session id is extracted from the play database, read-only, and its trace stored beside the result.\n" +
    "A trace file (a stored one, say) is judged again.",
  options: [
    ["--database <file>", "the database to read a session from (default: this checkout's play database)"],
    ["--judges <id,id>", "run only these judges; the rest are skipped"],
    ["--no-judges", "run the mechanical checks only; no model is called"],
    ["--quiet", "no live progress while the judges run"],
  ],
});

/** The judges this run asks, from `--judges` and `--no-judges`, and the reason for those it leaves out. */
function selectJudges(values: Record<string, OptionValue>): { run: JudgeEntry[]; leftOut: Map<string, string> } {
  const all = judgesFor("game");
  const leftOut = new Map<string, string>();
  if (values["no-judges"] === true) {
    if (values.judges !== undefined) throw new UsageError("--judges and --no-judges contradict each other");
    for (const entry of all) leftOut.set(entry.id, "--no-judges");
    return { run: [], leftOut };
  }
  if (typeof values.judges !== "string") return { run: all, leftOut };
  const wanted = values.judges.split(",").map((id) => id.trim()).filter(Boolean);
  const unknown = wanted.filter((id) => !all.some((entry) => entry.id === id));
  if (wanted.length === 0 || unknown.length > 0) {
    throw new UsageError(
      `--judges takes game judge ids from: ${all.map((entry) => entry.id).join(", ")}` +
        (unknown.length > 0 ? ` (not: ${unknown.join(", ")})` : ""),
    );
  }
  for (const entry of all) if (!wanted.includes(entry.id)) leftOut.set(entry.id, "not named by --judges");
  return { run: all.filter((entry) => wanted.includes(entry.id)), leftOut };
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

interface JudgeRun {
  binding: ResolvedBinding;
  trace: RawTrace;
  /** The subject the judges read, from the reconstructed turns. */
  judgeSubject: unknown;
  logDir: string;
}

/** One game judge: its prompt, one model call, and the verdict its rule reaches. */
async function judgeOne(entry: JudgeEntry, run: JudgeRun): Promise<{ verdict: Verdict; ms: number }> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  try {
    const definition = await loadJudge(entry);
    const context = entry.context ? structuredClone(entry.context) : null;
    const outcome = await runModel({
      binding: run.binding,
      step: `judge-${entry.id}`,
      systemPrompt: composeJudgeSystemPrompt(definition, context as Record<string, unknown> | null),
      userMessage: composeJudgeUserMessage(entry.id, context as Record<string, unknown> | null, {
        blueprint: run.trace.blueprint,
        subject: run.judgeSubject,
      }),
      logDir: run.logDir,
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
    const resolved = resolveVerdict(data);
    return {
      verdict: {
        id: entry.id,
        tier: "judge",
        status: resolved.status,
        findings: Array.isArray(data.findings) ? data.findings : [],
        // A judge fails iff it reported a major finding; the model's own verdict
        // is kept, and a disagreement is shown rather than hidden.
        details: {
          reasoning: data.reasoning ?? "",
          major_count: resolved.major_count,
          minor_count: resolved.minor_count,
          model_verdict: resolved.model_verdict,
          verdict_disagreement: resolved.verdict_disagreement,
        },
        call: outcome.call,
        answer: data,
      },
      ms: elapsed(),
    };
  } catch (error) {
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

async function runJudgeGame(argv: string[], context: EvalContext): Promise<number> {
  const { common, values, positionals } = parseCommandArgs(argv, {
    options: OPTIONS,
    positionals: { min: 1, max: 1 },
  });
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
    bindings: binding ? [binding] : [],
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
  summary: "Judge a played game: the mechanical checks and the gm_* judges (a session id or a trace file)",
  help: HELP,
  run: runJudgeGame,
};
