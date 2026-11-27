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
 *   names the AI it is asked for, one from `ai.json` of the config root in
 *   force; the server's `ai.json` holds just the AIs the run names.
 *
 * Every (case, narrator) is one subject: its stored turn (`turn.json`) is
 * written before any judge runs, then its `result.json`. A stored turn, the
 * `turn.json` of an earlier run, is judged again with no narrator at all.
 *
 * A stored game (a trace) is judged on the narration it already holds: every
 * played event that has narration is one turn, named by its event sequence, and
 * no narrator is called.
 *
 * A case with `expect` is replayed `--samples` times per narrator, each sample
 * a subject `<case>__<narrator>__s<n>` graded by code (`lib/expect.ts`); the
 * run's graded summary is written beside `run.json` as `expect.json` and
 * printed (`lib/expect-summary.ts`). A case without `expect` runs once, as it
 * always has.
 */

import fs from "node:fs";
import path from "node:path";

import { formatHelp, parseCommandArgs } from "../core/args.ts";
import type { OptionValue } from "../core/args.ts";
import { baselinePath, checkoutSources } from "../core/baseline-sources.ts";
import { loadConfig, resolveBinding } from "../core/config.ts";
import type { ResolvedBinding } from "../core/config.ts";
import type { EvalCommand, EvalContext } from "../core/dispatch.ts";
import { ConfigError, UsageError } from "../core/errors.ts";
import { mapPool } from "../core/pool.ts";
import { getEntry } from "../core/registry.ts";
import { RESULT_SCHEMA_VERSION, summarize, writeResult, readResult } from "../core/result.ts";
import type { ModelCall, Result, RunError, Verdict } from "../core/result.ts";
import { createRunFolder, resolveOutputRoot } from "../core/run-folder.ts";
import { runIdentity } from "../core/run-identity.ts";
import type { RunFolder } from "../core/run-folder.ts";
import { bindingLabel, contentHash, serverNarratorLabel } from "../core/suite-attributes.ts";
import type { CommandAttributes } from "../core/suite-attributes.ts";
import { pickAIs } from "../../scripts/lib/ai-seed.mjs";
import { assertCaseCharacters, loadCasesFrom, readBlueprint, validateCase } from "./lib/case.ts";
import type { JudgeOptions, TurnCase } from "./lib/case.ts";
import { baselineSettings, baselineSourceGroups, sortedUnique } from "./lib/baseline-inputs.ts";
import type { BaselineCaseInput, BaselineInputs, BaselineScope } from "./lib/baseline-inputs.ts";
import { promptFamily, PROMPT_FAMILIES } from "./lib/baseline-prompts.ts";
import { EXPECT_VERDICT, expectJudges, gradeExpect, validateExpect, type ComesWith } from "./lib/expect.ts";
import { EXPECT_FILE, formatSummary, summarizeSamples, writeSummary } from "./lib/expect-summary.ts";
import type { Sample } from "./lib/expect-summary.ts";
import { SERVER_BINDING } from "../lib/game-ai-calls.ts";
import { judgeTurn } from "./lib/judges.ts";
import { modelLabel, NarratorReplayError, replayThroughNarrator } from "./lib/replay-cli.ts";
import type { Collected } from "./lib/replay-cli.ts";
import { ServerNarrator, startThrowawayServer } from "./lib/replay-server.ts";
import type { StartServer } from "./lib/replay-server.ts";
import { isNarrated, playedEvents } from "../lib/game-events.ts";
import { ridersOf } from "../../packages/game-engine/src/clue-graph/play.ts";
import { TURN_FILE, buildTurn, isStoredTurn, readStoredTurn, turnFromEvent } from "./lib/turn.ts";
import type { StoredEvent } from "./lib/turn.ts";
import type { StoredTurn } from "./lib/turn.ts";

