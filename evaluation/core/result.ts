/**
 * `result.json`: one per subject a command judged or produced, in one schema
 * for every command, parsed when written and again when read back.
 *
 * | Part         | Holds |
 * | ------------ | ----- |
 * | `run`        | The run it belongs to: id, command, arguments, start and end, commit and whether the tree was clean, the bindings used |
 * | `subject`    | `blueprint`, `game` or `turn`, its id, and where the stored subject sits beside the result |
 * | `production` | When this run made the subject: each model call, with its attempts |
 * | `verdicts`   | One per check or judge; a judge's carries its model call and raw answer |
 * | `summary`    | Counts by status and one `passed` flag, which must agree with `verdicts` |
 * | `run_error`  | Set only when the run itself broke |
 * | `timing`     | Stage timings, in milliseconds |
 *
 * A stored subject keeps the shape it has on its own (a blueprint is a
 * Blueprint V2, a trace or a captured turn its harness's shape), so the same
 * command can judge it again; only `result.json` carries this version.
 */

import fs from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

export const RESULT_SCHEMA_VERSION = "mystery-eval-result/1";

export const STATUSES = ["pass", "fail", "error", "skipped"] as const;
export const StatusSchema = z.enum(STATUSES);
export type Status = z.infer<typeof StatusSchema>;

export const AttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    /** `ok`, or why the attempt was retried: a non-zero exit, a timeout, output that was not JSON, an answer that failed validation. */
    outcome: z.enum(["ok", "exit", "timeout", "not_json", "invalid"]),
    duration_ms: z.number().int().min(0),
    /** What the CLI reported it cost, in US dollars; null when it reported nothing. */
    cost_usd: z.number().min(0).nullable(),
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
    tier: z.enum(["mechanical", "analyzer", "judge"]),
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

export const ResultSchema = z
  .object({
    schema_version: z.literal(RESULT_SCHEMA_VERSION),
    run: RunInfoSchema,
    subject: SubjectSchema,
    production: z.object({ calls: z.array(ModelCallSchema) }).strict().nullable(),
    verdicts: z.array(VerdictSchema),
    summary: SummarySchema,
    run_error: RunErrorSchema.nullable(),
    timing: TimingSchema.nullable(),
  })
  .strict()
  .superRefine((result, ctx) => {
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
