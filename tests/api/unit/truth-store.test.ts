import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { judgesFor } from "../../../evaluation/core/registry.ts";
import { RESULT_SCHEMA_VERSION, summarize } from "../../../evaluation/core/result.ts";
import type { Result, Verdict } from "../../../evaluation/core/result.ts";
import { loadTruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { main, notClean, storeBase, storeGame, toStoredVerdict } from "../../../evaluation/lib/truth/store.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}

/** An empty truth set to store into. */
async function emptySet(): Promise<string> {
  const root = await tempDir("truth-store-");
  await fs.writeFile(path.join(root, "README.md"), "# Truth\n", "utf8");
  return root;
}

async function writeJson(file: string, value: unknown): Promise<string> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
  return file;
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
}

function judgeVerdict(id: string, status: Verdict["status"] = "pass", cost: number | null = 0.25): Verdict {
  const call = {
    binding: "blueprint-judge",
    model: "opus",
    prompt_sha256: "a".repeat(64),
    duration_ms: 61000,
    cost_usd: cost,
    attempts: [{ attempt: 1, outcome: "ok" as const, duration_ms: 61000, cost_usd: cost }],
  };
  return { id, tier: "judge", status, call, answer: { verdict: status } };
}

/** A blueprint result as `judge blueprint` writes it, every verdict passing unless `verdicts` says otherwise. */
function blueprintResult(verdicts?: Verdict[], overrides: Partial<Result> = {}): Result {
  const all = verdicts ?? [
    { id: "schema", tier: "mechanical", status: "pass" },
    { id: "clue_graph.analyzer", tier: "analyzer", status: "pass" },
    ...judgesFor("blueprint").map((judge, index) => judgeVerdict(judge.id, "pass", index === 0 ? null : 0.25)),
  ];
  const runError = overrides.run_error ?? null;
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run: {
      id: "2026-11-15/10-00-00-judge-blueprint",
      command: "judge blueprint",
      argv: [],
      started_at: "2026-11-15T10:00:00.000Z",
      ended_at: "2026-11-15T10:05:00.000Z",
      commit: null,
      tree_clean: null,
      bindings: {},
    },
    subject: { kind: "blueprint", id: "mock", path: "blueprint.json" },
    production: null,
    verdicts: all,
    summary: summarize(all, runError),
    run_error: runError,
    timing: null,
    ...overrides,
  };
}

/** A run's subject folder: the fixture's base blueprint and brief beside a result. */
async function judgedSubject(result: Result): Promise<string> {
  const dir = await tempDir("truth-store-run-");
  await fs.copyFile(path.join(FIXTURE, "bases/mock/blueprint.json"), path.join(dir, "blueprint.json"));
  await fs.copyFile(path.join(FIXTURE, "bases/mock/brief.json"), path.join(dir, "brief.json"));
  return writeJson(path.join(dir, "result.json"), result);
}

const DATABASE = ["", "private", "var", "folders", "xy", "game.db"].join("/");

/** A played game: the fixture's trace as extraction writes it, with its summary. */
async function playedGame(summaryOverrides: Record<string, unknown> = {}, traceEdit?: (trace: Record<string, unknown>) => void) {
  const dir = await tempDir("truth-store-game-");
  const trace = await readJson(path.join(FIXTURE, "games/medal/trace.json"));
  trace.source = { kind: "local", database: DATABASE };
  traceEdit?.(trace);
  const summary = {
    game_id: "sess-1",
    blueprint: { id: "bp-1", title: "Medal" },
    persona: "kid-7",
    investigator_model: "sonnet",
    error: null,
    ...summaryOverrides,
  };
  return {
    trace: await writeJson(path.join(dir, "trace.json"), trace),
    summary: await writeJson(path.join(dir, "summary.json"), summary),
  };
}

