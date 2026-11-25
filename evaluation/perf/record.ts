/**
 * The run record: `record.json`, schema `mystery-eval-record/1`, written once
 * beside `run.json` when a run finishes (`core/run-folder.ts`) and never
 * edited. It is what leaves the machine, so it holds ids, counts and metrics
 * only: no prompt, raw answer, finding text, reason, error message or log.
 *
 * | Part       | Holds |
 * | ---------- | ----- |
 * | `run`      | The run block whole, as `run.json` has it, with `developer` always set |
 * | `result_version` | The result schema the record was built from; a field that version lacks is null |
 * | `exit_code` | The run's, from `run.json`; null for a run stopped before it wrote one |
 * | `comparable` | False when the tree was not known to be clean, or a judge gave a pass or fail with no recorded version |
 * | `subjects` | Per subject: kind, id, `passed`, how many rounds, and the stage the run broke at |
 * | `calls`    | One row per model call: its subject and round, role, judge and version, binding, model, duration, cost, tokens, attempts and last outcome |
 * | `verdicts` | One row per verdict: its subject and round, id, tier, status, judge version and how many findings |
 *
 * A row names its subject by position in `subjects`. A run is told apart from
 * other developers' by `run.developer` and `run.id` together, since run ids are
 * timestamps.
 *
 * A call's role follows from where it sits: a verdict's call is the judge's, a
 * round's the generator's, and a production call is the generator's for a
 * blueprint, the narrator's for a turn, and for a game the narrator's on the
 * `server` binding, else the investigator's.
 *
 * Rounds (`generate --repair`) flatten into rows by round number: each round's
 * generator call and verdicts, then the generator call of a round that broke
 * before it was judged. Without rounds, `round` is null and the rows are the
 * result's production calls and verdicts.
 */

import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { SERVER_BINDING } from "../lib/game-ai-calls.ts";
import {
  AttemptSchema,
  ResultSchemaVersionSchema,
  RunInfoSchema,
  StatusSchema,
  SUBJECT_KINDS,
  TokensSchema,
  VerdictSchema,
} from "../core/result.ts";
import type { ModelCall, Result, RunInfo, Subject, Verdict } from "../core/result.ts";

export const RECORD_SCHEMA_VERSION = "mystery-eval-record/1";
export const RECORD_FILE = "record.json";

export const CALL_ROLES = ["generator", "judge", "narrator", "investigator"] as const;
export type CallRole = (typeof CALL_ROLES)[number];

const PositionSchema = z.number().int().min(0);

const RecordSubjectSchema = z
  .object({
    kind: z.enum(SUBJECT_KINDS),
    id: z.string().min(1),
    passed: z.boolean(),
    /** How many rounds `generate --repair` ran, round 0 included; null for a result without rounds. */
    rounds: z.number().int().positive().nullable(),
    /** The stage the run broke at for this subject; null when it did not break. */
    run_error_stage: z.string().min(1).nullable(),
  })
  .strict();

/** A judge's version as the run recorded it; null for a code check, or a judge whose files matched no recorded version. */
const JudgeVersionSchema = z.number().int().positive().nullable();

const CallRowSchema = z
  .object({
    subject: PositionSchema,
    /** The round it belongs to; null for a result without rounds. */
    round: PositionSchema.nullable(),
    role: z.enum(CALL_ROLES),
    /** The judge whose verdict it gave; null for any other role. */
    judge: z.string().min(1).nullable(),
    judge_version: JudgeVersionSchema,
    binding: z.string(),
    model: z.string().nullable(),
    duration_ms: z.number().int().min(0),
    cost_usd: z.number().min(0).nullable(),
    tokens: TokensSchema.nullable(),
    attempts: z.number().int().positive(),
    /** The last attempt's outcome: `ok` when the call got its answer. */
    outcome: AttemptSchema.shape.outcome,
  })
  .strict();
export type CallRow = z.infer<typeof CallRowSchema>;

const VerdictRowSchema = z
  .object({
    subject: PositionSchema,
    round: PositionSchema.nullable(),
    id: z.string().min(1),
    tier: VerdictSchema.shape.tier,
    status: StatusSchema,
    judge_version: JudgeVersionSchema,
    /** How many findings the verdict listed; null when it lists none at all. */
    findings: z.number().int().min(0).nullable(),
  })
  .strict();
export type VerdictRow = z.infer<typeof VerdictRowSchema>;

export const RunRecordSchema = z
  .object({
    schema_version: z.literal(RECORD_SCHEMA_VERSION),
    result_version: ResultSchemaVersionSchema,
    run: RunInfoSchema.extend({ developer: z.string().min(1) }),
    exit_code: z.number().int().min(0).max(2).nullable(),
    comparable: z.boolean(),
    subjects: z.array(RecordSubjectSchema),
    calls: z.array(CallRowSchema),
    verdicts: z.array(VerdictRowSchema),
  })
  .strict()
  .superRefine((record, ctx) => {
    for (const [part, rows] of [["calls", record.calls], ["verdicts", record.verdicts]] as const) {
      rows.forEach((row, index) => {
        if (row.subject >= record.subjects.length) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: [part, index, "subject"], message: `subject ${row.subject} is not in subjects` });
        }
      });
    }
  });
