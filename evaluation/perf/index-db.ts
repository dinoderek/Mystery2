/**
 * The local performance index: `<output root>/perf.db`, built by `perf sync`
 * from run records and rebuilt whole each time, so it holds nothing a run folder
 * or the data repository does not. There are no migrations: a schema change
 * deletes the file and syncs again.
 *
 * | Table      | One row per | Holds |
 * | ---------- | ----------- | ----- |
 * | `runs`     | run | The run block's identity and attributes, its loop, where the record came from (`source`), `comparable`, and the order each prompt version was first seen in |
 * | `subjects` | subject of a run | Kind, id, `passed`, rounds, the stage a run broke at |
 * | `calls`    | model call | Role, judge and version, binding, model, duration, cost, the four token counts, attempts, outcome |
 * | `verdicts` | verdict | Id, tier, status, judge version, finding count |
 *
 * A run is `runs.run`, a number given in start-time order; the others name it
 * with `run` and their subject by its `position`. A field a record lacks (a
 * result version before it was recorded) is NULL. `attributes` is the run's
 * suite attributes as JSON, for `json_extract`.
 *
 * The file is written beside `perf.db` and renamed over it, so a failed build
 * leaves the last index as it was.
 */

import fs from "node:fs";
import path from "node:path";

import { openPlainDatabase } from "../../packages/game-engine/src/db/client.ts";
import type { Db, SqlValue } from "../../packages/game-engine/src/db/client.ts";
import type { RunRecord } from "./record.ts";

export const INDEX_FILE = "perf.db";

export const LOOPS = ["blueprint", "narration"] as const;
export type Loop = (typeof LOOPS)[number];

/** Where a record was read from; `both` when the run's folder is here and its record is in the data repository too. */
export type RecordSource = "local" | "shared" | "both";

/** The loop a command belongs to; null for a command that is in neither. */
export function loopOf(command: string): Loop | null {
  if (command === "generate" || command === "judge blueprint") return "blueprint";
  if (command === "judge turn" || command === "play" || command === "judge game") return "narration";
  return null;
}

export interface IndexedRun {
  record: RunRecord;
  source: RecordSource;
}

export interface IndexCounts {
  runs: number;
  subjects: number;
  calls: number;
  verdicts: number;
}

const SCHEMA = `
create table runs (
  run integer primary key,
  run_id text not null,
  developer text not null,
  host text,
  command text not null,
  loop text not null,
  source text not null,
  started_at text not null,
  ended_at text,
  commit_sha text,
  tree_clean integer,
  exit_code integer,
  comparable integer not null,
  result_version text not null,
  suite text,
  label text,
  parent_run text,
  narrator_prompt text,
  narrator_prompt_seq integer,
  generator_prompt text,
  generator_prompt_seq integer,
  attributes text,
  unique (developer, run_id)
);
create index runs_loop on runs (loop, started_at);
create index runs_suite on runs (suite);

create table subjects (
  run integer not null references runs (run),
  position integer not null,
  kind text not null,
  subject_id text not null,
  passed integer not null,
  rounds integer,
  run_error_stage text,
  primary key (run, position)
);

create table calls (
  run integer not null references runs (run),
  n integer not null,
  subject integer not null,
  round integer,
  role text not null,
  judge text,
  judge_version integer,
  binding text not null,
  model text,
  duration_ms integer not null,
  cost_usd real,
  tokens_input integer,
  tokens_output integer,
  tokens_cache_read integer,
  tokens_cache_write integer,
  attempts integer not null,
  outcome text not null,
  primary key (run, n)
);
create index calls_role_model on calls (role, model);

create table verdicts (
  run integer not null references runs (run),
  n integer not null,
  subject integer not null,
  round integer,
  verdict text not null,
  tier text not null,
  status text not null,
  judge_version integer,
  findings integer,
  primary key (run, n)
);
create index verdicts_judge on verdicts (verdict, judge_version);
`;

function flag(value: boolean | null): number | null {
  return value === null ? null : value ? 1 : 0;
}

