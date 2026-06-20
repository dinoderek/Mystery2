import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { performance } from "node:perf_hooks";

import { formatDuration } from "./timing.mjs";

// Live-progress helpers for the evaluation pipelines.
//
// The agent wrappers run `claude --output-format stream-json --verbose` and
// redirect the event stream to a per-step `.stream.jsonl` file under the run's
// logs/ directory (the pipeline picks the path via EVAL_STREAM_FILE; see
// cli-runner.mjs). These helpers tail those files and emit a *batched* tick on
// a fixed interval: a one-line header with elapsed time and the running
// estimated-thinking-token total, followed by the digest messages that
// accumulated since the last tick (capped). When nothing new happened the tick
// is a single "no new activity" line — the climbing token total still shows the
// step is alive.
//
// Everything here is best-effort: unparseable lines and unknown event shapes
// are ignored, and a missing stream file is fine (the wrapper creates it once
// claude starts). Nothing here affects the result contract.

const DEFAULT_POLL_MS = 700;
// How often a tick fires. Overridable via EVAL_HEARTBEAT_MS (lower it for
// tests/demos, raise it to reduce noise).
const DEFAULT_TICK_MS =
  Number(process.env.EVAL_HEARTBEAT_MS) > 0
    ? Number(process.env.EVAL_HEARTBEAT_MS)
    : 20000;
const DEFAULT_STEP_CAP = 8; // digest bullets per tick for a single step
const DEFAULT_JUDGE_CAP = 3; // digest bullets per judge per tick

function write(line) {
  process.stdout.write(`${line}\n`);
}

function firstLine(text, max = 100) {
  const line = String(text).trim().split("\n", 1)[0] ?? "";
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// A short hint for a tool_use block — the file it touches or the command it
// runs — so the digest reads like "> Tool: Edit (blueprint.json)".
function toolHint(block) {
  const input = block?.input;
  if (!input || typeof input !== "object") return "";
  if (typeof input.file_path === "string") return path.basename(input.file_path);
  if (typeof input.path === "string") return path.basename(input.path);
  if (typeof input.command === "string") return firstLine(input.command, 60);
  if (typeof input.pattern === "string") return firstLine(input.pattern, 60);
  return "";
}

// Compact token rendering: 39400 → "39.4k tok", 410000 → "410k tok".
export function formatTokens(n) {
  if (!Number.isFinite(n) || n <= 0) return "0 tok";
  if (n < 1000) return `${n} tok`;
  const k = n / 1000;
  return `${k < 100 ? k.toFixed(1) : Math.round(k)}k tok`;
}

// The estimated-thinking-token delta for one event (0 if not such an event).
// The cumulative `estimated_tokens` field resets mid-step, so summing the
// deltas is the only correct running total.
export function thinkingTokenDelta(ev) {
  if (ev && ev.type === "system" && ev.subtype === "thinking_tokens") {
    const d = Number(ev.estimated_tokens_delta);
    return Number.isFinite(d) ? d : 0;
  }
  return 0;
}

// Turn one stream-json event into zero or more digest lines.
export function formatEvents(ev) {
  const out = [];
  if (!ev || typeof ev !== "object") return out;
  if (ev.type === "assistant" && Array.isArray(ev.message?.content)) {
    for (const b of ev.message.content) {
      if (b?.type === "text" && b.text?.trim()) {
        out.push(`> ${firstLine(b.text)}`);
      } else if (b?.type === "tool_use" && b.name) {
        const hint = toolHint(b);
        out.push(`> Tool: ${b.name}${hint ? ` (${hint})` : ""}`);
      }
    }
  } else if (ev.type === "result" && ev.num_turns != null) {
    out.push(`> agent done — ${ev.num_turns} turn(s)`);
  } else if (ev.type === "rate_limit_event") {
    const status = ev.rate_limit_info?.status;
    if (status && status !== "allowed") out.push(`> ⚠ rate limit: ${status}`);
  }
  return out;
}

// Incrementally read newly-appended complete JSONL lines from every file in
// `dir` whose basename satisfies `match`, invoking onEvent(parsed, fileName)
// for each parsed object. Returns a stop() handle. Handles files that don't
// exist yet, files that appear later (e.g. a retry attempt's stream), and
// partial trailing lines.
export function followDir(dir, match, onEvent, { pollMs = DEFAULT_POLL_MS } = {}) {
  const state = new Map(); // file -> { offset, buf }
  let stopped = false;
  let timer = null;

  const drain = (file, name) => {
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      return;
    }
    const s = state.get(file) ?? { offset: 0, buf: "" };
    if (st.size <= s.offset) {
      state.set(file, s);
      return;
    }
    let fd;
    try {
      fd = fs.openSync(file, "r");
    } catch {
      return;
    }
    try {
      const len = st.size - s.offset;
      const b = Buffer.allocUnsafe(len);
      fs.readSync(fd, b, 0, len, s.offset);
      s.offset = st.size;
      s.buf += b.toString("utf8");
      let nl;
      while ((nl = s.buf.indexOf("\n")) >= 0) {
        const line = s.buf.slice(0, nl).trim();
        s.buf = s.buf.slice(nl + 1);
        if (line) {
          try {
            onEvent(JSON.parse(line), name);
          } catch {
            // ignore non-JSON / partial lines
          }
        }
      }
    } finally {
      fs.closeSync(fd);
    }
    state.set(file, s);
  };

  const sweep = () => {
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (match(name)) drain(path.join(dir, name), name);
    }
  };

  const tick = () => {
    if (stopped) return;
    sweep();
    schedule();
  };

  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(tick, pollMs);
    if (timer.unref) timer.unref();
  };

  schedule();
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      sweep(); // final drain so a just-finished step's tail isn't dropped
    },
  };
}

