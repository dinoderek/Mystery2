import { performance } from "node:perf_hooks";

// Monotonic-clock timing for the evaluation pipeline.
//
// All durations here are measured with performance.now() — a monotonic clock
// that is immune to wall-clock/NTP jumps — and reported as integer
// milliseconds. The run's wall-clock boundaries (started_at / ended_at in the
// envelope) stay on Date; only durations use this module.
//
// The recorder is intentionally tiny: a flat list of named top-level stages
// plus a per-dimension child recorder. Stage/step order is preserved as
// recorded. It is safe to record from parallel async callbacks (e.g. the
// dimension Promise.all): Node runs them on a single thread, so each push is
// atomic and no interleaving can corrupt the arrays.

function roundMs(ms) {
  return Math.round(ms);
}

function record(entries, name, startedAt, { threw, result, detailFn }) {
  const entry = { name, duration_ms: roundMs(performance.now() - startedAt) };
  if (threw) {
    entry.failed = true;
  } else if (detailFn) {
    const detail = detailFn(result);
    if (detail && Object.keys(detail).length > 0) entry.detail = detail;
  }
  entries.push(entry);
  return entry;
}

// Times one async unit of work. Records its duration even when `fn` throws (so
// a stage that failed still shows how long it ran before failing). On throw,
// tags the error with `runErrorStage = name` unless already tagged — this
// subsumes the old taggedStage() helper. `detailFn` (optional) is called with
// fn's resolved value to compute a small `detail` object for the entry.
function timeInto(entries, name, fn, detailFn, tagErrors) {
  const startedAt = performance.now();
  let result;
  let threw = false;
  return Promise.resolve()
    .then(() => fn())
    .then(
      (value) => {
        result = value;
        return value;
      },
      (err) => {
        threw = true;
        if (tagErrors && err && !err.runErrorStage) err.runErrorStage = name;
        throw err;
      },
    )
    .finally(() => {
      record(entries, name, startedAt, { threw, result, detailFn });
    });
}

export function createRunTimer() {
  const runStartedAt = performance.now();
  const stages = [];
  const dimensions = [];

  // Time a top-level pipeline stage. Returns fn's resolved value.
  function stage(name, fn, detailFn = null) {
    return timeInto(stages, name, fn, detailFn, true);
  }

  // Duration of the most recently recorded top-level stage, for stdout.
  function lastStageMs() {
    return stages.length ? stages[stages.length - 1].duration_ms : 0;
  }

  // A child recorder for one dimension. Sub-steps are recorded in `steps`; the
  // dimension's own wall-clock total is captured on finalize().
  function dimension(id) {
    const dimStartedAt = performance.now();
    const steps = [];
    let finalized = false;

    function step(name, fn, detailFn = null) {
      // Dimension sub-steps don't tag errors: evaluateDimension catches and
      // attributes them to the right dimension stage itself.
      return timeInto(steps, name, fn, detailFn, false);
    }

    function lastStepMs() {
      return steps.length ? steps[steps.length - 1].duration_ms : 0;
    }

    // Wall-clock for the whole dimension so far (analyzer + prompt + judge).
    function totalMs() {
      return roundMs(performance.now() - dimStartedAt);
    }

    // Push this dimension's timing into the run. Idempotent; call from a
    // finally so even an early return (e.g. skipped) records an entry.
    function finalize() {
      if (finalized) return;
      finalized = true;
      dimensions.push({ id, duration_ms: totalMs(), steps });
    }

    return { step, lastStepMs, totalMs, finalize };
  }

  // The `timing` block embedded in the result envelope. Pure read of what was
  // recorded; dimensions are sorted by id for stable output.
  function summarize() {
    return {
      total_ms: roundMs(performance.now() - runStartedAt),
      clock: "monotonic",
      stages: stages.map((s) => ({ ...s })),
      dimensions: dimensions
        .slice()
        .sort((a, b) => a.id.localeCompare(b.id))
        .map((d) => ({ ...d, steps: d.steps.map((s) => ({ ...s })) })),
    };
  }

  return { stage, lastStageMs, dimension, summarize };
}

// Human-readable duration: "840ms", "1.2s", "2m05s".
export function formatDuration(ms) {
  const value = Math.max(0, Math.round(ms));
  if (value < 1000) return `${value}ms`;
  const totalSeconds = value / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  let seconds = Math.round(totalSeconds - minutes * 60);
  let carryMinutes = minutes;
  if (seconds === 60) {
    carryMinutes += 1;
    seconds = 0;
  }
  return `${carryMinutes}m${String(seconds).padStart(2, "0")}s`;
}

// A multi-line stdout summary of a `timing` block (the output of summarize()).
// Top-level stages first, then each dimension's sub-steps indented under a
// "dimensions" header. Names are column-aligned for readability.
export function formatTimingSummary(timing) {
  const lines = [];
  const stageNames = timing.stages.map((s) => s.name);
  const dimStepNames = timing.dimensions.flatMap((d) => [
    d.id,
    ...d.steps.map((s) => `  ${s.name}`),
  ]);
  const width = Math.max(
    0,
    ...stageNames.map((n) => n.length),
    ...dimStepNames.map((n) => n.length + 2),
  );

  lines.push(`[eval] timing — total ${formatDuration(timing.total_ms)}`);
  for (const s of timing.stages) {
    const detail = s.detail ? `  (${formatDetail(s.detail)})` : "";
    const failed = s.failed ? "  [failed]" : "";
    lines.push(
      `  ${s.name.padEnd(width)}  ${formatDuration(s.duration_ms)}${detail}${failed}`,
    );
  }
  for (const d of timing.dimensions) {
    lines.push(`  ${d.id.padEnd(width)}  ${formatDuration(d.duration_ms)}`);
    for (const s of d.steps) {
      const label = `  ${s.name}`;
      const detail = s.detail ? `  (${formatDetail(s.detail)})` : "";
      const failed = s.failed ? "  [failed]" : "";
      lines.push(
        `    ${label.padEnd(width - 2)}  ${formatDuration(s.duration_ms)}${detail}${failed}`,
      );
    }
  }
  return lines.join("\n");
}

function formatDetail(detail) {
  return Object.entries(detail)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
}
