// `judge turn` on cases with `expect`, and `baseline save` and `compare`, end to
// end in process on stub bindings. The narrator is a scratch script answering
// each call with the next of a list of replies, so samples can differ; no model,
// server or database is touched.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readResult } from "../../../evaluation/core/result.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";

const REPO_ROOT = process.cwd();
const EXAMPLE = "evaluation/runtime/cases/expect-example.ts";
const NO_EXPECT = "evaluation/runtime/cases/age-readability.ts";

let scratch = "";
let configFile = "";
let runs = 0;
let tests = 0;

/** Each call answers with the next reply; the run's concurrency is 1, so samples take them in order. */
const REPLAY_SCRIPT = `#!/usr/bin/env node
const fs = require("fs");
const replies = JSON.parse(process.env.EXPECT_STUB_REPLIES);
const file = process.env.EXPECT_STUB_COUNTER;
const n = fs.existsSync(file) ? Number(fs.readFileSync(file, "utf8")) : 0;
fs.writeFileSync(file, String(n + 1));
process.stdout.write(JSON.stringify(replies[n % replies.length]));
`;

interface Ran {
  code: number;
  output: string;
  runDir: string;
}

async function evalCommand(argv: string[]): Promise<{ code: number; output: string }> {
  const lines: string[] = [];
  const code = await runEval(argv, { root: REPO_ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env }, COMMANDS);
  return { code, output: lines.join("\n") };
}

async function judgeTurn(args: string[], replies: unknown[] = [], config = configFile): Promise<Ran> {
  process.env.EXPECT_STUB_REPLIES = JSON.stringify(replies);
  runs += 1;
  const outputRoot = path.join(scratch, `out-${runs}`);
  const { code, output } = await evalCommand(["judge", "turn", ...args, "--concurrency", "1", "--config", config, "--output-root", outputRoot]);
  const [day] = fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot) : [];
  const runDir = day ? path.join(outputRoot, day, fs.readdirSync(path.join(outputRoot, day))[0]) : "";
  return { code, output, runDir };
}

const found = (id: string) => ({ narration: "You find it.", revealed_clue_id: id, input_understood: true });
const empty = { narration: "Nothing here.", revealed_clue_id: null, input_understood: true };

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-expect-run-"));
  const script = path.join(scratch, "replies.js");
  fs.writeFileSync(script, REPLAY_SCRIPT, { mode: 0o755 });
  configFile = path.join(scratch, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({
    "narrator-stub": { cmd: script, args: ["{{user_message_file}}"], timeout_ms: 30_000 },
    "turn-judge": { cmd: "evaluation/runtime/config/wrappers/stub-judge.sh", args: ["{{user_message_file}}"], timeout_ms: 30_000 },
  }));
});

// Each test's narrator starts from its first reply.
beforeEach(() => {
  tests += 1;
  process.env.EXPECT_STUB_COUNTER = path.join(scratch, `counter-${tests}`);
});

afterAll(() => {
  delete process.env.EXPECT_STUB_REPLIES;
  delete process.env.EXPECT_STUB_COUNTER;
  fs.rmSync(scratch, { recursive: true, force: true });
});

/** Only the search case, in a file of its own. */
function searchOnly(extra: Record<string, unknown> = {}): string {
  const file = path.join(scratch, `search-${runs}-${Object.keys(extra).join("-")}.json`);
  fs.writeFileSync(file, JSON.stringify({
    id: "search-pantry",
    blueprint: { path: "blueprints/mock-blueprint.json" },
    group: "should-reveal",
    given: { mode: "explore", location_id: "loc-kitchen", time_remaining: 8, history: [] },
    action: { type: "search", search_query: "the pantry shelf" },
    expect: { revealed_clue_id: "clue-jar" },
    ...extra,
  }));
  return file;
}