// Match a step's stream files, including attempt-suffixed retries, e.g.
// streamMatch("generate") matches generate.stream.jsonl and
// generate.attempt-2.stream.jsonl.
export function streamMatch(stepPrefix) {
  return (name) => name.startsWith(stepPrefix) && name.endsWith(".stream.jsonl");
}

// Batched progress for a single serial step (e.g. generate). Every interval it
// prints one header line (elapsed + running token total) and the digest
// messages accumulated since the last tick, capped. Returns stop().
export function startStepDigest({
  label,
  tag = "[eval]",
  logDir,
  stepPrefix,
  quiet = false,
  intervalMs = DEFAULT_TICK_MS,
  cap = DEFAULT_STEP_CAP,
}) {
  if (quiet) return { stop() {} };
  const startedAt = performance.now();
  let pending = [];
  let tokens = 0;

  const follower = followDir(logDir, streamMatch(stepPrefix), (ev) => {
    tokens += thinkingTokenDelta(ev);
    for (const line of formatEvents(ev)) pending.push(line);
  });

  const flush = () => {
    const elapsed = formatDuration(performance.now() - startedAt);
    const head = `${tag} ${label} · ${elapsed} · ${formatTokens(tokens)}`;
    if (pending.length === 0) {
      write(`${head} · no new activity`);
      return;
    }
    write(head);
    for (const line of pending.slice(0, cap)) write(`  ${line}`);
    if (pending.length > cap) write(`  +${pending.length - cap} more`);
    pending = [];
  };

  const timer = setInterval(flush, intervalMs);
  if (timer.unref) timer.unref();

  return {
    stop() {
      follower.stop();
      clearInterval(timer);
      if (pending.length) flush(); // show the tail before the step's done line
    },
  };
}

// Batched progress for a parallel judge phase. One tick prints a header
// (elapsed + done/total) and, for each still-running dimension, a sub-header
// (its token total) plus up to `capPerJudge` new digest messages. Completed
// dimensions drop out (their pass/fail line is printed by the pipeline). The
// pipeline calls markDone(id) as each dimension lands. Returns { markDone, stop }.
export function startJudgeDigest({
  dimIds,
  total = dimIds.length,
  tag = "[eval]",
  label = "dimensions",
  logDir,
  quiet = false,
  intervalMs = DEFAULT_TICK_MS,
  capPerJudge = DEFAULT_JUDGE_CAP,
}) {
  if (quiet) return { markDone() {}, stop() {} };
  const startedAt = performance.now();
  const state = new Map(
    dimIds.map((id) => [id, { pending: [], tokens: 0, done: false }]),
  );

  const matchJudge = (name) =>
    name.startsWith("judge-") && name.endsWith(".stream.jsonl");
  const dimOf = (name) => {
    const rest = name.slice("judge-".length);
    return dimIds.find((id) => rest.startsWith(`${id}.`));
  };

  const follower = followDir(logDir, matchJudge, (ev, name) => {
    const id = dimOf(name);
    if (!id) return;
    const s = state.get(id);
    if (!s) return;
    s.tokens += thinkingTokenDelta(ev);
    for (const line of formatEvents(ev)) s.pending.push(line);
  });

  const doneCount = () => [...state.values()].filter((s) => s.done).length;

  const flush = () => {
    const elapsed = formatDuration(performance.now() - startedAt);
    write(`${tag} ${label} · ${elapsed} · ${doneCount()}/${total} done`);
    for (const id of dimIds) {
      const s = state.get(id);
      if (s.done) continue;
      const head = `  ${id} · ${formatTokens(s.tokens)}`;
      if (s.pending.length === 0) {
        write(`${head} · no new activity`);
        continue;
      }
      write(head);
      for (const line of s.pending.slice(0, capPerJudge)) write(`    ${line}`);
      if (s.pending.length > capPerJudge) {
        write(`    +${s.pending.length - capPerJudge} more`);
      }
      s.pending = [];
    }
  };

  const timer = setInterval(flush, intervalMs);
  if (timer.unref) timer.unref();

  return {
    markDone(id) {
      const s = state.get(id);
      if (s) s.done = true;
    },
    stop() {
      follower.stop();
      clearInterval(timer);
    },
  };
}
