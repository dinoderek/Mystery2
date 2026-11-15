// `judge turn <trace>`: the narration a stored game already holds is what the
// reading-level check and the age judge read. No narrator is asked, and every
// result names the event sequence it judged. No model is called.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadCheck } from "../../../evaluation/core/judge-loader.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import { judgeTurnCommand } from "../../../evaluation/runtime/judge-turn.ts";
import type { StoredTurn } from "../../../evaluation/runtime/lib/turn.ts";
import { makeTurn } from "./runtime-turn-helpers.ts";

const REPO_ROOT = process.cwd();
const FIXTURE_TRACE = path.resolve("tests/api/unit/fixtures/truth/games/medal/trace.json");
const MISSING = "/nonexistent/narrator-command";

interface TraceFile {
  events: Array<{ sequence: number; event_type: string; narration: string; narration_parts: unknown[]; payload: Record<string, unknown> }>;
  [key: string]: unknown;
}

let scratch = "";
let configFile = "";
let capturedFile = "";
let tracePath = "";
let trace: TraceFile;

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-judge-stored-game-"));
  capturedFile = path.join(scratch, "captured.jsonl");
  // A judge that keeps what it was handed, then passes.
  const capture = path.join(scratch, "capture-judge.sh");
  fs.writeFileSync(
    capture,
    `#!/usr/bin/env bash\ncat "$1" >> "${capturedFile}"\necho >> "${capturedFile}"\n` +
      `printf '%s' '{"estimated_reading_age":8,"findings":[],"verdict":"pass","reasoning":"ok"}'\n`,
    { mode: 0o755 },
  );
  const narrator = { cmd: MISSING, args: ["{{user_message_file}}"], timeout_ms: 1000 };
  configFile = path.join(scratch, "config.json");
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      "narrator-claude": narrator,
      "narrator-openai": narrator,
      "narrator-stub": narrator,
      "turn-judge": { cmd: capture, args: ["{{user_message_file}}"], timeout_ms: 30_000 },
    }),
  );

  trace = JSON.parse(fs.readFileSync(FIXTURE_TRACE, "utf8")) as TraceFile;
  // A refused line is saved as an event with narration of its own; it is not a turn.
  trace.events.splice(3, 0, {
    sequence: 99,
    event_type: "no_turn_line",
    narration: "You can't do that here.",
    narration_parts: [],
    payload: {},
  });
  tracePath = path.join(scratch, "games", "medal", "trace.json");
  fs.mkdirSync(path.dirname(tracePath), { recursive: true });
  fs.writeFileSync(tracePath, JSON.stringify(trace));
});

afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

async function run(args: string[]): Promise<{ code: number; output: string; runDir: string }> {
  const outputRoot = path.join(scratch, `out-${fs.readdirSync(scratch).length}`);
  const lines: string[] = [];
  const code = await runEval(["judge", "turn", ...args, "--config", configFile, "--output-root", outputRoot], {
    root: REPO_ROOT,
    out: (text) => lines.push(text),
    err: (text) => lines.push(text),
    env: {},
  }, [judgeTurnCommand]);
  const days = fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot) : [];
  const runDir = days.length > 0 ? path.join(outputRoot, days[0], fs.readdirSync(path.join(outputRoot, days[0]))[0]) : "";
  return { code, output: lines.join("\n"), runDir };
}

/** The folder a subject was written to, which the run index names. */
function subjectDir(runDir: string, event: { sequence: number; event_type: string }): string {
  const id = `medal__s${event.sequence}-${event.event_type}__stored`;
  const subject = readRunIndex(runDir).subjects.find((candidate) => candidate.id === id);
  if (!subject) throw new Error(`no subject ${id}`);
  return path.join(runDir, subject.dir);
}

const narrated = () => trace.events.filter((event) => event.event_type !== "no_turn_line");

describe("judge turn on a stored game", () => {
  it("judges every narrated turn once with flesch and the age judge, and calls no narrator", async () => {
    fs.writeFileSync(capturedFile, "");
    const { code, runDir } = await run([tracePath]);
    expect(code).toBe(0);

    const index = readRunIndex(runDir);
    // Every narrator binding points at a missing command; none was resolved, let alone run.
    expect(Object.keys(index.run.bindings)).toEqual(["turn-judge"]);
    expect(index.subjects).toHaveLength(narrated().length);

    const dirs = fs.readdirSync(runDir, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    expect(dirs).toHaveLength(narrated().length);
    for (const dir of dirs) {
      const result = await readResult(path.join(runDir, dir.name, "result.json"));
      expect(result.verdicts.map((verdict) => verdict.id)).toEqual(["flesch", "age_appropriate_turn"]);
      expect(result.production).toBeNull();
      expect(result.run_error).toBeNull();
    }
    // One age call per turn.
    expect(fs.readFileSync(capturedFile, "utf8").trim().split("\n")).toHaveLength(narrated().length);
  });

  it("hands each judge the trace's narration for that event, byte for byte", async () => {
    fs.writeFileSync(capturedFile, "");
    const { runDir } = await run([tracePath]);

    const handed = fs.readFileSync(capturedFile, "utf8").trim().split("\n").map((line) => JSON.parse(line) as { narration: string; target_age: number });
    expect(handed.map((message) => message.narration).sort()).toEqual(narrated().map((event) => event.narration).sort());
    expect(handed.every((message) => message.target_age === 9)).toBe(true);

    const flesch = (await loadCheck("flesch")) as (turn: StoredTurn, options: object) => { details?: unknown; status: string };
    for (const event of narrated()) {
      const dir = subjectDir(runDir, event);
      const turn = JSON.parse(fs.readFileSync(path.join(dir, "turn.json"), "utf8")) as StoredTurn;
      expect(turn.response.narration_text).toBe(event.narration);
      const result = await readResult(path.join(dir, "result.json"));
      const expected = flesch(makeTurn({ target_age: 9, response: { ...makeTurn().response, narration_text: event.narration, narration_parts: [] } }), {});
      expect(result.verdicts[0].status).toBe(expected.status);
      expect(result.verdicts[0].details).toMatchObject({
        score: (expected.details as { score: number }).score,
        preview: expect.stringContaining(event.narration.slice(0, 40)),
      });
    }
  });

  it("does not judge a refused line, and names every other turn by its event sequence", async () => {
    const { runDir } = await run([tracePath]);
    const ids = readRunIndex(runDir).subjects.map((subject) => subject.id).sort();
    expect(ids).toEqual(narrated().map((event) => `medal__s${event.sequence}-${event.event_type}__stored`).sort());
    expect(ids.some((id) => id.includes("s99-"))).toBe(false);

    for (const event of narrated()) {
      const dir = subjectDir(runDir, event);
      const turn = JSON.parse(fs.readFileSync(path.join(dir, "turn.json"), "utf8")) as StoredTurn;
      expect(turn.sequence).toBe(event.sequence);
    }
  });

  it("takes only the judges that read the narration alone", async () => {
    const { code, output } = await run([tracePath, "--judges", "gm_spoiler"]);
    expect(code).toBe(1);
    expect(output).toContain("flesch and age_appropriate_turn only");
  });

  it("runs just flesch, with no judge binding, when asked", async () => {
    const { code, runDir } = await run([tracePath, "--judges", "flesch"]);
    expect(code).toBe(0);
    expect(Object.keys(readRunIndex(runDir).run.bindings)).toEqual([]);
  });
});