/** Start-time order, then developer and id: the order runs are numbered in and prompt versions first seen in. */
function byStart(a: IndexedRun, b: IndexedRun): number {
  const x = a.record.run;
  const y = b.record.run;
  return x.started_at.localeCompare(y.started_at) || x.developer.localeCompare(y.developer) || x.id.localeCompare(y.id);
}

/** Each distinct version's place among the versions of `pick`, by the first run that has it, from 1. */
function firstSeenOrder(runs: readonly IndexedRun[], pick: (run: RunRecord["run"]) => string | undefined): Map<string, number> {
  const order = new Map<string, number>();
  for (const { record } of runs) {
    const version = pick(record.run);
    if (version !== undefined && !order.has(version)) order.set(version, order.size + 1);
  }
  return order;
}

function insertRun(db: Db, run: number, { record, source }: IndexedRun, orders: { narrator: Map<string, number>; generator: Map<string, number> }): void {
  const info = record.run;
  const narrator = info.prompt_versions?.narrator ?? null;
  const generator = info.prompt_versions?.generator ?? null;
  db.prepare(`insert into runs values (${new Array(22).fill("?").join(", ")})`).run(
    run,
    info.id,
    info.developer,
    info.host,
    info.command,
    loopOf(info.command) as Loop,
    source,
    info.started_at,
    info.ended_at,
    info.commit,
    flag(info.tree_clean),
    record.exit_code,
    flag(record.comparable),
    record.result_version,
    info.suite,
    info.label,
    info.parent_run,
    narrator,
    narrator === null ? null : (orders.narrator.get(narrator) ?? null),
    generator,
    generator === null ? null : (orders.generator.get(generator) ?? null),
    info.attributes === null ? null : JSON.stringify(info.attributes),
  );
  const subject = db.prepare("insert into subjects values (?, ?, ?, ?, ?, ?, ?)");
  record.subjects.forEach((each, position) => subject.run(run, position, each.kind, each.id, flag(each.passed), each.rounds, each.run_error_stage));
  const call = db.prepare(`insert into calls values (${new Array(17).fill("?").join(", ")})`);
  record.calls.forEach((each, n) => {
    const tokens: SqlValue[] = each.tokens ? [each.tokens.input, each.tokens.output, each.tokens.cache_read, each.tokens.cache_write] : [null, null, null, null];
    call.run(run, n, each.subject, each.round, each.role, each.judge, each.judge_version, each.binding, each.model, each.duration_ms, each.cost_usd, ...tokens, each.attempts, each.outcome);
  });
  const verdict = db.prepare("insert into verdicts values (?, ?, ?, ?, ?, ?, ?, ?, ?)");
  record.verdicts.forEach((each, n) => verdict.run(run, n, each.subject, each.round, each.id, each.tier, each.status, each.judge_version, each.findings));
}

/**
 * Writes the index of `runs` to `file`, replacing any index there. Runs are
 * numbered in start-time order, so the same records give the same rows.
 */
export function buildIndex(file: string, runs: readonly IndexedRun[]): IndexCounts {
  const sorted = [...runs].sort(byStart);
  const orders = {
    narrator: firstSeenOrder(sorted, (run) => run.prompt_versions?.narrator),
    generator: firstSeenOrder(sorted, (run) => run.prompt_versions?.generator),
  };
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(temporary, { force: true });
  const db = openPlainDatabase(temporary);
  try {
    db.exec(SCHEMA);
    db.transaction(() => sorted.forEach((each, index) => insertRun(db, index + 1, each, orders)));
  } catch (error) {
    db.close();
    fs.rmSync(temporary, { force: true });
    throw error;
  }
  db.close();
  fs.renameSync(temporary, file);
  return {
    runs: sorted.length,
    subjects: sorted.reduce((sum, each) => sum + each.record.subjects.length, 0),
    calls: sorted.reduce((sum, each) => sum + each.record.calls.length, 0),
    verdicts: sorted.reduce((sum, each) => sum + each.record.verdicts.length, 0),
  };
}
