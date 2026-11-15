// What the suite tests share: a scratch truth set copied from the fixture,
// one stub binding for every judge (eval-suite-stub.mjs), a suite file, and a
// way to run `./dev eval suite` in-process and read back what it wrote.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import type { StoredResults } from "../../../evaluation/lib/truth/schemas.ts";

export const ROOT = repoRoot();
export const FIXTURE = path.join(ROOT, "tests/api/unit/fixtures/truth");
const STUB = path.join(ROOT, "tests/api/unit/eval-suite-stub.mjs");
const SNAPSHOT_ANSWERS = JSON.parse(fs.readFileSync(path.join(ROOT, "tests/api/unit/fixtures/eval-snapshot-answers.json"), "utf8")) as Record<string, unknown>;

/** An answer per judge: fairness fails, gm_spoiler names the culprit at turn 4, the age judge passes. */
export const ANSWERS: Record<string, unknown> = {
  fairness: SNAPSHOT_ANSWERS["blueprint.fairness"],
  gm_spoiler: { ...(SNAPSHOT_ANSWERS["trace.gm_spoiler"] as object), findings: [{ sequence: 4, severity: "major", kind: "culprit", quote: "Dorn", why: "Names the thief.", refers_to: null }], verdict: "fail" },
  age_appropriate_turn: { estimated_reading_age: 8, findings: [], verdict: "pass", reasoning: "Plain words." },
};

/** The fixture suite: a base and its plant, a game and a variant, and their turns. */
export const FIXTURE_SUITE = {
  subjects: { bases: ["mock"], blueprint_plants: "all", games: ["medal"], game_variants: ["medal-spoiler"] },
  judges: ["fairness", "gm_spoiler", "age_appropriate_turn"],
  concurrency: 3,
};

export interface Scratch {
  dir: string;
  truth: string;
  control: string;
  out: string;
  config: string;
}

export function makeScratch(answers: Record<string, unknown> = ANSWERS, bindings = ["blueprint-judge", "game-judge", "turn-judge"]): Scratch {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-suite-"));
  const truth = path.join(dir, "truth");
  fs.cpSync(FIXTURE, truth, { recursive: true });
  // The fixture's own results file is not this suite's; scoring reads only what the suite stores.
  fs.rmSync(path.join(truth, "results"), { recursive: true, force: true });
  const control = path.join(dir, "control");
  fs.mkdirSync(control);
  fs.writeFileSync(path.join(control, "answers.json"), JSON.stringify(answers));
  const binding = { cmd: process.execPath, args: [STUB, control, "{{user_message_file}}"], extract_path: "result", timeout_ms: 30_000, retries: 0 };
  const config = path.join(dir, "config.json");
  fs.writeFileSync(config, JSON.stringify(Object.fromEntries(bindings.map((name) => [name, binding]))));
  return { dir, truth, control, out: path.join(dir, "out"), config };
}

export function writeSuite(scratch: Scratch, name: string, suite: unknown): string {
  const file = path.join(scratch.dir, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(suite));
  return file;
}

export interface Ran {
  code: number;
  out: string;
  err: string;
}

export async function suite(scratch: Scratch, file: string, extra: string[] = []): Promise<Ran> {
  const out: string[] = [];
  const err: string[] = [];
  const argv = ["suite", file, "--truth", scratch.truth, "--config", scratch.config, "--output-root", scratch.out, ...extra];
  const code = await runEval(argv, { root: ROOT, out: (text) => out.push(text), err: (text) => err.push(text), env: {} }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

/** The judges the stub answered, one entry per call it made. */
export function stubCalls(scratch: Scratch): string[] {
  const log = path.join(scratch.control, "calls.log");
  return fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
}

export function limitAfter(scratch: Scratch, calls: number | null): void {
  const file = path.join(scratch.control, "limit-after");
  if (calls === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, String(calls));
}

export function resultsOf(scratch: Scratch, name: string): StoredResults {
  return JSON.parse(fs.readFileSync(path.join(scratch.truth, "results", `${name}.json`), "utf8")) as StoredResults;
}

/** The results with each verdict's duration left out: the one part two runs never share. */
export function withoutDurations(results: StoredResults): unknown {
  return results.verdicts.map((verdict) => ({ ...verdict, duration_ms: null }));
}

export function journalLines(scratch: Scratch, name: string): Array<Record<string, unknown>> {
  const file = path.join(scratch.out, "suites", name, "calls.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Every file under `dir`, relative to it. */
export function filesUnder(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return (fs.readdirSync(dir, { recursive: true }) as string[])
    .filter((entry) => fs.statSync(path.join(dir, entry)).isFile())
    .map((entry) => entry.split(path.sep).join("/"))
    .sort();
}
