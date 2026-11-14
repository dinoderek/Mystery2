import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMMON_OPTIONS, formatHelp, parseCommandArgs } from "../../../evaluation/core/args.ts";
import { listCommands, runEval } from "../../../evaluation/core/dispatch.ts";
import type { EvalCommand, EvalContext } from "../../../evaluation/core/dispatch.ts";
import { ConfigError, UsageError } from "../../../evaluation/core/errors.ts";
import { mapPool } from "../../../evaluation/core/pool.ts";
import {
  formatDuration,
  formatEvent,
  formatTokens,
  followStreams,
  startDigest,
  streamFilesOf,
  thinkingTokenDelta,
  tickInterval,
} from "../../../evaluation/core/progress.ts";

describe("mapPool", () => {
  it("never runs more than the limit at once, and keeps the items' order", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapPool([30, 5, 20, 1, 10, 2], 2, async (ms, index) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, ms));
      running -= 1;
      return `${index}:${ms}`;
    });
    expect(peak).toBe(2);
    expect(results).toEqual(["0:30", "1:5", "2:20", "3:1", "4:10", "5:2"]);
  });

  it("runs everything at once when the limit is above the count, and nothing for no items", async () => {
    let peak = 0;
    let running = 0;
    await mapPool([1, 2, 3], 10, async () => {
      running += 1;
      peak = Math.max(peak, running);
      await Promise.resolve();
      running -= 1;
    });
    expect(peak).toBe(3);
    expect(await mapPool([], 3, async () => 1)).toEqual([]);
  });

  it("starts nothing new after a failure, waits for what is running, and throws the first error", async () => {
    const started: number[] = [];
    let finished = 0;
    const pool = mapPool([0, 1, 2, 3, 4], 2, async (item) => {
      started.push(item);
      if (item === 0) throw new Error("first");
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished += 1;
      return item;
    });
    await expect(pool).rejects.toThrow("first");
    expect(started).toEqual([0, 1]);
    expect(finished).toBe(1);
  });

  it.each([0, -1, 1.5, Number.NaN])("refuses a limit of %s", async (limit) => {
    await expect(mapPool([1], limit, async () => 1)).rejects.toThrow(RangeError);
  });
});

describe("parseCommandArgs", () => {
  it("reads the common options every command takes", () => {
    const parsed = parseCommandArgs(
      ["--config", "c.json", "--output-root", "/tmp/out", "--model-override", "a=opus", "--model-override", "b=sonnet"],
    );
    expect(parsed.common).toEqual({
      help: false,
      configPath: "c.json",
      outputRoot: "/tmp/out",
      modelOverrides: { a: "opus", b: "sonnet" },
    });
    expect(parsed.values).toEqual({});
  });

  it("reads --help and -h, without checking the positionals", () => {
    const spec = { positionals: { min: 1, max: 1 } };
    expect(parseCommandArgs(["--help"], spec).common.help).toBe(true);
    expect(parseCommandArgs(["-h"], spec).common.help).toBe(true);
  });

  it("reads a command's own options and positionals beside the common ones", () => {
    const parsed = parseCommandArgs(["b.json", "--quiet", "--judges", "a,b"], {
      options: { quiet: { type: "boolean" }, judges: { type: "string" } },
      positionals: { min: 1, max: 1 },
    });
    expect(parsed.values).toEqual({ quiet: true, judges: "a,b" });
    expect(parsed.positionals).toEqual(["b.json"]);
  });

  it.each([
    [["--nope"], {}, /Unknown option '--nope'/],
    [["--config"], {}, /argument missing/],
    [["extra"], {}, /positional argument/],
    [[], { positionals: { min: 1, max: 2 } }, /at least 1 argument/],
    [["a", "b", "c"], { positionals: { min: 1, max: 2 } }, /at most 2 argument/],
    [["--model-override", "opus"], {}, /needs <binding>=<model>/],
  ])("is a usage error for %j", (argv, spec, message) => {
    expect(() => parseCommandArgs(argv as string[], spec)).toThrow(UsageError);
    expect(() => parseCommandArgs(argv as string[], spec)).toThrow(message);
  });

  it("refuses a command option that shadows a common one", () => {
    expect(() => parseCommandArgs([], { options: { config: { type: "boolean" } } })).toThrow(/common to every command/);
    expect(Object.keys(COMMON_OPTIONS)).toEqual(["help", "config", "output-root", "model-override"]);
  });

  it("formats a command's help with its options and the common ones", () => {
    const help = formatHelp({
      usage: "judge blueprint <file>",
      summary: "Judges a blueprint.",
      options: [["--quiet", "print less"]],
    });
    expect(help).toContain("Usage: ./dev eval judge blueprint <file> [options]");
    expect(help).toContain("--quiet");
    for (const flag of ["--config <file>", "--output-root <dir>", "--model-override <binding>=<model>", "--help"]) {
      expect(help).toContain(flag);
    }
    expect(formatHelp({ usage: "x", summary: "y" })).not.toContain("\nOptions:");
  });
});

