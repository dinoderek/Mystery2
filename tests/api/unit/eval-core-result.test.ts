import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ResolvedBinding } from "../../../evaluation/core/config.ts";
import {
  EXIT_PASSED,
  EXIT_RUN_BROKE,
  EXIT_VERDICT_FAILED,
  RESULT_SCHEMA_VERSION,
  STATUSES,
  exitCodeFor,
  readResult,
  summarize,
  writeResult,
} from "../../../evaluation/core/result.ts";
import type { Result, Status, Verdict } from "../../../evaluation/core/result.ts";
import {
  createRunFolder,
  readCommit,
  readRunIndex,
  resolveOutputRoot,
  slugify,
} from "../../../evaluation/core/run-folder.ts";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-core-result-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = {
  binding: "blueprint-judge",
  model: "opus",
  prompt_sha256: "a".repeat(64),
  duration_ms: 1200,
  cost_usd: 0.4,
  attempts: [
    { attempt: 1, outcome: "invalid" as const, duration_ms: 500, cost_usd: 0.2, error: "bad" },
    { attempt: 2, outcome: "ok" as const, duration_ms: 700, cost_usd: 0.2 },
  ],
};

function verdict(id: string, status: Status, extra: Partial<Verdict> = {}): Verdict {
  return { id, tier: "mechanical", status, ...extra };
}

function result(verdicts: Verdict[] = [verdict("schema", "pass")], overrides: Partial<Result> = {}): Result {
  const runError = overrides.run_error ?? null;
  return {
    schema_version: RESULT_SCHEMA_VERSION,
    run: {
      id: "2026-11-14/12-00-00-judge-blueprint",
      command: "judge blueprint",
      argv: ["b.json"],
      started_at: "2026-11-14T12:00:00.000Z",
      ended_at: "2026-11-14T12:01:00.000Z",
      commit: "abc",
      tree_clean: true,
      bindings: {
        "blueprint-judge": { cmd: "w.sh", args: [], extract_path: "result", model: "opus", timeout_ms: 1, retries: 1 },
      },
    },
    subject: { kind: "blueprint", id: "lighthouse", path: "blueprint.json" },
    production: { calls: [call] },
    verdicts,
    summary: summarize(verdicts, runError),
    run_error: runError,
    timing: { total_ms: 10, stages: [{ name: "load", duration_ms: 2 }], dimensions: [] },
    ...overrides,
  };
}

describe("the result schema", () => {
  it("writes a valid result and reads the same back", async () => {
    const file = path.join(dir, "sub", "result.json");
    const judged = result([
      verdict("schema", "pass"),
      verdict("fairness", "fail", { tier: "judge", call, answer: { verdict: "fail" }, findings: ["x"] }),
    ]);
    await writeResult(file, judged);
    expect(await readResult(file)).toEqual(judged);
  });

  it.each([
    ["a wrong version", { schema_version: "other/1" }, /schema_version/],
    ["a status outside the four", { verdicts: [verdict("a", "pass"), { ...verdict("b", "pass"), status: "maybe" }] }, /verdicts.1.status/],
    ["a summary that disagrees with the verdicts", { summary: { counts: { pass: 0, fail: 0, error: 0, skipped: 0 }, passed: true } }, /does not match the verdicts/],
    ["a repeated verdict id", { verdicts: [verdict("a", "pass"), verdict("a", "pass")], summary: summarize([verdict("a", "pass"), verdict("a", "pass")]) }, /verdict ids repeat: a/],
    ["an unknown subject kind", { subject: { kind: "brief", id: "x", path: null } }, /subject.kind/],
    ["a prompt hash that is not SHA-256", { production: { calls: [{ ...call, prompt_sha256: "abc" }] } }, /prompt_sha256/],
    ["an unknown field", { extra: true }, /Unrecognized key/],
  ])("refuses to write %s", async (_label, overrides, message) => {
    const file = path.join(dir, "result.json");
    await expect(writeResult(file, { ...result(), ...overrides } as Result)).rejects.toThrow(message);
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses to read a malformed result, naming the file", async () => {
    const file = path.join(dir, "result.json");
    fs.writeFileSync(file, JSON.stringify({ ...result(), verdicts: [verdict("a", "fail")] }));
    await expect(readResult(file)).rejects.toThrow(`${file} is not a valid result: summary`);
    fs.writeFileSync(file, "{");
    await expect(readResult(file)).rejects.toThrow(/is not JSON/);
  });
});

describe("summarize", () => {
  it("counts by status, and passes only with nothing failed or errored and the run whole", () => {
    expect(summarize([verdict("a", "pass"), verdict("b", "skipped")])).toEqual({
      counts: { pass: 1, fail: 0, error: 0, skipped: 1 },
      passed: true,
    });
    expect(summarize([verdict("a", "error")]).passed).toBe(false);
    expect(summarize([], { stage: "load", message: "x" }).passed).toBe(false);
  });
});

