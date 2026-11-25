// `perf report`: trends read from `perf.db`, as text and as one static page.
// The index is built by `perf sync` from fixture run folders (no remote, no
// model). Covers lines grouped by the matched attributes, `--match` on fewer
// attributes merging them, the filters, medians and pass rates by version,
// runs shown apart, an empty loop, and the page: it parses, holds an SVG per
// chart, and fetches nothing.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { RESULT_SCHEMA_VERSION, summarize } from "../../../evaluation/core/result.ts";
import type { ModelCall, Result, RunInfo, Verdict } from "../../../evaluation/core/result.ts";
import type { SuiteAttributes } from "../../../evaluation/core/suite-attributes.ts";
import { INDEX_FILE } from "../../../evaluation/perf/index-db.ts";
import { renderChart } from "../../../evaluation/perf/report-chart.ts";
import { median, parseMatch } from "../../../evaluation/perf/report-data.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");

let scratch = "";
let outputRoot = "";
let configFile = "";

function call(binding: string, model: string, duration_ms: number, cost_usd: number, input: number): ModelCall {
  const tokens = { input, output: 10, cache_read: 0, cache_write: 0 };
  return {
    binding,
    model,
    prompt_sha256: "c".repeat(64),
    duration_ms,
    cost_usd,
    tokens,
    attempts: [{ attempt: 1, outcome: "ok", duration_ms, cost_usd, tokens }],
  };
}

function attributes(extra: Partial<SuiteAttributes> = {}, generator = "opus"): SuiteAttributes {
  return {
    command: "generate",
    options: { repair: true },
    inputs: [{ id: "lighthouse", hash: "aaaaaaaaaaaa" }],
    judges: ["cg_soundness"],
    models: { generator: [generator], narrator: null, investigator: null, judge: ["opus"] },
    samples: null,
    concurrency: null,
    suite: "blueprint-loop",
    ...extra,
  };
}

interface Spec {
  id: string;
  passed: boolean;
  generatorMs: number;
  judgeVersion?: number;
  prompt?: string;
  attributes?: SuiteAttributes | null;
  clean?: boolean;
  command?: string;
}

function result(spec: Spec): Result {
  const [day, rest] = spec.id.split("/");
  const run: RunInfo = {
    id: spec.id,
    command: spec.command ?? "generate",
    argv: [],
    started_at: `${day}T${rest.slice(0, 8).replaceAll("-", ":")}.000Z`,
    ended_at: null,
    commit: "abc",
    tree_clean: spec.clean ?? true,
    bindings: {},
    judge_versions: { cg_soundness: spec.judgeVersion ?? 1 },
    suite: "blueprint-loop",
    label: null,
    developer: "ada",
    host: "lab",
    parent_run: null,
    prompt_versions: { narrator: "000000000001", generator: spec.prompt ?? "aaaaaaaaaaa1" },
    attributes: spec.attributes === undefined ? attributes() : spec.attributes,
  };
  const verdicts: Verdict[] = [
    { id: "cg_soundness", tier: "judge", status: spec.passed ? "pass" : "fail", findings: ["SECRET finding text"], call: call("blueprint-judge", "opus", 4000, 0.05, 200) },
  ];
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run,
    subject: { kind: "blueprint", id: "lighthouse", path: null },
    production: { calls: [call("generator-agent", "opus", spec.generatorMs, spec.generatorMs / 100_000, spec.generatorMs / 10)] },
    verdicts,
    summary: summarize(verdicts, null),
    run_error: null,
    timing: null,
  };
}

function writeRun(spec: Spec): void {
  const value = result(spec);
  const dir = path.join(outputRoot, value.run.id);
  fs.mkdirSync(path.join(dir, "00-lighthouse"), { recursive: true });
  fs.writeFileSync(path.join(dir, "00-lighthouse", "result.json"), JSON.stringify(value));
  const subject = { kind: "blueprint", id: "lighthouse", dir: "00-lighthouse", summary: value.summary, run_error: null };
  fs.writeFileSync(path.join(dir, "run.json"), JSON.stringify({ schema_version: value.schema_version, run: value.run, subjects: [subject], exit_code: 0 }));
}

