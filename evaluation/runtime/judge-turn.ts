/**
 * `judge turn <cases or stored turn>...`: replays one turn per case and judges
 * it, or judges a stored turn again without replaying.
 *
 * A case names a fixed prior state and one action. Who narrates is the
 * `--narrator` flag, else the case's `narrator`, else the game server:
 *
 * - a narrator binding (`narrator-claude`, `narrator-openai`, `narrator-stub`):
 *   a model called straight through the runner, no server and no database. This
 *   is the documented way to grade a model.
 * - `server`: a throwaway server on a temporary config root, with the case's
 *   history seeded into its database (`lib/replay-server.ts`). `--ai-profile`
 *   names the profile it is asked for.
 *
 * Every (case, narrator) is one subject: its stored turn (`turn.json`) is
 * written before any judge runs, then its `result.json`. A stored turn, the
 * `turn.json` of an earlier run, is judged again with no narrator at all.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { getEntry } from "../core/registry.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult, readResult } from "../core/result.ts";
import type { ModelCall, Result, RunError, Verdict } from "../core/result.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import type { RunFolder } from "../core/run-folder.ts";
import { loadCasesFrom, readBlueprint, validateCase } from "./lib/case.ts";
import type { BlueprintLike, JudgeOptions, TurnCase } from "./lib/case.ts";
import { judgeTurn } from "./lib/judges.ts";
import { replayThroughNarrator } from "./lib/replay-cli.ts";
import type { Collected } from "./lib/replay-cli.ts";
import { ServerNarrator, startThrowawayServer } from "./lib/replay-server.ts";
import type { StartServer } from "./lib/replay-server.ts";
import { TURN_FILE, buildTurn, isStoredTurn, readStoredTurn } from "./lib/turn.ts";
import type { StoredTurn } from "./lib/turn.ts";

export const SERVER_NARRATOR = "server";
export const DEFAULT_JUDGE_BINDING = "turn-judge";
const DEFAULT_CONCURRENCY = 4;
const NARRATOR_BINDING = /^narrator-/;
const DEFAULT_JUDGES = ["flesch"];

const HELP = formatHelp({
  usage: "judge turn <cases or stored turn>...",
  summary:
    "Replays one turn per case and judges it. A case file (.ts, .mjs, .json) or a folder of them gives the cases; " +
    "the turn.json of an earlier run is judged again without replaying.",
  options: [
    ["--narrator <a,b>", `who narrates: ${SERVER_NARRATOR}, or a narrator binding (narrator-claude, narrator-openai, narrator-stub). Default: the case's, else ${SERVER_NARRATOR}`],
    ["--ai-profile <id>", "the profile a server narrator is asked for (default: the case's, else default)"],
    ["--judges <a,b>", "the checks and judges to run (default: the case's, else the earlier result's, else flesch)"],
    ["--judge-binding <name>", `the binding every model judge calls (default: ${DEFAULT_JUDGE_BINDING}; judge-stub answers offline)`],
    ["--concurrency <n>", `turns replayed and judged at once (default: ${DEFAULT_CONCURRENCY})`],
  ],
});

const SPEC = {
  options: {
    narrator: { type: "string" },
    "ai-profile": { type: "string" },
    judges: { type: "string" },
    "judge-binding": { type: "string" },
    concurrency: { type: "string" },
  },
  positionals: { min: 1, max: Number.MAX_SAFE_INTEGER },
} as const;

/** One thing to judge: a case to replay, or a turn already stored. */
type Input = { kind: "case"; testCase: TurnCase } | { kind: "stored"; turn: StoredTurn; file: string };

function list(value: OptionValue): string[] | null {
  if (typeof value !== "string") return null;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw new UsageError("a list option needs at least one name");
  return items;
}

