/**
 * `result.json`: one per subject a command judged or produced, in one schema
 * for every command, parsed when written and again when read back.
 *
 * | Part         | Holds |
 * | ------------ | ----- |
 * | `run`        | The run it belongs to: id, command, arguments, start and end, commit and whether the tree was clean, the bindings used, each judge's version, and who ran what: suite, label, developer, host, parent run, prompt versions, and the suite attributes |
 * | `subject`    | `blueprint`, `game` or `turn`, its id, and where the stored subject sits beside the result |
 * | `production` | When this run made the subject: each model call, with its attempts |
 * | `verdicts`   | One per check or judge; a judge's carries its model call and raw answer |
 * | `summary`    | Counts by status and one `passed` flag, which must agree with `verdicts` |
 * | `run_error`  | Set only when the run itself broke |
 * | `timing`     | Stage timings, in milliseconds |
 * | `rounds`     | Only from `generate --repair`: each round's blueprint, model call, verdicts and cost, round 0 first; the last is the result's own |
 *
 * A stored subject keeps the shape it has on its own (a blueprint is a
 * clue-graph case, a trace or a captured turn its harness's shape), so the same
 * command can judge it again; only `result.json` carries this version.
 *
 * Versions: 1 lacks `rounds`; 2 lacks `tokens` on attempts and calls, which
 * read back as null. Version 3 is the one written. A field a later task adds
 * to version 3 defaults to null (or empty) when absent, so every version 3
 * result already written stays readable.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import { SuiteAttributesSchema } from "./suite-attributes.ts";

export const RESULT_SCHEMA_VERSION = "mystery-eval-result/3";
/** The versions a result may carry when read (see the file's header). */
export const READABLE_RESULT_SCHEMA_VERSIONS = ["mystery-eval-result/1", "mystery-eval-result/2", RESULT_SCHEMA_VERSION] as const;
export const ResultSchemaVersionSchema = z.enum(READABLE_RESULT_SCHEMA_VERSIONS);

export const STATUSES = ["pass", "fail", "error", "skipped"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

const CountSchema = z.number().int().min(0);

/**
 * The tokens a model call used, as the Claude CLI's `usage` object counts them.
 * A cache count is null when the source reports none: the game's own call log
 * counts input and output only, the cache folded into input.
 */
export const TokensSchema = z
  .object({
    input: CountSchema,
    output: CountSchema,
    cache_read: CountSchema.nullable(),
    cache_write: CountSchema.nullable(),
  })
  .strict();
export type Tokens = z.infer<typeof TokensSchema>;

/** A field's sum over the counts that were reported; null when none were. */
function sumCounts(counts: readonly (number | null)[]): number | null {
  const reported = counts.filter((each): each is number => each !== null);
  return reported.length === 0 ? null : reported.reduce((sum, each) => sum + each, 0);
}

/** Field-wise sum of the tokens that were reported; null when none were. */
export function sumTokens(tokens: readonly (Tokens | null)[]): Tokens | null {
  const reported = tokens.filter((each): each is Tokens => each !== null);
  if (reported.length === 0) return null;
  return {
    input: reported.reduce((sum, each) => sum + each.input, 0),
    output: reported.reduce((sum, each) => sum + each.output, 0),
    cache_read: sumCounts(reported.map((each) => each.cache_read)),
    cache_write: sumCounts(reported.map((each) => each.cache_write)),
  };
}

export const AttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    /** `ok`, or why the attempt was retried: a non-zero exit, a timeout, output that was not JSON, an answer that failed validation. */
    outcome: z.enum(["ok", "exit", "timeout", "not_json", "invalid"]),
    duration_ms: z.number().int().min(0),
    /** What the CLI reported it cost, in US dollars; null when it reported nothing. */
    cost_usd: z.number().min(0).nullable(),
    /** What the CLI reported it used; null when it reported nothing, and in results before version 3. */
    tokens: TokensSchema.nullable().default(null),
    error: z.string().optional(),
  })
  .strict();
export type Attempt = z.infer<typeof AttemptSchema>;

/** One model call through the runner, with every attempt it took. */
export const ModelCallSchema = z
  .object({
    binding: z.string(),
    model: z.string().nullable(),
    /** SHA-256 of the system prompt, a NUL byte and the user message. */
    prompt_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    duration_ms: z.number().int().min(0),
    /** The sum of the attempts' reported costs; null when no attempt reported one. */
    cost_usd: z.number().min(0).nullable(),
    /** The attempts' reported tokens, summed field by field; null when no attempt reported any. */
    tokens: TokensSchema.nullable().default(null),
    attempts: z.array(AttemptSchema).min(1),
  })
  .strict();
export type ModelCall = z.infer<typeof ModelCallSchema>;