describe("storing a base", () => {
  it("copies the blueprint and brief, and stores each judge's verdict with model, time and cost", async () => {
    const root = await emptySet();
    const set = await storeBase(root, "mock-base", await judgedSubject(blueprintResult()));
    expect(set.bases.map((base) => base.id)).toEqual(["mock-base"]);
    expect(await readJson(path.join(root, "bases/mock-base/blueprint.json"))).toEqual(await readJson(path.join(FIXTURE, "bases/mock/blueprint.json")));
    expect(await readJson(path.join(root, "bases/mock-base/brief.json"))).toEqual(await readJson(path.join(FIXTURE, "bases/mock/brief.json")));

    const [results] = set.results;
    expect(results.id).toBe("bases");
    expect(results.verdicts.map((verdict) => verdict.judge)).toEqual(judgesFor("blueprint").map((judge) => judge.id));
    expect(results.verdicts[0]).toEqual({
      subject: { side: "blueprint", base: "mock-base", plant: null },
      judge: judgesFor("blueprint")[0].id,
      model: "opus",
      sample: 0,
      status: "pass",
      findings: [],
      duration_ms: 61000,
      cost_usd: null,
    });
    expect(results.verdicts[1].cost_usd).toBe(0.25);
  });

  it("adds a second base's verdicts to the same results file", async () => {
    const root = await emptySet();
    await storeBase(root, "one", await judgedSubject(blueprintResult()));
    const set = await storeBase(root, "two", await judgedSubject(blueprintResult()));
    expect(set.bases.map((base) => base.id)).toEqual(["one", "two"]);
    const bases = set.results[0].verdicts.map((verdict) => (verdict.subject.side === "blueprint" ? verdict.subject.base : null));
    expect(new Set(bases)).toEqual(new Set(["one", "two"]));
    expect(bases).toHaveLength(2 * judgesFor("blueprint").length);
  });

  it.each([
    ["a failed judge", blueprintResult([judgeVerdict("fairness", "fail")]), "fairness fail"],
    ["a skipped check", blueprintResult([{ id: "schema", tier: "mechanical", status: "skipped" }]), "schema skipped"],
    ["a battery judge that did not run", blueprintResult([judgeVerdict("fairness")]), "did not judge it"],
    ["a run that broke", blueprintResult(undefined, { run_error: { stage: "judges", message: "usage limit" } }), "the run broke at judges"],
  ])("refuses %s, and writes nothing", async (_label, result, why) => {
    const root = await emptySet();
    await expect(storeBase(root, "mock-base", await judgedSubject(result))).rejects.toThrow(why);
    await expect(fs.stat(path.join(root, "bases"))).rejects.toThrow();
    await expect(fs.stat(path.join(root, "results"))).rejects.toThrow();
  });

  it("refuses a result that is not of a blueprint", () => {
    expect(notClean(blueprintResult(undefined, { subject: { kind: "game", id: "g", path: "trace.json" } }))).toContain("not a blueprint");
  });

  it("refuses a base that is already stored, and an id outside the layout", async () => {
    const root = await emptySet();
    const result = await judgedSubject(blueprintResult());
    await storeBase(root, "mock-base", result);
    await expect(storeBase(root, "mock-base", result)).rejects.toThrow("already exists");
    await expect(storeBase(root, "Mock Base", result)).rejects.toThrow('"Mock Base" is not an id');
  });

  it("refuses a base removed from bases/ while its verdicts are still stored, naming them", async () => {
    const root = await emptySet();
    const result = await judgedSubject(blueprintResult());
    await storeBase(root, "mock-base", result);
    await fs.rm(path.join(root, "bases", "mock-base"), { recursive: true });
    await expect(storeBase(root, "mock-base", result)).rejects.toThrow('already holds verdicts on base "mock-base"; remove them');
  });

  it("refuses a blueprint holding a home path, before writing anything", async () => {
    const root = await emptySet();
    const result = await judgedSubject(blueprintResult());
    const blueprintFile = path.join(path.dirname(result), "blueprint.json");
    const blueprint = await readJson(blueprintFile);
    (blueprint.metadata as Record<string, unknown>).one_liner = `see ${["", "Users", "someone", "notes"].join("/")}`;
    await writeJson(blueprintFile, blueprint);
    await expect(storeBase(root, "mock-base", result)).rejects.toThrow("looks like an absolute home path");
    await expect(fs.stat(path.join(root, "bases"))).rejects.toThrow();
  });
});