/**
 * Line one holds runs 1 to 3: two on the first prompt and judge version (one
 * passing, 10s and 20s generator calls), one on the second of each. Line two,
 * run 4, ran on another model. Runs 5 and 6 are shown apart.
 */
const RUNS: Spec[] = [
  { id: "2026-11-01/10-00-00-generate", passed: true, generatorMs: 10_000 },
  { id: "2026-11-02/10-00-00-generate", passed: false, generatorMs: 20_000 },
  { id: "2026-11-03/10-00-00-generate", passed: true, generatorMs: 6_000, prompt: "aaaaaaaaaaa2", judgeVersion: 2 },
  { id: "2026-11-04/10-00-00-generate", passed: true, generatorMs: 8_000, prompt: "aaaaaaaaaaa2", judgeVersion: 2, attributes: attributes({}, "sonnet") },
  { id: "2026-11-05/10-00-00-generate", passed: true, generatorMs: 5_000, prompt: "aaaaaaaaaaa2", judgeVersion: 2, clean: false },
  { id: "2026-11-06/10-00-00-generate", passed: true, generatorMs: 5_000, attributes: null },
];

async function eval_(argv: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(argv, { root: ROOT, out: (text) => out.push(text), err: (text) => err.push(text), env: {} }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function sync() {
  const synced = await eval_(["perf", "sync", "--config", configFile, "--output-root", outputRoot]);
  expect(synced.code).toBe(0);
}

async function report(...args: string[]) {
  return eval_(["perf", "report", "--config", configFile, "--output-root", outputRoot, ...args]);
}

function page(): string {
  return fs.readFileSync(path.join(outputRoot, "perf", "report.html"), "utf8");
}

beforeEach(async () => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "eval-perf-report-")));
  outputRoot = path.join(scratch, "runs");
  fs.mkdirSync(outputRoot);
  configFile = path.join(scratch, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ developer: "ada" }));
  for (const spec of RUNS) writeRun(spec);
  await sync();
});