const BindingUsedSchema = z
  .object({
    cmd: z.string(),
    args: z.array(z.string()),
    extract_path: z.string().nullable(),
    model: z.string().nullable(),
    timeout_ms: z.number().int().positive(),
    retries: z.number().int().min(0),
  })
  .strict();

export const RunInfoSchema = z
  .object({
    id: z.string().min(1),
    command: z.string().min(1),
    argv: z.array(z.string()),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime().nullable(),
    commit: z.string().nullable(),
    /** Whether the working tree had no uncommitted change; null outside a git checkout. */
    tree_clean: z.boolean().nullable(),
    bindings: z.record(BindingUsedSchema),
    /**
     * Every judge's version when the run started (`core/judge-version.ts`);
     * null for a judge whose files matched no recorded version; empty when
     * the result records none.
     */
    judge_versions: z.record(z.number().int().positive().nullable()).default({}),
    /** `--suite`; null on an ad-hoc run and in results written before it was recorded. */
    suite: z.string().min(1).nullable().default(null),
    /** `--label`; null on an ad-hoc run and in results written before it was recorded. */
    label: z.string().min(1).nullable().default(null),
    /** Who ran it: `developer` in the config, else the OS user name; never an email address. */
    developer: z.string().min(1).nullable().default(null),
    /** The machine's host name. */
    host: z.string().min(1).nullable().default(null),
    /** The id of the run this one belongs to: `judge game` started by `play --judge` names its play run; null otherwise. */
    parent_run: z.string().min(1).nullable().default(null),
    /** Short hashes of the narrator's prompt files and the generator's (`prompt-versions.ts`); null when not recorded. */
    prompt_versions: z
      .object({ narrator: z.string().regex(/^[0-9a-f]{12}$/), generator: z.string().regex(/^[0-9a-f]{12}$/) })
      .strict()
      .nullable()
      .default(null),
    /** What the run held fixed, so runs can be compared (`suite-attributes.ts`); null for a command that is not a run command, and in results written before it was recorded. */
    attributes: SuiteAttributesSchema.nullable().default(null),
  })
  .strict();
export type RunInfo = z.infer<typeof RunInfoSchema>;

export const SUBJECT_KINDS = ["blueprint", "game", "turn"] as const;
export const SubjectSchema = z
  .object({
    kind: z.enum(SUBJECT_KINDS),
    id: z.string().min(1),
    /** The stored subject, relative to the folder `result.json` is in; null when none was stored. */
    path: z.string().nullable(),
  })
  .strict();
export type Subject = z.infer<typeof SubjectSchema>;

export const VerdictSchema = z
  .object({
    id: z.string().min(1),
    tier: z.enum(["mechanical", "judge"]),
    status: StatusSchema,
    findings: z.array(z.unknown()).optional(),
    details: z.unknown().optional(),
    /** Why it could not be judged, or why it was skipped. */
    reason: z.string().optional(),
    /** A judge's model call; absent for code checks and for a judge that never ran. */
    call: ModelCallSchema.optional(),
    /** A judge's answer as the model gave it. */
    answer: z.unknown().optional(),
  })
  .strict();
export type Verdict = z.infer<typeof VerdictSchema>;

const CountsSchema = z
  .object({ pass: z.number().int(), fail: z.number().int(), error: z.number().int(), skipped: z.number().int() })
  .strict();
export type Counts = z.infer<typeof CountsSchema>;

export const SummarySchema = z.object({ counts: CountsSchema, passed: z.boolean() }).strict();
export type Summary = z.infer<typeof SummarySchema>;

export const RunErrorSchema = z.object({ stage: z.string().min(1), message: z.string() }).strict();
export type RunError = z.infer<typeof RunErrorSchema>;

const StageTimingSchema = z
  .object({
    name: z.string(),
    duration_ms: z.number().int().min(0),
    failed: z.boolean().optional(),
    detail: z.record(z.unknown()).optional(),
  })
  .strict();

export const TimingSchema = z
  .object({
    total_ms: z.number().int().min(0),
    stages: z.array(StageTimingSchema),
    dimensions: z
      .array(z.object({ id: z.string(), duration_ms: z.number().int().min(0), steps: z.array(StageTimingSchema) }).strict())
      .optional(),
  })
  .strict();

/**
 * One round of `generate --repair`. Round 0 is the generation as made; each
 * later round is the generator repairing the round before's blueprint from its
 * failing verdicts, judged again by every check and judge.
 */