export type RunRecord = z.infer<typeof RunRecordSchema>;

/** What a record is built from: a run's `run.json` (or, without one, its results' run block) and its subjects' results, in order. */
export interface RecordSource {
  result_version: Result["schema_version"];
  run: RunInfo;
  /** Null for a run stopped before it wrote `run.json`. */
  exit_code: number | null;
  results: readonly Result[];
}

/** The role of a production call, from what the subject is and the binding it went to. */
function productionRole(kind: Subject["kind"], binding: string): CallRole {
  if (kind === "blueprint") return "generator";
  if (kind === "turn") return "narrator";
  return binding === SERVER_BINDING ? "narrator" : "investigator";
}

interface Place {
  subject: number;
  round: number | null;
}

function callRow(call: ModelCall, place: Place, role: CallRole, judge: { id: string; version: number | null } | null): CallRow {
  return {
    ...place,
    role,
    judge: judge?.id ?? null,
    judge_version: judge?.version ?? null,
    binding: call.binding,
    model: call.model,
    duration_ms: call.duration_ms,
    cost_usd: call.cost_usd,
    tokens: call.tokens,
    attempts: call.attempts.length,
    outcome: call.attempts[call.attempts.length - 1].outcome,
  };
}

/** One subject's call and verdict rows, rounds flattened by round number. */
function subjectRows(result: Result, subject: number, versionOf: (id: string) => number | null) {
  const calls: CallRow[] = [];
  const verdicts: VerdictRow[] = [];
  const judged = (list: readonly Verdict[], round: number | null) => {
    for (const verdict of list) {
      const version = verdict.tier === "judge" ? versionOf(verdict.id) : null;
      verdicts.push({
        subject,
        round,
        id: verdict.id,
        tier: verdict.tier,
        status: verdict.status,
        judge_version: version,
        findings: verdict.findings?.length ?? null,
      });
      if (verdict.call) calls.push(callRow(verdict.call, { subject, round }, "judge", { id: verdict.id, version }));
    }
  };
  const production = result.production?.calls ?? [];
  const rounds = result.rounds ?? [];
  if (rounds.length === 0) {
    for (const call of production) calls.push(callRow(call, { subject, round: null }, productionRole(result.subject.kind, call.binding), null));
    judged(result.verdicts, null);
  } else {
    for (const round of rounds) {
      calls.push(callRow(round.call, { subject, round: round.round }, "generator", null));
      judged(round.verdicts, round.round);
    }
    // A round that broke before it was judged left only its generator call, after the judged rounds' in `production`.
    production.slice(rounds.length).forEach((call, index) => calls.push(callRow(call, { subject, round: rounds.length + index }, "generator", null)));
  }
  return { calls, verdicts };
}

/**
 * The record of a run, the same for a run finishing now and for one in the
 * history: `localDeveloper` stands in when the run recorded no developer.
 */
export function buildRecord(source: RecordSource, localDeveloper: string): RunRecord {
  const versions = source.run.judge_versions;
  const versionOf = (id: string) => versions[id] ?? null;
  const calls: CallRow[] = [];
  const verdicts: VerdictRow[] = [];
  source.results.forEach((result, subject) => {
    const rows = subjectRows(result, subject, versionOf);
    calls.push(...rows.calls);
    verdicts.push(...rows.verdicts);
  });
  const unversioned = verdicts.some((row) => row.tier === "judge" && (row.status === "pass" || row.status === "fail") && row.judge_version === null);
  return RunRecordSchema.parse({
    schema_version: RECORD_SCHEMA_VERSION,
    result_version: source.result_version,
    run: { ...source.run, developer: source.run.developer ?? localDeveloper },
    exit_code: source.exit_code,
    comparable: source.run.tree_clean === true && !unversioned,
    subjects: source.results.map((result) => ({
      kind: result.subject.kind,
      id: result.subject.id,
      passed: result.summary.passed,
      rounds: result.rounds && result.rounds.length > 0 ? result.rounds.length : null,
      run_error_stage: result.run_error?.stage ?? null,
    })),
    calls,
    verdicts,
  });
}

/** Writes `record` as `record.json` in `runDir`; refuses one that does not match the schema, and never replaces one already there. */
export function writeRecord(runDir: string, record: RunRecord): RunRecord {
  const checked = RunRecordSchema.parse(record);
  fs.writeFileSync(path.join(runDir, RECORD_FILE), `${JSON.stringify(checked, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return checked;
}

/** Reads a run's `record.json` and checks it. */
export function readRecord(runDir: string): RunRecord {
  return RunRecordSchema.parse(JSON.parse(fs.readFileSync(path.join(runDir, RECORD_FILE), "utf8")));
}