afterEach(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

describe("perf report lines", () => {
  it("puts runs with equal attributes on one line and says what each holds fixed", async () => {
    const { code, out } = await report();

    expect(code).toBe(0);
    expect(out).toContain("blueprint loop: 6 run(s)");
    expect(out).toContain("2 trend line(s), 2 run(s) shown apart");
    expect(out).toContain("line 1: 3 run(s), 2026-11-01 to 2026-11-03");
    expect(out).toContain("line 2: 1 run(s), 2026-11-04");
    expect(out).toContain("holds fixed:");
    expect(out).toContain("models: generator=opus, judge=opus");
    expect(out).toContain("models: generator=sonnet, judge=opus");
    expect(out).toContain("inputs: lighthouse#aaaaaaaaaaaa");
    expect(out).toContain("options: repair=true");
    expect(out).toContain("not held fixed: nothing");
  });

  it("merges lines when --match names fewer attributes, and says what is no longer held", async () => {
    const { out } = await report("--match", "command,inputs");

    expect(out).toContain("1 trend line(s), 2 run(s) shown apart");
    expect(out).toContain("line 1: 4 run(s), 2026-11-01 to 2026-11-04");
    expect(out).not.toContain("models:");
    expect(out).toContain("not held fixed: options, judges, models, samples, concurrency, suite");
  });

  it("splits a line into steps where the prompt or a judge version changes, with pass rate and medians by version", async () => {
    const { out } = await report("--loop", "blueprint", "--match", "command,inputs");
    const first = out.split("step 1:")[1].split("step 2:")[0];
    const second = out.split("step 2:")[1];

    expect(first).toContain("prompt #1 aaaaaaaaaaa1; judges cg_soundness v1");
    expect(first).toContain("2 run(s), 2026-11-01 to 2026-11-02; pass rate 50%; 2.0 calls per run");
    expect(first).toContain("cg_soundness v1 50% (1/2)");
    // generator: calls of 10s and 20s costing $0.1000 and $0.2000 with 1,010 and 2,010 tokens; judge: 4s, $0.05, 210 tokens
    expect(first).toMatch(/generator\s+opus\s+2\s+15\.0s\s+\$0\.1500\s+1,510/);
    expect(first).toMatch(/judge\s+opus\s+2\s+4\.0s\s+\$0\.0500\s+210/);

    expect(second).toContain("prompt #2 aaaaaaaaaaa2; judges cg_soundness v2");
    expect(second).toContain("2 run(s), 2026-11-03 to 2026-11-04; pass rate 100%");
  });

  it("shows runs apart, with why", async () => {
    const { out } = await report();
    const apart = out.split("shown apart, on no line:")[1];

    expect(apart).toMatch(/2026-11-05\/10-00-00-generate.*the tree was not known to be clean/);
    expect(apart).toMatch(/2026-11-06\/10-00-00-generate.*no suite attributes recorded/);
    expect(out.split("line 1:")[1].split("shown apart")[0]).not.toContain("2026-11-05");
  });
});

describe("perf report filters", () => {
  it("--loop keeps one loop, and a loop with no runs says so", async () => {
    const both = await report();
    expect(both.out).toContain("narration loop: 0 run(s)\n  no runs");

    const narration = await report("--loop", "narration");
    expect(narration.out).not.toContain("blueprint loop");
    expect(narration.out).toContain("narration loop: 0 run(s)");
    expect(page()).toContain("<p>No runs.</p>");
  });

  it("--since keeps the runs from that date on", async () => {
    const { out } = await report("--since", "2026-11-03", "--loop", "blueprint");

    expect(out).toContain("blueprint loop: 4 run(s) (since 2026-11-03)");
    expect(out).toContain("line 1: 1 run(s), 2026-11-03");
    expect(out).not.toContain("2026-11-02");
  });

  it("--suite keeps the runs of one suite, and none for another", async () => {
    expect((await report("--suite", "blueprint-loop", "--loop", "blueprint")).out).toContain("blueprint loop: 6 run(s) (suite blueprint-loop)");
    const other = await report("--suite", "elsewhere", "--loop", "blueprint");
    expect(other.out).toContain("blueprint loop: 0 run(s) (suite elsewhere)\n  no runs");
  });

  it("puts narration runs in their own loop", async () => {
    writeRun({ id: "2026-11-07/10-00-00-play", passed: true, generatorMs: 1_000, command: "play" });
    await sync();
    const { out } = await report();

    expect(out).toContain("blueprint loop: 6 run(s)");
    expect(out).toContain("narration loop: 1 run(s)");
  });

  it.each([
    [["--match", "models,bogus"], "--match takes attribute names"],
    [["--since", "2026-13-01"], "--since takes a date as YYYY-MM-DD"],
    [["--since", "yesterday"], "--since takes a date as YYYY-MM-DD"],
    [["--loop", "play"], "--loop takes blueprint or narration"],
  ])("rejects %j", async (args, message) => {
    const { code, err } = await report(...args);
    expect(code).toBe(1);
    expect(err).toContain(message);
  });

  it("stops when there is no index, naming the command that builds it", async () => {
    fs.rmSync(path.join(outputRoot, INDEX_FILE));
    const { code, err } = await report();
    expect(code).toBe(1);
    expect(err).toContain("run ./dev eval perf sync first");
  });

  it("reads the index and changes nothing but the page", async () => {
    const before = fs.readFileSync(path.join(outputRoot, INDEX_FILE));
    await report();
    expect(fs.readFileSync(path.join(outputRoot, INDEX_FILE)).equals(before)).toBe(true);
    expect(fs.readdirSync(path.join(outputRoot, "perf"))).toEqual(["report.html"]);

    await sync();
    expect(fs.readdirSync(outputRoot).sort()).toContain("perf");
  });
});

/** A small HTML checker: every element opened is closed, in order, and no void element is left open. */
function assertWellFormed(html: string): void {
  const voids = new Set(["meta", "link", "br", "hr", "img", "input"]);
  const stack: string[] = [];
  const body = html.replace(/<!doctype html>/i, "").replace(/<style>[\s\S]*?<\/style>/, "<style></style>");
  for (const match of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (voids.has(name) || selfClosing) continue;
    if (closing) expect(stack.pop(), `</${name}>`).toBe(name);
    else stack.push(name);
  }
  expect(stack).toEqual([]);
}

describe("perf report page", () => {
  it("is one well-formed file holding an SVG for each chart and fetching nothing", async () => {
    await report();
    const html = page();

    assertWellFormed(html);
    // Two lines, each with five charts: pass rate, calls, and duration, cost and tokens per call.
    expect(html.match(/<svg /g)).toHaveLength(10);
    expect(html.match(/<figure>/g)).toHaveLength(10);
    expect(html).toContain("Pass rate per run");
    expect(html).toContain("Median tokens per call, by role and model");
    expect(html).toContain("generator · opus");

    expect(html).not.toMatch(/https?:\/\/|\/\/[a-z]/i);
    expect(html).not.toMatch(/<script|<link|<img|<iframe|\bsrc=|\bhref=|@import|url\(/i);
  });

  it("states what a line holds fixed, its steps and the runs apart", async () => {
    await report();
    const html = page();

    expect(html).toContain("<h2>blueprint loop: 6 run(s)</h2>");
    expect(html).toContain("Held fixed on this line:");
    expect(html).toContain("<dt>models</dt><dd>generator=opus, judge=opus</dd>");
    expect(html).toContain("<h3>Shown apart</h3>");
    expect(html).toContain("the tree was not known to be clean");
    expect(html).toContain("<h2>narration loop: 0 run(s)</h2>");
  });

  it("holds no finding text", async () => {
    await report();
    expect(page()).not.toContain("SECRET");
  });

  it("is rewritten by a second report, with no leftover temporary file", async () => {
    await report();
    await report("--since", "2026-11-04");
    expect(page()).toContain("(since 2026-11-04)");
    expect(fs.readdirSync(path.join(outputRoot, "perf"))).toEqual(["report.html"]);
  });
});

describe("perf report helpers", () => {
  it("takes the median of an odd and an even count", () => {
    expect([median([]), median([3]), median([5, 1, 3]), median([4, 1, 3, 2])]).toEqual([null, 3, 3, 2.5]);
  });

  it("parses --match in attribute order, and everything by default", () => {
    expect(parseMatch("models, command")).toEqual(["command", "models"]);
    expect(parseMatch(undefined)).toHaveLength(8);
  });

  it("draws gaps for runs without a value, one point for a single run, and nothing without data", () => {
    const spec = { title: "T", runs: ["a", "b", "c"], marks: [{ index: 1, label: "step 2" }], format: (value: number) => `${value}!` };
    const gap = renderChart({ ...spec, series: [{ name: "x", values: [1, null, 3] }] }) as string;
    expect(gap).toContain("<circle");
    expect(gap).not.toContain("<polyline");
    expect(gap).toContain("step 2");

    const left = renderChart({ ...spec, marks: [{ index: 0, label: "step 1" }], series: [{ name: "x", values: [1, 2, 3] }] }) as string;
    expect(left).not.toContain('text-anchor="end">step 1');
    expect(gap).toContain('text-anchor="end">step 2');

    const joined = renderChart({ ...spec, series: [{ name: "x", values: [1, 2, 3] }, { name: "y", values: [null, 0, 1] }], max: 4 }) as string;
    expect(joined.match(/<polyline/g)).toHaveLength(2);

    const single = renderChart({ ...spec, runs: ["a"], marks: [], series: [{ name: "x", values: [0] }] }) as string;
    expect(single).toContain("<circle");

    expect(renderChart({ ...spec, series: [{ name: "x", values: [null, null, null] }] })).toBeNull();
  });
});