describe("a stored verdict", () => {
  it("is only a judge's, and only one that called a model", () => {
    const subject = { side: "blueprint" as const, base: "b", plant: null };
    expect(() => toStoredVerdict({ id: "schema", tier: "mechanical", status: "pass" }, subject)).toThrow("not a judge");
    expect(() => toStoredVerdict({ id: "fairness", tier: "judge", status: "error" }, subject)).toThrow('judge "fairness" has no model call');
  });

  it("keeps a fail as one finding of the judge's kind", () => {
    const stored = toStoredVerdict(judgeVerdict("fairness", "fail"), { side: "blueprint", base: "b", plant: null });
    expect(stored.findings).toEqual([{ sequence: null, kinds: ["fairness"], severity: "major", judge_kind: null }]);
  });
});

describe("storing a game", () => {
  it("stores the trace with who played it, and without the database's path", async () => {
    const root = await emptySet();
    const game = await playedGame();
    const set = await storeGame(root, "medal-kid", game.trace, game.summary);
    expect(set.games.map((stored) => stored.id)).toEqual(["medal-kid"]);
    expect(set.games[0].trace.source).toEqual({ kind: "local", persona: "kid-7", investigator_model: "sonnet" });
    expect(await fs.readFile(path.join(root, "games/medal-kid/trace.json"), "utf8")).not.toContain(DATABASE);
    // Apart from its provenance, the trace is stored as it was extracted.
    const played = await readJson(game.trace);
    expect({ ...set.games[0].trace, source: null }).toEqual({ ...played, source: null });
  });

  it.each([
    ["another game's summary", { game_id: "sess-2" }, "not the trace's sess-1 on bp-1"],
    ["a game on another blueprint", { blueprint: { id: "bp-2" } }, "not the trace's sess-1 on bp-1"],
    ["a game that broke", { error: "investigator-error" }, "the game broke (investigator-error)"],
    ["a summary without a persona", { persona: undefined }, "not a self-play summary.json"],
  ])("refuses %s", async (_label, overrides, message) => {
    const root = await emptySet();
    const game = await playedGame(overrides);
    await expect(storeGame(root, "medal-kid", game.trace, game.summary)).rejects.toThrow(message);
    await expect(fs.stat(path.join(root, "games"))).rejects.toThrow();
  });

  it("refuses a trace whose narration holds a home path", async () => {
    const root = await emptySet();
    const game = await playedGame({}, (trace) => {
      const [first] = trace.events as Record<string, unknown>[];
      first.narration = `It was in ${["", "home", "someone", "x"].join("/")}.`;
    });
    await expect(storeGame(root, "medal-kid", game.trace, game.summary)).rejects.toThrow("looks like an absolute home path");
  });

  it("refuses a trace that is not a stored game, naming the field", async () => {
    const root = await emptySet();
    const game = await playedGame({}, (trace) => {
      trace.events = [];
    });
    await expect(storeGame(root, "medal-kid", game.trace, game.summary)).rejects.toThrow(`${game.trace}: events`);
  });
});

describe("the store command line", () => {
  it("stores a base and a game into the named root, and says what the set holds", async () => {
    const root = await emptySet();
    const lines: string[] = [];
    expect(await main(["base", "mock-base", await judgedSubject(blueprintResult()), "--root", root], (line) => lines.push(line))).toBe(0);
    const game = await playedGame();
    expect(await main(["game", "medal-kid", game.trace, game.summary, "--root", root], (line) => lines.push(line))).toBe(0);
    expect(lines).toEqual([`stored base "mock-base" in ${root}: 1 bases, 0 games`, `stored game "medal-kid" in ${root}: 1 bases, 1 games`]);
    const set = await loadTruthSet(root);
    expect([set.bases.length, set.games.length]).toEqual([1, 1]);
  });

  it("prints its usage for wrong arguments, and why when nothing was stored", async () => {
    const lines: string[] = [];
    const write = (line: string) => lines.push(line);
    expect(await main(["game", "x", "trace.json"], write)).toBe(1);
    expect(await main(["plant", "x", "y"], write)).toBe(1);
    expect(await main(["base", "x", "y", "--root"], write)).toBe(1);
    expect(lines.every((line) => line.startsWith("usage: node evaluation/lib/truth/store.ts"))).toBe(true);
    const root = await emptySet();
    lines.length = 0;
    expect(await main(["base", "mock-base", path.join(root, "missing.json"), "--root", root], write)).toBe(1);
    expect(lines[0]).toMatch(/^not stored: .*missing\.json/);
  });
});
