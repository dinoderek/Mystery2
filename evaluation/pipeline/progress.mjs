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
// cli-runner.mjs). These helpers tail those files and emit a compact,
// human-readable digest plus a heartbeat so a long-running step isn't silent.
//
// Everything here is best-effort: unparseable lines and unknown event shapes
// are ignored, and a missing stream file is fine (the wrapper creates it once
// claude starts). Nothing here affects the result contract.

const DEFAULT_POLL_MS = 700;
// How often the heartbeat fires when a step is otherwise quiet. Overridable via
// EVAL_HEARTBEAT_MS (e.g. lower it for tests/demos, raise it to reduce noise).
const DEFAULT_HEARTBEAT_MS =
  Number(process.env.EVAL_HEARTBEAT_MS) > 0
    ? Number(process.env.EVAL_HEARTBEAT_MS)
    : 20000;

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
  }
  return out;
}

// Incrementally read newly-appended complete JSONL lines from every file in
// `dir` whose basename satisfies `match`, invoking onEvent for each parsed
// object. Returns a stop() handle. Handles files that don't exist yet, files
// that appear later (e.g. a retry attempt's stream), and partial trailing lines.
export function followDir(dir, match, onEvent, { pollMs = DEFAULT_POLL_MS } = {}) {
  const state = new Map(); // file -> { offset, buf }
  let stopped = false;
  let timer = null;

  const drain = (file) => {
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
            onEvent(JSON.parse(line));
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

  const tick = () => {
    if (stopped) return;
    let names = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (match(name)) drain(path.join(dir, name));
    }
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
      // Final drain so the tail of a just-finished step isn't dropped.
      try {
        let names = fs.readdirSync(dir);
        for (const name of names) if (match(name)) drain(path.join(dir, name));
      } catch {
        // dir may be gone; nothing to flush
      }
    },
  };
}

// Match a step's stream files, including attempt-suffixed retries, e.g.
// streamMatch("generate") matches generate.stream.jsonl and
// generate.attempt-2.stream.jsonl.
export function streamMatch(stepPrefix) {
  return (name) => name.startsWith(stepPrefix) && name.endsWith(".stream.jsonl");
}

// Progress for a single, serial step (e.g. generate): an inline event digest
// from the step's stream file plus a heartbeat that fires only when the digest
// has been quiet, so it never spams an actively-working step. Returns stop().
export function startStepDigest({
  label,
  logDir,
  stepPrefix,
  quiet = false,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
}) {
  if (quiet) return { stop() {} };
  const startedAt = performance.now();
  let lastActivityAt = startedAt;

  const follower = followDir(logDir, streamMatch(stepPrefix), (ev) => {
    for (const line of formatEvents(ev)) {
      lastActivityAt = performance.now();
      write(`  ${line}`);
    }
  });

  const hb = setInterval(() => {
    if (performance.now() - lastActivityAt < heartbeatMs) return;
    write(`[eval] ${label}: running ${formatDuration(performance.now() - startedAt)}…`);
    lastActivityAt = performance.now();
  }, heartbeatMs);
  if (hb.unref) hb.unref();

  return {
    stop() {
      follower.stop();
      clearInterval(hb);
    },
  };
}

// Progress for a parallel phase (e.g. all dimensions at once): a single
// heartbeat that prints a caller-supplied status summary. No inline per-item
// digest — interleaving many streams is unreadable; callers print per-item tail
// paths instead. Returns stop().
export function startPhaseHeartbeat({
  status,
  quiet = false,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
}) {
  if (quiet) return { stop() {} };
  const hb = setInterval(() => {
    const line = status();
    if (line) write(line);
  }, heartbeatMs);
  if (hb.unref) hb.unref();
  return {
    stop() {
      clearInterval(hb);
    },
  };
}