function parseConcurrency(value: OptionValue): number {
  if (value === undefined) return DEFAULT_CONCURRENCY;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--concurrency needs a positive integer, got "${String(value)}"`);
  return n;
}

async function readJsonOrNull(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

/** A path is a stored turn when it is JSON with a captured response; anything else holds cases. */
async function loadInput(target: string): Promise<Input[]> {
  const absolute = path.resolve(target);
  if (absolute.endsWith(".json")) {
    const value = await readJsonOrNull(absolute);
    if (isStoredTurn(value)) return [{ kind: "stored", turn: await readStoredTurn(absolute), file: absolute }];
  }
  return (await loadCasesFrom(absolute)).map((testCase) => ({ kind: "case", testCase }));
}

/** The ids of an earlier result's verdicts, beside a stored turn; null when there is none. */
async function earlierJudges(file: string): Promise<string[] | null> {
  try {
    const earlier = await readResult(path.join(path.dirname(file), "result.json"));
    return earlier.verdicts.length > 0 ? earlier.verdicts.map((verdict) => verdict.id) : null;
  } catch {
    return null;
  }
}

function judgesFor(input: Input, chosen: string[] | null, earlier: string[] | null): string[] {
  if (chosen) return chosen;
  if (input.kind === "case") return input.testCase.judges ?? [];
  return earlier ?? DEFAULT_JUDGES;
}

function assertJudgesApply(ids: readonly string[]): void {
  for (const id of ids) {
    let entry;
    try {
      entry = getEntry(id);
    } catch (error) {
      throw new UsageError((error as Error).message);
    }
    if (!entry.subjects.includes("turn")) throw new UsageError(`"${id}" does not judge a turn`);
  }
}

function needsModelJudge(ids: readonly string[]): boolean {
  return ids.some((id) => getEntry(id).type === "judge");
}

/** One unit of work: a turn to replay and judge, or to judge again. */
interface WorkItem {
  input: Input;
  /** Who replays a case; null for a stored turn, which is not replayed. */
  narrator: string | null;
  judges: string[];
}

function narratorsFor(input: Input, chosen: string[] | null): Array<string | null> {
  if (input.kind === "stored") return [null];
  return chosen ?? [input.testCase.narrator ?? SERVER_NARRATOR];
}

function assertNarratorKnown(narrator: string): void {
  if (narrator !== SERVER_NARRATOR && !NARRATOR_BINDING.test(narrator)) {
    throw new UsageError(`--narrator takes ${SERVER_NARRATOR} or a narrator binding such as narrator-claude, got "${narrator}"`);
  }
}

interface Runtime {
  context: EvalContext;
  folder: RunFolder;
  judgeBinding: ResolvedBinding | null;
  narrators: Map<string, ResolvedBinding>;
  server: ServerNarrator;
  aiProfile: string | null;
}

function subjectId(item: WorkItem): string {
  return item.input.kind === "case"
    ? `${item.input.testCase.id}__${item.narrator}`
    : `${item.input.turn.case_id}__${item.input.turn.narrator}`;
}

async function replayCase(narrator: string, testCase: TurnCase, runtime: Runtime, logDir: string): Promise<Collected> {
  const { blueprint, blueprintPath } = await readBlueprint(testCase.blueprint.path, runtime.context.root);
  if (narrator === SERVER_NARRATOR) {
    const aiProfile = runtime.aiProfile ?? testCase.aiProfile ?? "default";
    return runtime.server.replay({ testCase, blueprint, blueprintPath, aiProfile });
  }
  const binding = runtime.narrators.get(narrator) as ResolvedBinding;
  return replayThroughNarrator({ testCase, blueprint, binding, logDir });
}

async function captureCase(
  narrator: string,
  testCase: TurnCase,
  runtime: Runtime,
  folder: { dir: string; logDir: string },
): Promise<{ turn: StoredTurn; collected: Collected }> {
  const startedAt = new Date();
  const collected = await replayCase(narrator, testCase, runtime, folder.logDir);
  const endedAt = new Date();
  const { blueprint, blueprintPath } = await readBlueprint(testCase.blueprint.path, runtime.context.root);
  const turn = buildTurn({
    runId: runtime.folder.info().id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    caseId: testCase.id,
    narrator,
    model: collected.model,
    blueprintPath,
    targetAge: (blueprint as BlueprintLike).metadata?.target_age ?? null,
    given: testCase.given,
    action: testCase.action,
    response: collected.response,
    totalMs: endedAt.getTime() - startedAt.getTime(),
  });
  // Written before any judge runs: the capture is the source of truth for judging again.
  fs.writeFileSync(path.join(folder.dir, TURN_FILE), `${JSON.stringify(turn, null, 2)}\n`);
  return { turn, collected };
}

function judgeOptions(input: Input): Record<string, JudgeOptions | undefined> {
  return input.kind === "case" ? (input.testCase.judgeConfig ?? {}) : {};
}

async function runSubject(item: WorkItem, runtime: Runtime): Promise<Result> {
  const id = subjectId(item);
  const folder = runtime.folder.subject({ kind: "turn", id });
  const stages: Array<{ name: string; duration_ms: number; failed?: boolean }> = [];
  const startedAt = performance.now();
  let turn: StoredTurn | null = null;
  let call: ModelCall | null = null;
  let runError: RunError | null = null;
  let verdicts: Verdict[] = [];

  try {
    const replayStart = performance.now();
    if (item.input.kind === "case") {
      const captured = await captureCase(item.narrator as string, item.input.testCase, runtime, folder);
      turn = captured.turn;
      call = captured.collected.call;
      stages.push({ name: "replay", duration_ms: Math.round(performance.now() - replayStart) });
    } else {
      turn = item.input.turn;
      fs.writeFileSync(path.join(folder.dir, TURN_FILE), `${JSON.stringify(turn, null, 2)}\n`);
    }
    const judgeStart = performance.now();
    verdicts = await judgeTurn(item.judges, turn, {
      root: runtime.context.root,
      binding: runtime.judgeBinding,
      logDir: folder.logDir,
      options: judgeOptions(item.input),
    });
    stages.push({ name: "judge", duration_ms: Math.round(performance.now() - judgeStart) });
  } catch (error) {
    runError = { stage: turn ? "judge" : "replay", message: error instanceof Error ? error.message : String(error) };
    stages.push({ name: runError.stage, duration_ms: 0, failed: true });
  }

  const result: Result = {
    schema_version: RESULT_SCHEMA_VERSION,
    run: runtime.folder.info(),
    subject: { kind: "turn", id, path: turn ? TURN_FILE : null },
    production: call ? { calls: [call] } : null,
    verdicts,
    summary: summarize(verdicts, runError),
    run_error: runError,
    timing: { total_ms: Math.round(performance.now() - startedAt), stages },
  };
  return writeResult(folder.resultFile, result);
}

function describe(result: Result): string {
  if (result.run_error) return `ERROR in ${result.run_error.stage}: ${result.run_error.message}`;
  const verdicts = result.verdicts.map((verdict) => {
    const score = (verdict.details as { score?: number | null } | undefined)?.score;
    return `${verdict.id}:${verdict.status}${score !== null && score !== undefined ? `(${score})` : ""}`;
  });
  return verdicts.join(" ") || "(no judges)";
}

export interface JudgeTurnDeps {
  /** Starts the throwaway server; replaced in tests. */
  startServer?: StartServer;
}

export function createJudgeTurnCommand({ startServer = startThrowawayServer }: JudgeTurnDeps = {}): EvalCommand {
  return {
    name: "judge turn",
    summary: "replay one turn per case and judge it, or judge a stored turn again",
    help: HELP,
    async run(argv, context) {
      const { common, values, positionals } = parseCommandArgs(argv, SPEC);
      if (common.help) {
        context.out(HELP);
        return 0;
      }
      const narrators = list(values.narrator);
      narrators?.forEach(assertNarratorKnown);
      const chosenJudges = list(values.judges);
      if (chosenJudges) assertJudgesApply(chosenJudges);
      const concurrency = parseConcurrency(values.concurrency);

      const inputs = (await Promise.all(positionals.map(loadInput))).flat();
      if (inputs.length === 0) throw new UsageError("no cases found");
      inputs.forEach((input) => input.kind === "case" && validateCase(input.testCase, input.testCase.id));

      const items: WorkItem[] = [];
      for (const input of inputs) {
        const earlier = input.kind === "stored" && !chosenJudges ? await earlierJudges(input.file) : null;
        const judges = judgesFor(input, chosenJudges, earlier);
        assertJudgesApply(judges);
        for (const narrator of narratorsFor(input, narrators)) {
          if (narrator !== null) assertNarratorKnown(narrator);
          items.push({ input, narrator, judges });
        }
      }

      const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
      const resolve = (name: string) => resolveBinding(config, name, { root: context.root });
      const narratorBindings = new Map<string, ResolvedBinding>();
      for (const name of new Set(items.map((item) => item.narrator))) {
        if (name !== null && name !== SERVER_NARRATOR) narratorBindings.set(name, resolve(name));
      }
      const judgeBinding = items.some((item) => needsModelJudge(item.judges))
        ? resolve(typeof values["judge-binding"] === "string" ? values["judge-binding"] : DEFAULT_JUDGE_BINDING)
        : null;

      const folder = createRunFolder({
        outputRoot: resolveOutputRoot(common.outputRoot, context.env),
        command: "judge turn",
        argv,
        root: context.root,
        bindings: [...narratorBindings.values(), ...(judgeBinding ? [judgeBinding] : [])],
      });
      const server = new ServerNarrator({ repoRoot: context.root, start: startServer, env: context.env });
      const runtime: Runtime = {
        context,
        folder,
        judgeBinding,
        narrators: narratorBindings,
        server,
        aiProfile: typeof values["ai-profile"] === "string" ? values["ai-profile"] : null,
      };

      context.out(`[judge turn] ${items.length} turn(s) -> ${folder.dir}`);
      try {
        await mapPool(items, concurrency, async (item) => {
          const result = await runSubject(item, runtime);
          context.out(`[judge turn] ${result.subject.id} -> ${describe(result)}`);
          return result;
        });
      } finally {
        await server.stop();
      }
      const index = await folder.finish();
      context.out(`[judge turn] wrote ${path.join(folder.dir, "run.json")} (exit ${index.exit_code})`);
      return index.exit_code;
    },
  };
}

export const judgeTurnCommand = createJudgeTurnCommand();