function capture(): EvalContext & { stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return { root: "/repo", env: {}, out: (t) => stdout.push(t), err: (t) => stderr.push(t), stdout, stderr };
}

function command(name: string, run: EvalCommand["run"] = async () => 0): EvalCommand {
  return { name, summary: `does ${name}`, help: `help for ${name}`, run };
}

describe("runEval", () => {
  it("lists the commands with no arguments or with --help, and exits 0", async () => {
    const commands = [command("judge blueprint"), command("play")];
    for (const argv of [[], ["--help"], ["-h"], ["help"]]) {
      const context = capture();
      expect(await runEval(argv, context, commands)).toBe(0);
      expect(context.stdout.join("\n")).toContain("judge blueprint  does judge blueprint");
      expect(context.stdout.join("\n")).toContain("play             does play");
    }
    expect(listCommands([])).toContain("(none registered)");
  });

  it("exits 1 for a command it does not know, listing the ones it does", async () => {
    const context = capture();
    expect(await runEval(["judge", "nothing"], context, [command("judge blueprint")])).toBe(1);
    expect(context.stderr.join("\n")).toContain('Unknown eval command "judge nothing"');
    expect(context.stderr.join("\n")).toContain("judge blueprint");
  });

  it("calls the command named by the most words, with the rest of the argv and the context", async () => {
    const calls: Array<[string, string[]]> = [];
    const record = (name: string) => command(name, async (argv) => (calls.push([name, argv]), 2));
    const context = capture();
    const status = await runEval(["judge", "game", "s1", "--quiet"], context, [record("judge"), record("judge game")]);
    expect(status).toBe(2);
    expect(calls).toEqual([["judge game", ["s1", "--quiet"]]]);
  });

  it("prints a command's help for --help without running it", async () => {
    const run = vi.fn(async () => 0);
    const context = capture();
    expect(await runEval(["play", "--help"], context, [command("play", run)])).toBe(0);
    expect(context.stdout).toEqual(["help for play"]);
    expect(run).not.toHaveBeenCalled();
  });

  it.each([
    [new UsageError("bad flag"), "eval play: bad flag\n\nhelp for play"],
    [new ConfigError("no binding"), "eval play: no binding"],
    [new Error("boom"), "eval play: the run broke: Error: boom"],
  ])("exits 1 when the command throws %s", async (error, message) => {
    const context = capture();
    const status = await runEval(["play"], context, [command("play", async () => Promise.reject(error))]);
    expect(status).toBe(1);
    expect(context.stderr[0].startsWith(message)).toBe(true);
  });
});