export const RoundSchema = z
  .object({
    round: z.number().int().min(0),
    /** The blueprint this round judged, relative to the folder `result.json` is in. */
    path: z.string().min(1),
    /** The model call that made this round's blueprint. */
    call: ModelCallSchema,
    verdicts: z.array(VerdictSchema),
    summary: SummarySchema,
    /** The round's generator and judge calls' reported costs, summed; null when none reported one. */
    cost_usd: z.number().min(0).nullable(),
    /** This round's stage timings; round 0's are in the result's timing, which covers every round. */
    timing: TimingSchema.nullable(),
  })
  .strict();
export type Round = z.infer<typeof RoundSchema>;

export const ResultSchema = z
  .object({
    schema_version: ResultSchemaVersionSchema,
    run: RunInfoSchema,
    subject: SubjectSchema,
    production: z.object({ calls: z.array(ModelCallSchema) }).strict().nullable(),
    verdicts: z.array(VerdictSchema),
    summary: SummarySchema,
    run_error: RunErrorSchema.nullable(),
    timing: TimingSchema.nullable(),
    rounds: z.array(RoundSchema).optional(),
  })
  .strict()
  .superRefine((result, ctx) => {
    if (result.rounds !== undefined) checkRounds(result as Result, ctx);
    const expected = summarize(result.verdicts, result.run_error);
    if (JSON.stringify(expected) !== JSON.stringify(result.summary)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: `summary ${JSON.stringify(result.summary)} does not match the verdicts (${JSON.stringify(expected)})`,
      });
    }
    const ids = result.verdicts.map((verdict) => verdict.id);
    const repeated = ids.filter((id, index) => ids.indexOf(id) !== index);
    if (repeated.length > 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["verdicts"], message: `verdict ids repeat: ${repeated.join(", ")}` });
    }
  });
export type Result = z.infer<typeof ResultSchema>;

/** Rounds count up from 0, each summary matches its verdicts, and the last round is the result's blueprint and verdicts. */
function checkRounds(result: Result, ctx: z.RefinementCtx): void {
  const rounds = result.rounds ?? [];
  rounds.forEach((round, index) => {
    if (round.round !== index) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rounds", index, "round"], message: `round ${round.round} is at position ${index}` });
    }
    if (JSON.stringify(summarize(round.verdicts)) !== JSON.stringify(round.summary)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rounds", index, "summary"], message: "the round's summary does not match its verdicts" });
    }
  });
  const last = rounds.at(-1);
  if (last === undefined) return;
  if (JSON.stringify(last.verdicts) !== JSON.stringify(result.verdicts)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rounds"], message: "the last round's verdicts are not the result's" });
  }
  if (last.path !== result.subject.path) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["rounds"], message: `the last round's blueprint ${last.path} is not the subject's (${result.subject.path})` });
  }
}

/** Counts by status; `passed` when nothing failed, nothing errored and the run did not break. */
export function summarize(verdicts: readonly Pick<Verdict, "status">[], runError: RunError | null = null): Summary {
  const counts: Counts = { pass: 0, fail: 0, error: 0, skipped: 0 };
  for (const verdict of verdicts) counts[verdict.status] += 1;
  return { counts, passed: runError === null && counts.fail === 0 && counts.error === 0 };
}

export class ResultFileError extends Error {
  constructor(file: string, error: z.ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`).join("; ");
    super(`${file} is not a valid result: ${issues}`);
    this.name = "ResultFileError";
  }
}

/** Parses a result against the schema, throwing a `ResultFileError` that names `file`. */
export function parseResult(value: unknown, file: string): Result {
  const parsed = ResultSchema.safeParse(value);
  if (!parsed.success) throw new ResultFileError(file, parsed.error);
  return parsed.data;
}

/** Writes `result` to `file`, refusing one that does not match the schema. */
export async function writeResult(file: string, result: Result): Promise<Result> {
  const checked = parseResult(result, file);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(checked, null, 2)}\n`, "utf8");
  return checked;
}

/** Reads `file` and checks it against the schema. */
export async function readResult(file: string): Promise<Result> {
  const text = await fs.readFile(file, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not JSON: ${(error as Error).message}`, { cause: error });
  }
  return parseResult(value, file);
}

export const EXIT_PASSED = 0;
export const EXIT_RUN_BROKE = 1;
export const EXIT_VERDICT_FAILED = 2;

/**
 * The exit code for a run, the same for every command: 1 when the run broke
 * (any result has `run_error`, or there is no result at all), else 2 when a
 * check or judge failed or could not be judged, else 0. `skipped` counts as
 * neither, since only a flag skips.
 */
export function exitCodeFor(results: readonly Pick<Result, "summary" | "run_error">[]): number {
  if (results.length === 0 || results.some((result) => result.run_error !== null)) return EXIT_RUN_BROKE;
  if (results.some((result) => result.summary.counts.fail > 0 || result.summary.counts.error > 0)) {
    return EXIT_VERDICT_FAILED;
  }
  return EXIT_PASSED;
}
