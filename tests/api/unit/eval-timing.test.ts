import { describe, expect, it } from "vitest";

import { buildEnvelope } from "../../../evaluation/pipeline/envelope.mjs";
import {
  createRunTimer,
  formatDuration,
  formatTimingSummary,
} from "../../../evaluation/pipeline/timing.mjs";

describe("formatDuration", () => {
  it("renders sub-second values in whole milliseconds", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(7.4)).toBe("7ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("renders seconds with one decimal under a minute", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(1540)).toBe("1.5s");
    expect(formatDuration(59900)).toBe("59.9s");
  });

  it("renders minutes with zero-padded seconds at or above a minute", () => {
    expect(formatDuration(60000)).toBe("1m00s");
    expect(formatDuration(125000)).toBe("2m05s");
  });

  it("carries a 60s rounding boundary up to the next minute", () => {
    expect(formatDuration(119600)).toBe("2m00s");
  });

  it("never returns a negative duration", () => {
    expect(formatDuration(-5)).toBe("0ms");
  });
});

describe("createRunTimer stages", () => {
  it("records stages in order with non-negative durations and details", async () => {
    const timer = createRunTimer();
    await timer.stage("load_spec", async () => "brief");
    await timer.stage(
      "mechanical",
      async () => [1, 2, 3],
      (checks: unknown[]) => ({ checks: checks.length }),
    );

    const timing = timer.summarize();
    expect(timing.clock).toBe("monotonic");
    expect(typeof timing.total_ms).toBe("number");
    expect(timing.stages.map((s: { name: string }) => s.name)).toEqual([
      "load_spec",
      "mechanical",
    ]);
    for (const stage of timing.stages) {
      expect(stage.duration_ms).toBeGreaterThanOrEqual(0);
    }
    expect(timing.stages[1].detail).toEqual({ checks: 3 });
  });

  it("returns the resolved value of the timed fn", async () => {
    const timer = createRunTimer();
    const value = await timer.stage("load_spec", async () => ({ ok: true }));
    expect(value).toEqual({ ok: true });
  });

  it("records a failed stage and tags the error with the stage name", async () => {
    const timer = createRunTimer();
    await expect(
      timer.stage("generate", async () => {
        throw new Error("boom");
      }),
    ).rejects.toMatchObject({ runErrorStage: "generate" });

    const timing = timer.summarize();
    expect(timing.stages).toHaveLength(1);
    expect(timing.stages[0]).toMatchObject({ name: "generate", failed: true });
  });

  it("does not overwrite an existing runErrorStage tag", async () => {
    const timer = createRunTimer();
    const tagged: Error & { runErrorStage?: string } = new Error(
      "already tagged",
    );
    tagged.runErrorStage = "load_spec";
    await expect(
      timer.stage("generate", async () => {
        throw tagged;
      }),
    ).rejects.toMatchObject({ runErrorStage: "load_spec" });
  });
});

describe("createRunTimer dimensions", () => {
  it("records per-dimension sub-steps and sorts dimensions by id", async () => {
    const timer = createRunTimer();

    const solvability = timer.dimension("solvability");
    await solvability.step("load_definition", async () => null);
    await solvability.step(
      "judge",
      async () => ({ attempts: [1] }),
      (outcome: { attempts: unknown[] }) => ({
        attempts: outcome.attempts.length,
      }),
    );
    solvability.finalize();

    const coherence = timer.dimension("coherence");
    coherence.finalize();

    const timing = timer.summarize();
    expect(timing.dimensions.map((d: { id: string }) => d.id)).toEqual([
      "coherence",
      "solvability",
    ]);
    const dim = timing.dimensions.find(
      (d: { id: string }) => d.id === "solvability",
    );
    expect(dim.steps.map((s: { name: string }) => s.name)).toEqual([
      "load_definition",
      "judge",
    ]);
    expect(dim.steps[1].detail).toEqual({ attempts: 1 });
    expect(dim.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it("is idempotent when finalize is called more than once", () => {
    const timer = createRunTimer();
    const dim = timer.dimension("fairness");
    dim.finalize();
    dim.finalize();
    expect(timer.summarize().dimensions).toHaveLength(1);
  });
});

describe("formatTimingSummary", () => {
  it("includes the total, stage names, and dimension steps", async () => {
    const timer = createRunTimer();
    await timer.stage("load_spec", async () => null);
    const dim = timer.dimension("solvability");
    await dim.step("judge", async () => null);
    dim.finalize();

    const summary = formatTimingSummary(timer.summarize());
    expect(summary).toContain("[eval] timing — total");
    expect(summary).toContain("load_spec");
    expect(summary).toContain("solvability");
    expect(summary).toContain("judge");
  });
});

describe("buildEnvelope timing", () => {
  const base = {
    runId: "r1",
    startedAt: "2026-05-31T00:00:00.000Z",
    endedAt: "2026-05-31T00:01:00.000Z",
    specDir: "evaluation/specs/001",
    blueprintPath: "/tmp/blueprint.json",
    generation: null,
    mechanical: [],
    dimensions: [],
  };

  it("stamps schema_version 0.3 and embeds the timing block", () => {
    const timing = {
      total_ms: 123,
      clock: "monotonic",
      stages: [],
      dimensions: [],
    };
    const envelope = buildEnvelope({ ...base, timing });
    expect(envelope.schema_version).toBe("0.3");
    expect(envelope.timing).toBe(timing);
  });

  it("defaults timing to null when omitted", () => {
    const envelope = buildEnvelope({ ...base });
    expect(envelope.timing).toBeNull();
  });
});