export const SERVER_NARRATOR = SERVER_BINDING;
export const DEFAULT_JUDGE_BINDING = "turn-judge";
const DEFAULT_CONCURRENCY = 4;
/** How many times a case with `expect` is replayed per narrator, unless `--samples` says otherwise. */
export const DEFAULT_SAMPLES = 5;
const NARRATOR_BINDING = /^narrator-/;
const DEFAULT_JUDGES = ["flesch"];
/** What a stored game's turns are judged with: the turn-level checks that read the narration alone. */
export const GAME_TURN_JUDGES = ["flesch", "age_appropriate_turn"];

const HELP = formatHelp({
  usage: "judge turn <cases or stored turn>...",
  summary:
    "Replays one turn per case and judges it. A case file (.ts, .mjs, .json) or a folder of them gives the cases; " +
    "the turn.json of an earlier run is judged again without replaying; a stored game (a trace) has every narrated turn " +
    "judged on its own narration, named by event sequence, with no narrator.",
  options: [
    ["--narrator <a,b>", `who narrates: ${SERVER_NARRATOR}, or a narrator binding (narrator-claude, narrator-openai, narrator-stub). Default: the case's, else ${SERVER_NARRATOR}`],
    ["--ai-profile <name>", "the AI a server narrator is asked for: a name from ai.json, or mock (default: the case's, else default, which is mock on its fresh database)"],
    ["--judges <a,b>", "the checks and judges to run (cases: their judges, else none; stored turns: earlier result's judges, else flesch; a stored game: flesch,age_appropriate_turn, the only two it takes)"],
    ["--judge-binding <name>", `the binding every model judge calls (default: ${DEFAULT_JUDGE_BINDING}; judge-stub answers offline)`],
    ["--samples <n>", `replays per narrator of each case with expect, graded by code and summed into expect.json (default: ${DEFAULT_SAMPLES}); a case without expect runs once`],
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
    samples: { type: "string" },
  },
  positionals: { min: 1, max: Number.MAX_SAFE_INTEGER },
} as const;

/** One thing to judge: a case to replay, or a turn already stored. */
type Input =
  | { kind: "case"; testCase: TurnCase }
  | { kind: "stored"; turn: StoredTurn; file: string; fromGame: boolean };

function list(value: OptionValue): string[] | null {
  if (typeof value !== "string") return null;
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) throw new UsageError("a list option needs at least one name");
  return items;
}

function positiveInteger(flag: string, value: OptionValue, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new UsageError(`--${flag} needs a positive integer, got "${String(value)}"`);
  return n;
}