describe("judge turn on a case with expect", () => {
  it("replays it --samples times, grades each by code and writes the summary", async () => {
    const { code, output, runDir } = await judgeTurn([searchOnly(), "--narrator", "narrator-stub", "--samples", "4"], [found("clue-jar"), empty, found("clue-crumb"), found("clue-jar")]);
    expect(code).toBe(2);
    expect(readRunIndex(runDir).subjects.map((subject) => subject.id)).toEqual(
      ["s1", "s2", "s3", "s4"].map((n) => `search-pantry__narrator-stub__${n}`),
    );
    const result = await readResult(path.join(runDir, "search-pantry-narrator-stub-s2", "result.json"));
    expect(result.verdicts.map((verdict) => [verdict.id, verdict.status])).toEqual([["expect", "fail"]]);

    const summary = readSummary(runDir);
    expect(summary.complete).toBe(true);
    expect(summary.narrators[0]).toMatchObject({ narrator: "narrator-stub", model: "narrator-stub", samples_per_case: 4 });
    expect(summary.narrators[0].cases[0]).toMatchObject({ id: "search-pantry", right: 2, graded: 4, share: 0.5, withheld: 2, given_away: 1 });
    expect(summary.narrators[0].groups[0]).toMatchObject({ group: "should-reveal", cases: 1, share: 0.5 });
    expect(output).toMatch(/search-pantry\s+should-reveal\s+2\/4\s+50%\s+2\s+1/);
  });

  it("takes 5 samples by default", async () => {
    const { runDir } = await judgeTurn([searchOnly(), "--narrator", "narrator-stub"], [found("clue-jar")]);
    expect(readSummary(runDir).narrators[0].cases[0]).toMatchObject({ samples: 5, right: 5, share: 1 });
  });

  it("runs the judges its expect names, even when --judges leaves them out, and grades on them", async () => {
    process.env.RUNTIME_JUDGE_STUB_VERDICT = JSON.stringify({ verdict: "fail", reasoning: "Conceded too much.", findings: [{ sequence: 1, severity: "major", kind: "unearned", quote: "x", why: "y" }] });
    try {
      const file = searchOnly({ expect: { revealed_clue_id: "clue-jar", judges: { gm_roleplay: "given_away" } } });
      const { runDir } = await judgeTurn([file, "--narrator", "narrator-stub", "--samples", "1", "--judges", "flesch"], [found("clue-jar")]);
      const result = await readResult(path.join(runDir, "search-pantry-narrator-stub-s1", "result.json"));
      expect(result.verdicts.map((verdict) => verdict.id)).toEqual(["flesch", "gm_roleplay", "expect"]);
      expect(readSummary(runDir).narrators[0].cases[0]).toMatchObject({ right: 0, given_away: 1 });
    } finally {
      delete process.env.RUNTIME_JUDGE_STUB_VERDICT;
    }
  });

  it("leaves an ungraded case out of its group", async () => {
    const { runDir } = await judgeTurn([searchOnly({ ungraded: true }), "--narrator", "narrator-stub", "--samples", "1"], [empty]);
    const [entry] = readSummary(runDir).narrators;
    expect(entry.cases[0]).toMatchObject({ ungraded: true, right: 0 });
    expect(entry.groups).toEqual([]);
  });

  it("reports a sample that failed to run as incomplete, never right or wrong", async () => {
    const broken = path.join(scratch, "broken.json");
    fs.writeFileSync(broken, JSON.stringify({ "narrator-stub": { cmd: "false", args: [], timeout_ms: 30_000 } }));
    const { code, output, runDir } = await judgeTurn([searchOnly(), "--narrator", "narrator-stub", "--samples", "2"], [], broken);
    expect(code).toBe(1);
    const summary = readSummary(runDir);
    expect(summary.complete).toBe(false);
    expect(summary.narrators[0].cases[0]).toMatchObject({ samples: 2, graded: 0, right: 0, share: null, incomplete: 2 });
    expect(output).toContain("INCOMPLETE: 2 of 2 samples");
  });

  it("judges a stored sample again without its grade, which the stored turn cannot carry", async () => {
    const { runDir } = await judgeTurn([searchOnly(), "--narrator", "narrator-stub", "--samples", "1"], [found("clue-jar")]);
    const again = await judgeTurn([path.join(runDir, "search-pantry-narrator-stub-s1", "turn.json")]);
    expect(again.code).toBe(0);
    const [subject] = readRunIndex(again.runDir).subjects;
    expect((await readResult(path.join(again.runDir, subject.dir, "result.json"))).verdicts.map((verdict) => verdict.id)).toEqual(["flesch"]);
    expect(fs.existsSync(path.join(again.runDir, "expect.json"))).toBe(false);
  });
});