describe("progress", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-core-progress-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("formats durations and token counts", () => {
    expect([840, 1234, 125_000, 119_600].map(formatDuration)).toEqual(["840ms", "1.2s", "2m05s", "2m00s"]);
    expect([0, 999, 39_400, 410_000].map(formatTokens)).toEqual(["0 tok", "999 tok", "39.4k tok", "410k tok"]);
    expect(tickInterval({ EVAL_HEARTBEAT_MS: "50" })).toBe(50);
    expect(tickInterval({})).toBe(20_000);
  });

  it("turns stream events into digest lines and token deltas", () => {
    expect(
      formatEvent({
        type: "assistant",
        message: {
          content: [
            { type: "text", text: "First line\nsecond" },
            { type: "tool_use", name: "Write", input: { file_path: "/w/blueprint.json" } },
            { type: "tool_use", name: "Bash", input: { command: "node validate.mjs" } },
            { type: "tool_use", name: "Grep", input: { pattern: "clue" } },
            { type: "tool_use", name: "Glob", input: { path: "/w/docs" } },
            { type: "tool_use", name: "Other", input: {} },
          ],
        },
      }),
    ).toEqual([
      "> First line",
      "> Tool: Write (blueprint.json)",
      "> Tool: Bash (node validate.mjs)",
      "> Tool: Grep (clue)",
      "> Tool: Glob (docs)",
      "> Tool: Other",
    ]);
    expect(formatEvent({ type: "result", num_turns: 4 })).toEqual(["> agent done — 4 turn(s)"]);
    expect(formatEvent({ type: "rate_limit_event", rate_limit_info: { status: "rejected" } })).toEqual([
      "> ⚠ rate limit: rejected",
    ]);
    expect(formatEvent({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } })).toEqual([]);
    expect(formatEvent({ type: "assistant", message: {} })).toEqual([]);
    expect(thinkingTokenDelta({ type: "system", subtype: "thinking_tokens", estimated_tokens_delta: 12 })).toBe(12);
    expect(thinkingTokenDelta({ type: "system", subtype: "thinking_tokens", estimated_tokens_delta: "x" })).toBe(0);
    expect(thinkingTokenDelta({ type: "assistant" })).toBe(0);
  });

  it("follows complete JSON lines across attempts' stream files, ignoring the rest", () => {
    const seen: Array<[unknown, string]> = [];
    const follower = followStreams(dir, streamFilesOf("judge-a"), (event, file) => seen.push([event.n, file]), 10_000);
    fs.writeFileSync(path.join(dir, "judge-a.attempt-1.stream.jsonl"), '{"n":1}\nnot json\n{"n":2}\n{"n":');
    fs.writeFileSync(path.join(dir, "judge-ab.attempt-1.stream.jsonl"), '{"n":9}\n');
    fs.writeFileSync(path.join(dir, "judge-a.attempt-2.stream.jsonl"), '{"n":3}\n');
    follower.stop();
    expect(seen.sort()).toEqual([
      [1, "judge-a.attempt-1.stream.jsonl"],
      [2, "judge-a.attempt-1.stream.jsonl"],
      [3, "judge-a.attempt-2.stream.jsonl"],
    ]);
  });

  it("does nothing for a folder that does not exist yet", () => {
    const follower = followStreams(path.join(dir, "later"), () => true, () => {
      throw new Error("no events expected");
    });
    follower.stop();
  });

  it("prints one step's activity under each tick, and says when there was none", async () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const digest = startDigest("generate", ["generate"], { logDir: dir, intervalMs: 1000, write: (l) => lines.push(l) });
      vi.advanceTimersByTime(1000);
      expect(lines.at(-1)).toMatch(/^\[eval\] generate · .* · 0 tok · no new activity$/);
      fs.writeFileSync(
        path.join(dir, "generate.attempt-1.stream.jsonl"),
        [
          { type: "system", subtype: "thinking_tokens", estimated_tokens_delta: 1500 },
          ...Array.from({ length: 10 }, (_, i) => ({ type: "assistant", message: { content: [{ type: "text", text: `m${i}` }] } })),
        ]
          .map((event) => JSON.stringify(event))
          .join("\n") + "\n",
      );
      vi.advanceTimersByTime(1000);
      const tick = lines.slice(1);
      expect(tick[0]).toMatch(/^\[eval\] generate · .* · 1.5k tok$/);
      expect(tick.slice(1, 9)).toEqual(Array.from({ length: 8 }, (_, i) => `  > m${i}`));
      expect(tick[9]).toBe("  +2 more");
      fs.appendFileSync(path.join(dir, "generate.attempt-1.stream.jsonl"), '{"type":"result","num_turns":3}\n');
      digest.stop();
      expect(lines.at(-1)).toBe("  > agent done — 3 turn(s)");
    } finally {
      vi.useRealTimers();
    }
  });

  it("prints each running step of a parallel phase until it is done", () => {
    vi.useFakeTimers();
    try {
      const lines: string[] = [];
      const digest = startDigest("judges", ["judge-a", "judge-b"], { logDir: dir, intervalMs: 1000, write: (l) => lines.push(l) });
      fs.writeFileSync(
        path.join(dir, "judge-a.attempt-1.stream.jsonl"),
        `${JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "reading" }] } })}\n`,
      );
      vi.advanceTimersByTime(1000);
      expect(lines).toEqual([
        expect.stringMatching(/^\[eval\] judges · .* · 0\/2 done$/),
        "  judge-a · 0 tok",
        "    > reading",
        "  judge-b · 0 tok · no new activity",
      ]);
      digest.markDone("judge-a");
      digest.markDone("unknown");
      lines.length = 0;
      vi.advanceTimersByTime(1000);
      expect(lines).toEqual([expect.stringMatching(/1\/2 done$/), "  judge-b · 0 tok · no new activity"]);
      digest.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it("prints nothing when quiet", () => {
    const lines: string[] = [];
    const digest = startDigest("x", ["x"], { logDir: dir, quiet: true, write: (l) => lines.push(l) });
    digest.markDone("x");
    digest.stop();
    expect(lines).toEqual([]);
  });
});