async function readJsonOrNull(file: string): Promise<unknown> {
  try {
    return JSON.parse(await fs.promises.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

interface StoredGame {
  blueprint: object;
  events: StoredEvent[];
}

/** Whether a parsed JSON value is a stored game: a blueprint and its events, in the shape `judge game` reads. */
function isStoredGame(value: unknown): value is StoredGame {
  const candidate = value as Partial<StoredGame> | null;
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    typeof candidate.blueprint === "object" &&
    candidate.blueprint !== null &&
    Array.isArray(candidate.events) &&
    candidate.events.every((event) => typeof event?.event_type === "string" && Number.isInteger(event.sequence))
  );
}

/**
 * The turns a stored game is judged on: every event the narrator wrote, in
 * sequence order, each on the narration it holds and at the age its event
 * records. Engine-written lines (a lead, a refusal) are fixed text, not the
 * narrator's. `id` names the game, and so each turn's `case_id`.
 */
export function storedGameTurns(game: { blueprint: object; events: StoredEvent[] }, id: string): StoredTurn[] {
  const owner = { id, blueprintPath: "" };
  return playedEvents(game.events)
    .filter((event) => isNarrated(event) && typeof event.narration === "string" && event.narration.trim().length > 0)
    .sort((a, b) => a.sequence - b.sequence)
    .map((event) => turnFromEvent(event, owner));
}

/** What names a stored game in a run: its file, or its folder when the file is named `trace.json`. */
function gameId(file: string): string {
  const stem = path.basename(file, ".json");
  return stem === "trace" ? path.basename(path.dirname(file)) : stem;
}

/** A path is a stored game when it is a trace, a stored turn when it is JSON with a captured response; anything else holds cases. */
async function loadInput(target: string): Promise<Input[]> {
  const absolute = path.resolve(target);
  if (absolute.endsWith(".json")) {
    const value = await readJsonOrNull(absolute);
    if (isStoredTurn(value)) return [{ kind: "stored", turn: await readStoredTurn(absolute), file: absolute, fromGame: false }];
    if (isStoredGame(value)) {
      return storedGameTurns(value, gameId(absolute)).map((turn) => ({ kind: "stored", turn, file: absolute, fromGame: true }));
    }
  }
  return (await loadCasesFrom(absolute)).map((testCase) => ({ kind: "case", testCase }));
}

/** The ids of an earlier result's verdicts, beside a stored turn; null when there is none. */
async function earlierJudges(file: string): Promise<string[] | null> {
  try {
    const earlier = await readResult(path.join(path.dirname(file), "result.json"));
    // The grade reads the case's expect, which a stored turn does not carry.
    const ids = earlier.verdicts.map((verdict) => verdict.id).filter((id) => id !== EXPECT_VERDICT);
    return ids.length > 0 ? ids : null;
  } catch {
    return null;
  }
}

function judgesFor(input: Input, chosen: string[] | null, earlier: string[] | null): string[] {
  // The judges an expect grades on run whatever was chosen: without them the sample could not be graded.
  if (input.kind === "case") return [...new Set([...(chosen ?? input.testCase.judges ?? []), ...expectJudges(input.testCase)])];
  if (chosen) return chosen;
  if (input.fromGame) return GAME_TURN_JUDGES;
  return earlier ?? DEFAULT_JUDGES;
}

/** A stored game's turns carry no blueprint path or history, so only the judges that read the narration alone apply. */
function assertGameTurnJudges(ids: readonly string[]): void {
  for (const id of ids) {
    if (!GAME_TURN_JUDGES.includes(id)) {
      throw new UsageError(`a stored game's turns are judged with ${GAME_TURN_JUDGES.join(" and ")} only, not "${id}"; judge the game with \`judge game\``);
    }
  }
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
  /** Which sample of a case with `expect` this is, from 1; null for anything else. */
  sample: number | null;
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

/** Every (input, narrator) to run, with the judges it gets; refuses a judge that does not apply to its input. */
async function workItems(inputs: Input[], narrators: string[] | null, chosenJudges: string[] | null, samples: number): Promise<WorkItem[]> {
  const items: WorkItem[] = [];
  for (const input of inputs) {
    const earlier = input.kind === "stored" && !input.fromGame && !chosenJudges ? await earlierJudges(input.file) : null;
    const judges = judgesFor(input, chosenJudges, earlier);
    assertJudgesApply(judges);
    if (input.kind === "stored" && input.fromGame) assertGameTurnJudges(judges);
    const graded = input.kind === "case" && input.testCase.expect !== undefined;
    for (const narrator of narratorsFor(input, narrators)) {
      if (narrator !== null) assertNarratorKnown(narrator);
      if (!graded) items.push({ input, narrator, judges, sample: null });
      for (let sample = 1; graded && sample <= samples; sample += 1) items.push({ input, narrator, judges, sample });
    }
  }
  return items;
}

interface Runtime {
  context: EvalContext;
  folder: RunFolder;
  judgeBinding: ResolvedBinding | null;
  narrators: Map<string, ResolvedBinding>;
  server: ServerNarrator;
  /** The `--ai-profile` flag. */
  aiProfile: string | null;
}

/** The AI a server narrator is asked for: the flag, else the case's, else the server's own choice. */
function serverAI(testCase: TurnCase, flag: string | null): string {
  return flag ?? testCase.aiProfile ?? "default";
}

function subjectId(item: WorkItem): string {
  if (item.input.kind === "stored") return `${item.input.turn.case_id}__${item.input.turn.narrator}`;
  const base = `${item.input.testCase.id}__${item.narrator}`;
  return item.sample === null ? base : `${base}__s${item.sample}`;
}

/** The model a sample is summed under: a binding's name and model, or the AI a server is asked for. */
function sampleModel(item: WorkItem, testCase: TurnCase, runtime: Runtime): string {
  if (item.narrator === SERVER_NARRATOR) return serverAI(testCase, runtime.aiProfile);
  return modelLabel(runtime.narrators.get(item.narrator as string) as ResolvedBinding);
}

/** The samples of every case with `expect`, each with its grade (null when it did not run), in run order. */
function gradedSamples(items: readonly WorkItem[], results: readonly Result[], runtime: Runtime): Sample[] {
  return items.flatMap((item, index) => {
    if (item.sample === null || item.input.kind !== "case") return [];
    const testCase = item.input.testCase;
    return [{
      caseId: testCase.id,
      narrator: item.narrator as string,
      model: sampleModel(item, testCase, runtime),
      group: testCase.group ?? null,
      ungraded: testCase.ungraded === true,
      verdict: results[index].verdicts.find((verdict) => verdict.id === EXPECT_VERDICT) ?? null,
    }];
  });
}

/** What comes out with a clue in the case's blueprint: the graph's riders. */
async function ridersFor(testCase: TurnCase, runtime: Runtime): Promise<ComesWith> {
  const graph = (await readBlueprint(testCase.blueprint.path, runtime.context.root)).blueprint.clue_graph;
  return (id) => ridersOf(graph, id);
}

async function replayCase(narrator: string, testCase: TurnCase, runtime: Runtime, logDir: string): Promise<Collected> {
  const { blueprint, blueprintPath } = await readBlueprint(testCase.blueprint.path, runtime.context.root);
  if (narrator === SERVER_NARRATOR) {
    const aiProfile = serverAI(testCase, runtime.aiProfile);
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
  const { blueprintPath } = await readBlueprint(testCase.blueprint.path, runtime.context.root);
  const turn = buildTurn({
    runId: runtime.folder.info().id,
    startedAt: startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    caseId: testCase.id,
    narrator,
    model: collected.model,
    blueprintPath,
    readingAge: testCase.reading_age,
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
  let calls: ModelCall[] = [];
  let runError: RunError | null = null;
  let verdicts: Verdict[] = [];

  try {
    const replayStart = performance.now();
    if (item.input.kind === "case") {
      const captured = await captureCase(item.narrator as string, item.input.testCase, runtime, folder);
      turn = captured.turn;
      calls = captured.collected.calls;
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
    if (item.input.kind === "case" && item.input.testCase.expect) {
      verdicts.push(gradeExpect(item.input.testCase.expect, turn, verdicts, await ridersFor(item.input.testCase, runtime)));
    }
    stages.push({ name: "judge", duration_ms: Math.round(performance.now() - judgeStart) });
  } catch (error) {
    if (error instanceof NarratorReplayError) calls = error.calls;
    runError = { stage: error instanceof NarratorReplayError ? error.stage : turn ? "judge" : "replay", message: error instanceof Error ? error.message : String(error) };
    stages.push({ name: runError.stage, duration_ms: 0, failed: true });
  }

  const result: Result = {
    schema_version: RESULT_SCHEMA_VERSION,
    run: runtime.folder.info(),
    subject: { kind: "turn", id, path: turn ? TURN_FILE : null },
    production: calls.length > 0 ? { calls } : null,
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

/** What names an input in the suite attributes: a case by its id, a stored turn as its subject is named. */
function inputId(input: Input): string {
  return input.kind === "case" ? input.testCase.id : `${input.turn.case_id}__${input.turn.narrator}`;
}

/**
 * An input's content: a case with the blueprint file it is played on, as
 * stored (not the world view the code builds from it, which a commit may
 * change while the file stays the same), or the stored turn.
 */
async function inputContent(input: Input, root: string): Promise<unknown> {
  if (input.kind === "stored") return input.turn;
  const file = path.resolve(root, input.testCase.blueprint.path);
  return { case: input.testCase, blueprint: JSON.parse(await fs.promises.readFile(file, "utf8")) as unknown };
}

/**
 * What this run holds fixed. A narrator is its binding's label, or a server's
 * (`serverNarratorLabel`); `--samples` counts only when a case has `expect`,
 * and `--ai-profile` shows in the server narrator's label.
 */
async function turnAttributes(
  items: readonly WorkItem[],
  inputs: readonly Input[],
  bindings: { narrators: Map<string, ResolvedBinding>; judge: ResolvedBinding | null },
  settings: { samples: number; concurrency: number; aiProfile: string | null; asked: string[]; context: EvalContext },
): Promise<CommandAttributes> {
  // The AIs the server was seeded with, read again for their backend and model; their keys are not kept.
  const { ais } = pickAIs({ repoRoot: settings.context.root, env: settings.context.env, names: settings.asked });
  const narrators = items.flatMap((item) => {
    if (item.narrator === null) return [];
    if (item.narrator !== SERVER_NARRATOR) return [bindingLabel(bindings.narrators.get(item.narrator) as ResolvedBinding)];
    const name = serverAI((item.input as Extract<Input, { kind: "case" }>).testCase, settings.aiProfile);
    return [serverNarratorLabel(name, ais[name])];
  });
  return {
    options: {},
    inputs: await Promise.all(inputs.map(async (input) => ({ id: inputId(input), hash: contentHash(await inputContent(input, settings.context.root)) }))),
    judges: items.flatMap((item) => item.judges),
    models: { narrator: narrators, judge: bindings.judge ? [bindingLabel(bindings.judge)] : [] },
    samples: items.some((item) => item.sample !== null) ? settings.samples : null,
    concurrency: settings.concurrency,
  };
}

function captureBaselineInputs(
  context: EvalContext, positionals: readonly string[], items: readonly WorkItem[], settings: BaselineInputs["settings"],
): BaselineInputs | undefined {
  const graded = items.filter((item) => item.sample === 1 && item.input.kind === "case");
  if (graded.length === 0) return undefined;
  let externalInputs = false;
  const filePaths = (paths: readonly string[], relativeTo: string): string[] => sortedUnique(paths.flatMap((file) => {
    const local = baselinePath(context.root, path.resolve(relativeTo, file));
    if (local) return [local];
    externalInputs = true;
    return [];
  }));
  const cases = [...new Map(graded.map((item) => {
    const { testCase } = item.input as Extract<Input, { kind: "case" }>;
    const judges = sortedUnique(item.judges);
    const overrides = judges.flatMap((id) => testCase.judgeConfig?.[id]?.blueprintPath ?? []);
    const record: BaselineCaseInput = {
      id: testCase.id, action: testCase.action.type, case_hash: contentHash(testCase),
      blueprints: filePaths([testCase.blueprint.path, ...overrides], context.root), judges,
    };
    return [testCase.id, record] as const;
  })).values()];
  const server = graded.some((item) => item.narrator === SERVER_NARRATOR);
  const scope: BaselineScope = {
    case_paths: filePaths(positionals, process.cwd()),
    blueprints: sortedUnique(cases.flatMap((item) => item.blueprints)),
    judges: sortedUnique(cases.flatMap((item) => item.judges)),
    prompts: server ? PROMPT_FAMILIES : [...new Set(cases.flatMap((item) => promptFamily(item.action) ?? []))],
    external_inputs: externalInputs,
    server,
  };
  try {
    return {
      version: 1, scope, sources: baselineSourceGroups(checkoutSources(context.root, scope.case_paths), scope),
      cases, settings,
    };
  } catch (error) {
    context.err(`[judge turn] cannot record baseline inputs: ${(error as Error).message}`);
    return undefined;
  }
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
      const concurrency = positiveInteger("concurrency", values.concurrency, DEFAULT_CONCURRENCY);
      const samples = positiveInteger("samples", values.samples, DEFAULT_SAMPLES);

      const inputs = (await Promise.all(positionals.map(loadInput))).flat();
      if (inputs.length === 0) throw new UsageError("no cases found");
      for (const input of inputs) {
        if (input.kind !== "case") continue;
        validateCase(input.testCase, input.testCase.id);
        validateExpect(input.testCase);
        // A case on anything but a clue graph, or naming a character it lacks, is refused before a call is made.
        const { blueprint, blueprintPath } = await readBlueprint(input.testCase.blueprint.path, context.root);
        assertCaseCharacters(input.testCase, blueprint, blueprintPath);
      }

      const items = await workItems(inputs, narrators, chosenJudges, samples);

      const config = loadConfig({ root: context.root, configPath: common.configPath, modelOverrides: common.modelOverrides });
      const resolve = (name: string) => resolveBinding(config, name, { root: context.root });
      const narratorBindings = new Map<string, ResolvedBinding>();
      for (const name of new Set(items.map((item) => item.narrator))) {
        if (name !== null && name !== SERVER_NARRATOR) narratorBindings.set(name, resolve(name));
      }
      const judgeBinding = items.some((item) => needsModelJudge(item.judges))
        ? resolve(typeof values["judge-binding"] === "string" ? values["judge-binding"] : DEFAULT_JUDGE_BINDING)
        : null;

      const aiProfile = typeof values["ai-profile"] === "string" ? values["ai-profile"] : null;
      const asked = items.flatMap((item) =>
        item.narrator === SERVER_NARRATOR && item.input.kind === "case" ? [serverAI(item.input.testCase, aiProfile)] : [],
      );
      // Before the run folder: a name or key ai.json cannot give fails the run with nothing written.
      let server: ServerNarrator;
      try {
        server = new ServerNarrator({ repoRoot: context.root, start: startServer, env: context.env, ais: asked });
      } catch (error) {
        if (error instanceof Error && error.name === "AIConfigError") throw new ConfigError(error.message);
        throw error;
      }

      const attributes = await turnAttributes(items, inputs, { narrators: narratorBindings, judge: judgeBinding }, { samples, concurrency, aiProfile, asked, context });
      const bindings = [...narratorBindings.values(), ...(judgeBinding ? [judgeBinding] : [])];
      const baselineInputs = captureBaselineInputs(context, positionals, items, baselineSettings(attributes, aiProfile, bindings));
      const folder = createRunFolder({
        outputRoot: resolveOutputRoot(common.outputRoot, context.env),
        command: "judge turn",
        argv,
        root: context.root,
        identity: runIdentity(common, context.root),
        bindings,
        attributes,
      });
      // Its calls come back as the turns' model calls; the log itself stays in the run's folder.
      server.logCallsTo(path.join(folder.dir, "ai-calls.jsonl"));
      const runtime: Runtime = { context, folder, judgeBinding, narrators: narratorBindings, server, aiProfile };

      context.out(`[judge turn] ${items.length} turn(s) -> ${folder.dir}`);
      let results: Result[];
      try {
        results = await mapPool(items, concurrency, async (item) => {
          const result = await runSubject(item, runtime);
          context.out(`[judge turn] ${result.subject.id} -> ${describe(result)}`);
          return result;
        });
      } finally {
        await server.stop();
      }
      const index = await folder.finish();
      const graded = gradedSamples(items, results, runtime);
      if (graded.length > 0) {
        const summary = summarizeSamples(graded, samples, index.run, baselineInputs);
        writeSummary(path.join(folder.dir, EXPECT_FILE), summary);
        for (const line of formatSummary(summary)) context.out(line ? `[judge turn] ${line}` : "");
        context.out(`[judge turn] wrote ${path.join(folder.dir, EXPECT_FILE)}`);
      }
      context.out(`[judge turn] wrote ${path.join(folder.dir, "run.json")} (exit ${index.exit_code})`);
      return index.exit_code;
    },
  };
}

export const judgeTurnCommand = createJudgeTurnCommand();