describe("a clue-graph accusation", () => {
  it("opens a clue-graph accusation with one normal scene call", async () => {
    const file = path.join(scratch, "graph-accusation-start.json");
    fs.writeFileSync(file, JSON.stringify({ id: "graph-start", blueprint: { path: "blueprints/clue-graph/greenhouse-prizewinner.json" }, given: { mode: "explore", location_id: "greenhouse", time_remaining: 5, history: [] }, action: { type: "accuse" } }));
    const { code, runDir } = await judgeTurn([file, "--narrator", "narrator-stub"], [{ narration: "You gather your thoughts." }]);
    expect(code).toBe(0);
    const folder = path.join(runDir, "graph-start-narrator-stub");
    expect((await readResult(path.join(folder, "result.json"))).production?.calls).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(path.join(folder, "turn.json"), "utf8")).response.output_role).toBe("accusation_start");
  });
  it("rejects an invalid graph notebook before judging, even without expect", async () => {
    const file = path.join(scratch, "invalid-notebook.json");
    fs.writeFileSync(file, JSON.stringify({ id: "invalid-notebook", blueprint: { path: "blueprints/clue-graph/greenhouse-prizewinner.json" }, given: { mode: "explore", location_id: "greenhouse", time_remaining: 5, history: [] }, action: { type: "search" } }));
    const { code, runDir } = await judgeTurn([file, "--narrator", "narrator-stub"], [{ narration: "Nothing here.", revealed_clue_id: null, notebook: {} }]);
    expect(code).toBe(1);
    const result = await readResult(path.join(runDir, "invalid-notebook-narrator-stub", "result.json"));
    expect(result.run_error?.stage).toBe("parser");
    expect(result.production?.calls[0].attempts[0].outcome).toBe("invalid");
    expect(result.verdicts).toEqual([]);
    expect(fs.readFileSync(path.join(runDir, "invalid-notebook-narrator-stub", "logs", "narrate-invalid-notebook-search.attempt-1.stdout.log"), "utf8")).toContain('"notebook":{}');
  });
  /** One case of the greenhouse accusation library, in a file of its own. */
  function libraryCase(id: string): string {
    const file = path.join(scratch, `${id}.mjs`);
    const library = path.join(REPO_ROOT, "evaluation/runtime/cases/clue-graph/greenhouse/accusation.ts");
    fs.writeFileSync(file, `import cases from ${JSON.stringify(library)};\nexport default cases.find((one) => one.id === ${JSON.stringify(id)});\n`);
    return file;
  }
  const report = (accused: string, cited: string[]) => ({ accused_character_id: accused, cited_clue_ids: cited });

  it("chains the report, the engine's decision and the reply, as the game does", async () => {
    const replies = [
      report("mia", ["clue_rota_purple_ink", "clue_key_in_water_butt"]),
      { narration: "Mr. Dobbs heard the crash at ten to nine, and Mia was selling cake across town then." },
    ];
    const retrying = path.join(scratch, "retrying.json");
    const config = JSON.parse(fs.readFileSync(configFile, "utf8"));
    fs.writeFileSync(retrying, JSON.stringify({ ...config, "narrator-stub": { ...config["narrator-stub"], retries: 1 } }));
    const { code, runDir } = await judgeTurn([libraryCase("accuse-mia-cleared"), "--narrator", "narrator-stub", "--samples", "1"], replies, retrying);
    expect(code).toBe(0);
    const subject = path.join(runDir, "accuse-mia-cleared-narrator-stub-s1");
    const result = await readResult(path.join(subject, "result.json"));
    // The two existing model calls are kept around the engine decision.
    expect(result.production?.calls.map((call) => call.attempts.length)).toEqual([1, 1]);
    expect(result.verdicts.map((verdict) => [verdict.id, verdict.status])).toEqual([["gm_spoiler", "pass"], ["expect", "pass"]]);
    const turn = JSON.parse(fs.readFileSync(path.join(subject, "turn.json"), "utf8"));
    // A cited clue the player does not hold is dropped before the engine decides.
    expect(turn.response.raw).toMatchObject({
      role: "graph_accusation_round",
      clue_graph_accusation: { accused: "mia", cited: ["clue_rota_purple_ink"], verdict: "not_yet" },
      reply_kind: "flaw",
    });
    expect(turn.response.narration_text).toContain("ten to nine");
  });

  it("records an admissibility failure without pretending it was a parser failure or making the reply call", async () => {
    const { code, runDir } = await judgeTurn([libraryCase("accuse-mia-cleared"), "--narrator", "narrator-stub", "--samples", "1"], [report("mrs_nobody", [])]);
    expect(code).toBe(1);
    const result = await readResult(path.join(runDir, "accuse-mia-cleared-narrator-stub-s1", "result.json"));
    expect(result.run_error?.stage).toBe("admissibility");
    expect(result.production?.calls).toHaveLength(1);
    expect(result.production?.calls[0].attempts[0].outcome).toBe("ok");
  });

  it("refuses an accusation's expect on a blueprint that is not a clue graph, before any call", async () => {
    const file = path.join(scratch, "v2-accuse.json");
    fs.writeFileSync(file, JSON.stringify({
      id: "v2-accuse",
      blueprint: { path: "blueprints/mock-blueprint.json" },
      given: { mode: "accuse", location_id: "loc-kitchen", time_remaining: 4, history: [] },
      action: { type: "accuse", player_reasoning: "It was Alice." },
      expect: { verdict: "win" },
    }));
    const { code, output, runDir } = await judgeTurn([file, "--narrator", "narrator-stub", "--samples", "1"]);
    expect(code).not.toBe(0);
    expect(output).toMatch(/only on a clue-graph blueprint/);
    expect(runDir).toBe("");
  });

  it("words a won accusation as the closing scene, with no kind of reply", async () => {
    const replies = [report("toby", ["clue_welly_prints"]), { narration: "You solved it! Toby's bench fell on Bertha, and the key went in the water butt." }];
    const { code, runDir } = await judgeTurn([libraryCase("accuse-toby-won"), "--narrator", "narrator-stub", "--samples", "1"], replies);
    expect(code).toBe(0);
    const turn = JSON.parse(fs.readFileSync(path.join(runDir, "accuse-toby-won-narrator-stub-s1", "turn.json"), "utf8"));
    expect(turn.response.raw).toMatchObject({ role: "graph_ending", clue_graph_accusation: { verdict: "win" } });
    expect(turn.response.raw.reply_kind).toBeUndefined();
  });
});