describe("exitCodeFor", () => {
  const withStatuses = (...statuses: Status[]) => result(statuses.map((status, i) => verdict(`v${i}`, status)));

  // Every mix of the four statuses in one result, from none to all four.
  const mixes: Status[][] = [];
  for (let mask = 0; mask < 1 << STATUSES.length; mask += 1) {
    mixes.push(STATUSES.filter((_, i) => mask & (1 << i)));
  }

  it.each(mixes.map((mix) => [mix.join("+") || "none", mix] as const))("for %s", (_label, mix) => {
    const failed = mix.includes("fail") || mix.includes("error");
    expect(exitCodeFor([withStatuses(...mix)])).toBe(failed ? EXIT_VERDICT_FAILED : EXIT_PASSED);
  });

  it("is 1 when any result's run broke, whatever the verdicts", () => {
    const broke = result([], { run_error: { stage: "generate", message: "x" } });
    expect(exitCodeFor([withStatuses("pass"), broke])).toBe(EXIT_RUN_BROKE);
    expect(exitCodeFor([withStatuses("fail"), broke])).toBe(EXIT_RUN_BROKE);
  });

  it("is 2 when any one of several results failed", () => {
    expect(exitCodeFor([withStatuses("pass"), withStatuses("skipped"), withStatuses("error")])).toBe(EXIT_VERDICT_FAILED);
    expect(exitCodeFor([withStatuses("pass"), withStatuses("skipped")])).toBe(EXIT_PASSED);
  });
});

describe("the output root", () => {
  it("is --output-root, else $MYSTERYEVALS_DIR, else ~/mysteryevals", () => {
    expect(resolveOutputRoot("/flag", { MYSTERYEVALS_DIR: "/env" }, "/home")).toBe("/flag");
    expect(resolveOutputRoot(undefined, { MYSTERYEVALS_DIR: "/env" }, "/home")).toBe("/env");
    expect(resolveOutputRoot(undefined, {}, "/home")).toBe(path.join("/home", "mysteryevals"));
    expect(resolveOutputRoot("rel", {}, "/home")).toBe(path.resolve("rel"));
  });
});

describe("the run folder", () => {
  const binding: ResolvedBinding = {
    name: "blueprint-judge",
    cmd: "w.sh",
    command: "/abs/w.sh",
    args: ["{{user_message_file}}"],
    extract_path: "result",
    model: "opus",
    timeout_ms: 5,
    retries: 1,
  };
  const at = new Date("2026-11-14T09:08:07.000Z");
  const open = (command = "judge blueprint") =>
    createRunFolder({
      outputRoot: dir,
      command,
      argv: ["b.json", "--quiet"],
      root: dir,
      bindings: [binding],
      now: () => at,
      commit: { commit: "abc123", tree_clean: false },
    });

  it("is a dated folder with one folder per subject and a run.json index", async () => {
    const run = open();
    expect(run.dir).toBe(path.join(dir, "2026-11-14", "09-08-07-judge-blueprint"));

    const lighthouse = run.subject({ kind: "blueprint", id: "Lighthouse Lens" });
    expect(lighthouse).toEqual({
      dir: path.join(run.dir, "lighthouse-lens"),
      logDir: path.join(run.dir, "lighthouse-lens", "logs"),
      resultFile: path.join(run.dir, "lighthouse-lens", "result.json"),
    });
    const again = run.subject({ kind: "blueprint", id: "lighthouse lens" });
    expect(again.dir).toBe(path.join(run.dir, "lighthouse-lens-2"));

    await writeResult(lighthouse.resultFile, result([verdict("a", "pass")], { run: run.info() }));
    await writeResult(again.resultFile, result([verdict("a", "fail")], { run: run.info() }));
    const index = await run.finish();

    expect(readRunIndex(run.dir)).toEqual(index);
    expect(index.exit_code).toBe(EXIT_VERDICT_FAILED);
    expect(index.run).toMatchObject({
      id: "2026-11-14/09-08-07-judge-blueprint",
      command: "judge blueprint",
      argv: ["b.json", "--quiet"],
      started_at: at.toISOString(),
      commit: "abc123",
      tree_clean: false,
      bindings: { "blueprint-judge": { cmd: "w.sh", model: "opus", retries: 1 } },
    });
    expect(index.subjects.map((subject) => [subject.dir, subject.summary.passed])).toEqual([
      ["lighthouse-lens", true],
      ["lighthouse-lens-2", false],
    ]);
  });

  it("gives a second run in the same second its own folder", () => {
    const first = open();
    const second = open();
    expect(second.dir).toBe(`${first.dir}-2`);
  });

  it("breaks the run when a subject has no valid result", async () => {
    const run = open();
    run.subject({ kind: "turn", id: "case-1" });
    await expect(run.finish()).rejects.toThrow(/result.json/);
    expect(fs.existsSync(path.join(run.dir, "run.json"))).toBe(false);
  });

  it("names folders from free text", () => {
    expect(slugify("Turn 3: talk/Mary!")).toBe("turn-3-talk-mary");
    expect(slugify("***")).toBe("subject");
  });
});

describe("readCommit", () => {
  it("reads the commit and tree state of a checkout, and nulls outside one", () => {
    const here = readCommit(path.resolve(__dirname, "../../.."));
    expect(here.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(typeof here.tree_clean).toBe("boolean");
    expect(readCommit(dir)).toEqual({ commit: null, tree_clean: null });
  });
});
