/**
 * Progress reporting for long model calls.
 *
 * A wrapper may stream its CLI's events, one JSON object per line, to the
 * `EVAL_STREAM_FILE` the runner hands it (`runner.ts`). A digest tails the
 * stream files in a log folder and, every interval, prints one line with the
 * elapsed time and the running estimated-thinking-token total, then the
 * messages since the last tick (capped). A quiet interval prints
 * `· no new activity`. Everything here is best effort: an unparseable line, an
 * unknown event or a missing file is ignored, and nothing here affects a
 * result.
 */

import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";

/** How often a tick prints, unless `EVAL_HEARTBEAT_MS` says otherwise. */
export const DEFAULT_TICK_MS = 20_000;
const POLL_MS = 700;

export type Write = (line: string) => void;

const stdoutWrite: Write = (line) => {
  process.stdout.write(`${line}\n`);
};

export function tickInterval(env: NodeJS.ProcessEnv = process.env): number {
  const fromEnv = Number(env.EVAL_HEARTBEAT_MS);
  return fromEnv > 0 ? fromEnv : DEFAULT_TICK_MS;
}

/** `840ms`, `1.2s`, `2m05s`. */
export function formatDuration(ms: number): string {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value}ms`;
  const totalSeconds = value / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  let minutes = Math.floor(totalSeconds / 60);
  let seconds = Math.round(totalSeconds - minutes * 60);
  if (seconds === 60) {
    minutes += 1;
    seconds = 0;
  }
  return `${minutes}m${String(seconds).padStart(2, "0")}s`;
}

/** `39400` → `39.4k tok`, `410000` → `410k tok`. */
export function formatTokens(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 tok";
  if (n < 1000) return `${n} tok`;
  const k = n / 1000;
  return `${k < 100 ? k.toFixed(1) : Math.round(k)}k tok`;
}

type StreamEvent = Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The estimated-thinking-token delta one event adds. The cumulative field
 * resets within a call, so summing the deltas is the only correct total.
 */
export function thinkingTokenDelta(event: StreamEvent): number {
  if (event.type !== "system" || event.subtype !== "thinking_tokens") return 0;
  const delta = Number(event.estimated_tokens_delta);
  return Number.isFinite(delta) ? delta : 0;
}

function firstLine(text: unknown, max = 100): string {
  const line = String(text).trim().split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function toolHint(input: Record<string, unknown> | null): string {
  if (!input) return "";
  if (typeof input.file_path === "string") return path.basename(input.file_path);
  if (typeof input.path === "string") return path.basename(input.path);
  if (typeof input.command === "string") return firstLine(input.command, 60);
  if (typeof input.pattern === "string") return firstLine(input.pattern, 60);
  return "";
}

function assistantLines(event: StreamEvent): string[] {
  const content = asRecord(event.message)?.content;
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const item of content) {
    const block = asRecord(item);
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      lines.push(`> ${firstLine(block.text)}`);
    } else if (block?.type === "tool_use" && typeof block.name === "string") {
      const hint = toolHint(asRecord(block.input));
      lines.push(`> Tool: ${block.name}${hint ? ` (${hint})` : ""}`);
    }
  }
  return lines;
}

/** The digest lines one stream event contributes. */
export function formatEvent(event: StreamEvent): string[] {
  if (event.type === "assistant") return assistantLines(event);
  if (event.type === "result" && event.num_turns != null) return [`> agent done — ${event.num_turns} turn(s)`];
  if (event.type === "rate_limit_event") {
    const status = asRecord(event.rate_limit_info)?.status;
    if (status && status !== "allowed") return [`> ⚠ rate limit: ${status}`];
  }
  return [];
}

interface FileCursor {
  offset: number;
  buffer: string;
}

function readAppended(file: string, cursor: FileCursor): string[] {
  let size: number;
  try {
    size = fs.statSync(file).size;
  } catch {
    return [];
  }
  if (size <= cursor.offset) return [];
  const fd = fs.openSync(file, "r");
  try {
    const chunk = Buffer.alloc(size - cursor.offset);
    fs.readSync(fd, chunk, 0, chunk.length, cursor.offset);
    cursor.offset = size;
    cursor.buffer += chunk.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const lines = cursor.buffer.split("\n");
  cursor.buffer = lines.pop() ?? "";
  return lines.map((line) => line.trim()).filter(Boolean);
}

/**
 * Calls `onEvent` for each complete JSON line appended to any file in `dir`
 * whose name `match` accepts, including files that appear later. `stop()`
 * drains once more, so a finished call's last events are not dropped.
 */
export function followStreams(
  dir: string,
  match: (name: string) => boolean,
  onEvent: (event: StreamEvent, file: string) => void,
  pollMs = POLL_MS,
): { stop(): void } {
  const cursors = new Map<string, FileCursor>();
  const sweep = () => {
    let names: string[];
    try {
      names = fs.readdirSync(dir).filter(match);
    } catch {
      return;
    }
    for (const name of names) {
      const cursor = cursors.get(name) ?? { offset: 0, buffer: "" };
      cursors.set(name, cursor);
      for (const line of readAppended(path.join(dir, name), cursor)) {
        try {
          const event = asRecord(JSON.parse(line));
          if (event) onEvent(event, name);
        } catch {
          // Not JSON: ignored.
        }
      }
    }
  };
  const timer = setInterval(sweep, pollMs);
  timer.unref();
  return {
    stop() {
      clearInterval(timer);
      sweep();
    },
  };
}

/** Matches one step's stream files across its attempts: `<step>.attempt-<n>.stream.jsonl`. */
export function streamFilesOf(step: string): (name: string) => boolean {
  return (name) => name.startsWith(`${step}.`) && name.endsWith(".stream.jsonl");
}

export interface DigestOptions {
  /** The log folder the runner writes the calls' stream files to. */
  logDir: string;
  tag?: string;
  quiet?: boolean;
  intervalMs?: number;
  write?: Write;
}

interface Track {
  pending: string[];
  tokens: number;
  done: boolean;
}

function flushLines(lines: string[], cap: number, indent: string, write: Write): void {
  for (const line of lines.slice(0, cap)) write(`${indent}${line}`);
  if (lines.length > cap) write(`${indent}+${lines.length - cap} more`);
}

/**
 * Progress for one call, or for several running at once. Each step is
 * reported under its own name until `markDone(step)`; with one step, its
 * messages print straight under the tick line.
 */
export function startDigest(
  label: string,
  steps: readonly string[],
  { logDir, tag = "[eval]", quiet = false, intervalMs = tickInterval(), write = stdoutWrite }: DigestOptions,
): { markDone(step: string): void; stop(): void } {
  if (quiet) return { markDone() {}, stop() {} };
  const startedAt = performance.now();
  const tracks = new Map<string, Track>(steps.map((step) => [step, { pending: [], tokens: 0, done: false }]));
  const stepOf = (file: string) => steps.find((step) => streamFilesOf(step)(file));
  const follower = followStreams(
    logDir,
    (name) => stepOf(name) !== undefined,
    (event, file) => {
      const track = tracks.get(stepOf(file) as string) as Track;
      track.tokens += thinkingTokenDelta(event);
      track.pending.push(...formatEvent(event));
    },
  );
  const single = steps.length === 1;

  const flush = () => {
    const elapsed = formatDuration(performance.now() - startedAt);
    if (single) {
      const track = tracks.get(steps[0]) as Track;
      const head = `${tag} ${label} · ${elapsed} · ${formatTokens(track.tokens)}`;
      write(track.pending.length === 0 ? `${head} · no new activity` : head);
      flushLines(track.pending, 8, "  ", write);
      track.pending = [];
      return;
    }
    const done = [...tracks.values()].filter((track) => track.done).length;
    write(`${tag} ${label} · ${elapsed} · ${done}/${steps.length} done`);
    for (const [step, track] of tracks) {
      if (track.done) continue;
      const head = `  ${step} · ${formatTokens(track.tokens)}`;
      write(track.pending.length === 0 ? `${head} · no new activity` : head);
      flushLines(track.pending, 3, "    ", write);
      track.pending = [];
    }
  };

  const timer = setInterval(flush, intervalMs);
  timer.unref();
  return {
    markDone(step) {
      const track = tracks.get(step);
      if (track) track.done = true;
    },
    stop() {
      follower.stop();
      clearInterval(timer);
      if (single && (tracks.get(steps[0]) as Track).pending.length > 0) flush();
    },
  };
}
