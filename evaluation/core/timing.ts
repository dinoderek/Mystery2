/**
 * Stage timing for a command: a flat list of named stages, and a recorder per
 * dimension (or other unit run in parallel) with its own steps. Durations come
 * from a monotonic clock and are whole milliseconds; the run's wall-clock
 * boundaries stay on `Date` in `result.json`'s `run`.
 *
 * The timer is safe to use from parallel async callbacks: Node runs them on
 * one thread, so each push is atomic. A stage that throws is still recorded,
 * marked `failed`, and its error is tagged with `runErrorStage` so the
 * command can name the stage in `run_error`.
 */

import { performance } from "node:perf_hooks";

import { formatDuration } from "./progress.ts";

export interface TimingEntry {
  name: string;
  duration_ms: number;
  failed?: boolean;
  detail?: Record<string, unknown>;
}

export interface DimensionTiming {
  id: string;
  duration_ms: number;
  steps: TimingEntry[];
}

export interface Timing {
  total_ms: number;
  stages: TimingEntry[];
  dimensions: DimensionTiming[];
}

type DetailFn<T> = ((value: T) => Record<string, unknown> | null | undefined) | null;

export interface DimensionTimer {
  step<T>(name: string, fn: () => T | Promise<T>, detailFn?: DetailFn<T>): Promise<T>;
  lastStepMs(): number;
  /** Records this dimension's total once; call from a `finally`. */
  finalize(): void;
}

export interface RunTimer {
  stage<T>(name: string, fn: () => T | Promise<T>, detailFn?: DetailFn<T>): Promise<T>;
  lastStageMs(): number;
  dimension(id: string): DimensionTimer;
  summarize(): Timing;
}

/** An error that carries the stage it happened in. */
export type StageError = Error & { runErrorStage?: string };

async function timeInto<T>(
  entries: TimingEntry[],
  name: string,
  fn: () => T | Promise<T>,
  detailFn: DetailFn<T>,
  tagErrors: boolean,
): Promise<T> {
  const startedAt = performance.now();
  const entry: TimingEntry = { name, duration_ms: 0 };
  try {
    const value = await fn();
    const detail = detailFn?.(value);
    if (detail && Object.keys(detail).length > 0) entry.detail = detail;
    return value;
  } catch (error) {
    entry.failed = true;
    const tagged = error as StageError | null;
    if (tagErrors && tagged && !tagged.runErrorStage) tagged.runErrorStage = name;
    throw error;
  } finally {
    entry.duration_ms = Math.round(performance.now() - startedAt);
    entries.push(entry);
  }
}

export function createRunTimer(): RunTimer {
  const runStartedAt = performance.now();
  const stages: TimingEntry[] = [];
  const dimensions: DimensionTiming[] = [];
  const lastMs = (entries: TimingEntry[]) => (entries.length ? entries[entries.length - 1].duration_ms : 0);

  return {
    stage: (name, fn, detailFn = null) => timeInto(stages, name, fn, detailFn, true),
    lastStageMs: () => lastMs(stages),
    dimension(id) {
      const startedAt = performance.now();
      const steps: TimingEntry[] = [];
      let finalized = false;
      return {
        // A dimension's steps do not tag errors: its caller attributes them.
        step: (name, fn, detailFn = null) => timeInto(steps, name, fn, detailFn, false),
        lastStepMs: () => lastMs(steps),
        finalize() {
          if (finalized) return;
          finalized = true;
          dimensions.push({ id, duration_ms: Math.round(performance.now() - startedAt), steps });
        },
      };
    },
    summarize() {
      return {
        total_ms: Math.round(performance.now() - runStartedAt),
        stages: stages.map((s) => ({ ...s })),
        dimensions: dimensions
          .slice()
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((d) => ({ ...d, steps: d.steps.map((s) => ({ ...s })) })),
      };
    },
  };
}

function formatDetail(detail: Record<string, unknown>): string {
  return Object.entries(detail)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
}

function timingLine(indent: string, label: string, width: number, entry: Pick<TimingEntry, "duration_ms"> & Partial<TimingEntry>): string {
  const detail = entry.detail ? `  (${formatDetail(entry.detail)})` : "";
  const failed = entry.failed ? "  [failed]" : "";
  return `${indent}${label.padEnd(width)}  ${formatDuration(entry.duration_ms)}${detail}${failed}`;
}

/** A multi-line summary of a timing: the stages, then each dimension's steps under it. */
export function formatTimingSummary(timing: Omit<Timing, "dimensions"> & { dimensions?: DimensionTiming[] }): string {
  const dimensions = timing.dimensions ?? [];
  const width = Math.max(
    0,
    ...timing.stages.map((s) => s.name.length),
    ...dimensions.flatMap((d) => [d.id.length, ...d.steps.map((s) => s.name.length + 2)]),
  );
  const lines = [`[eval] timing — total ${formatDuration(timing.total_ms)}`];
  for (const stage of timing.stages) lines.push(timingLine("  ", stage.name, width, stage));
  for (const dimension of dimensions) {
    lines.push(timingLine("  ", dimension.id, width, dimension));
    for (const step of dimension.steps) lines.push(timingLine("    ", `  ${step.name}`, width - 2, step));
  }
  return lines.join("\n");
}