describe("a case without expect", () => {
  it("runs once per narrator, as before: no sample suffix, no grade, no summary", async () => {
    const { code, output, runDir } = await judgeTurn([NO_EXPECT, "--narrator", "narrator-stub", "--samples", "3"], [
      { narration: "You take a slow look around. Nothing new catches your eye just yet.", revealed_clue_ids: [] },
    ]);
    expect(code).toBe(0);
    const index = readRunIndex(runDir);
    expect(index.subjects.map((subject) => subject.id).sort()).toEqual(["ask-alice-alibi-pressure__narrator-stub", "talk-bob-open__narrator-stub"]);
    for (const subject of index.subjects) {
      const result = await readResult(path.join(runDir, subject.dir, "result.json"));
      expect(result.verdicts.map((verdict) => verdict.id)).toEqual(["flesch"]);
    }
    expect(fs.readdirSync(runDir).sort()).toEqual(["ask-alice-alibi-pressure-narrator-stub", "run.json", "talk-bob-open-narrator-stub"]);
    const lines = output.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toMatch(/^\[judge turn\] 2 turn\(s\) -> /);
    expect(lines[3]).toMatch(/^\[judge turn\] wrote .*run\.json \(exit 0\)$/);
  });
});

describe("baseline save and compare", () => {
  it("stores a run's summary and compares a later run against it per case and per group", async () => {
    const before = await judgeTurn([EXAMPLE, "--narrator", "narrator-stub", "--samples", "2"], [
      found("clue-jar"),
      empty,
      { narration: "Alice nods.", revealed_clue_ids: [], used_clue_ids: [] },
      { narration: "Alice nods.", revealed_clue_ids: [], used_clue_ids: [] },
    ]);
    const file = path.join(scratch, "cases", "baselines", "narrator-stub.json");
    const saved = await evalCommand(["baseline", "save", before.runDir, file]);
    expect(saved.code).toBe(0);
    expect(saved.output).toContain("narrator-stub (narrator-stub): 2 case(s), 2 samples per case");
    expect(readSummary(file)).toEqual(readSummary(before.runDir));

    const after = await judgeTurn([EXAMPLE, "--narrator", "narrator-stub", "--samples", "2"], [
      found("clue-jar"),
      found("clue-jar"),
      { narration: "Alice nods.", revealed_clue_ids: ["clue-alice-saw-bob"], used_clue_ids: [] },
      { narration: "Alice nods.", revealed_clue_ids: [], used_clue_ids: [] },
    ]);
    const compared = await evalCommand(["baseline", "compare", file, path.join(after.runDir, "expect.json")]);
    expect(compared.code).toBe(0);
    expect(compared.output).toMatch(/search-pantry-shelf-reveals-jar\s+example-should-reveal\s+50%\s+100%\s+\+50 pts/);
    expect(compared.output).toMatch(/ask-alice-about-bob-shares-sighting\s+example-should-give\s+0%\s+50%\s+\+50 pts/);
    expect(compared.output).toMatch(/example-should-reveal\s+50%\s+100%\s+\+50 pts/);
  });

  it("refuses to store an incomplete run", async () => {
    const broken = path.join(scratch, "broken-save.json");
    fs.writeFileSync(broken, JSON.stringify({ "narrator-stub": { cmd: "false", args: [], timeout_ms: 30_000 } }));
    const { runDir } = await judgeTurn([searchOnly(), "--narrator", "narrator-stub", "--samples", "1"], [], broken);
    const file = path.join(scratch, "refused.json");
    const saved = await evalCommand(["baseline", "save", runDir, file]);
    expect(saved.code).toBe(1);
    expect(saved.output).toContain("is incomplete");
    expect(fs.existsSync(file)).toBe(false);
  });

  it("refuses a file that is not a graded summary", async () => {
    const compared = await evalCommand(["baseline", "compare", configFile, configFile]);
    expect(compared.code).toBe(1);
    expect(compared.output).toContain("is not a graded summary");
  });
});
