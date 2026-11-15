// `./dev eval suite`: a suite file run end to end on stub bindings and the
// fixture truth set, through the real registry, harness judge code, runner,
// journal, results schema and scorer. No model is called.

import fs from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { loadTruthSet, readResultsFile } from "../../../evaluation/lib/truth/loader.ts";
import { SUITES_DIR, readSuiteFile } from "../../../evaluation/suite/file.ts";
import {
  ANSWERS,
  FIXTURE_SUITE,
  ROOT,
  filesUnder,
  journalLines,
  limitAfter,
  makeScratch,
  resultsOf,
  stubCalls,
  suite,
  withoutDurations,
  writeSuite,
} from "./eval-suite-helpers.ts";
import type { Scratch } from "./eval-suite-helpers.ts";

/** The fixture suite's calls: two blueprints, a game and a variant, and their nine narrated turns each. */
const FIXTURE_CALLS = 2 + 2 + 18;

const scratches: Scratch[] = [];
function scratch(...args: Parameters<typeof makeScratch>): Scratch {
  const made = makeScratch(...args);
  scratches.push(made);
  return made;
}
afterEach(() => {
  for (const made of scratches.splice(0)) fs.rmSync(made.dir, { recursive: true, force: true });
});

describe("a fixture suite", () => {
  it("runs to the end, exits 0, and stores results the truth set loads and score reads", async () => {
    const at = scratch();
    const file = writeSuite(at, "fixture", { ...FIXTURE_SUITE, thresholds: [{ judge: "gm_spoiler", kind: "spoiler", min_found_of_real: 1 }] });
    const ran = await suite(at, file);
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(stubCalls(at)).toHaveLength(FIXTURE_CALLS);
    expect(ran.out).toContain("gm_spoiler spoiler: found of real 1.00 (1/1), needs 1: met");

    const set = await loadTruthSet(at.truth);
    const stored = set.results.find((results) => results.id === "fixture");
    expect(stored?.verdicts).toHaveLength(FIXTURE_CALLS);
    expect(await readResultsFile(set, path.join(at.truth, "results", "fixture.json"))).toHaveLength(FIXTURE_CALLS);
    const subjects = new Set(stored?.verdicts.map((verdict) => JSON.stringify(verdict.subject)));
    expect(subjects).toContain(JSON.stringify({ side: "blueprint", base: "mock", plant: "mock-bob-not-ruled-out" }));
    expect(subjects).toContain(JSON.stringify({ side: "game", game: "medal", variant: "medal-spoiler", sequence: null }));
    expect(subjects).toContain(JSON.stringify({ side: "game", game: "medal", variant: null, sequence: 4 }));
    const spoiler = stored?.verdicts.find((verdict) => verdict.judge === "gm_spoiler" && verdict.subject.side === "game" && verdict.subject.variant !== null);
    expect(spoiler).toMatchObject({ status: "fail", model: "game-judge", sample: 0, findings: [{ sequence: 4, kinds: ["spoiler"], severity: "major", judge_kind: "culprit" }] });

    const scored: string[] = [];
    const code = await runEval(
      ["score", "fixture", "--truth", at.truth, "--out", path.join(at.dir, "score.json")],
      { root: ROOT, out: (text) => scored.push(text), err: (text) => scored.push(text), env: {} },
      COMMANDS,
    );
    expect(code).toBe(0);
    expect(scored.join("\n")).toContain("gm_spoiler");
  });

  it("writes its run folder under the output root, keeping each call's prompts and logs there", async () => {
    const at = scratch();
    expect((await suite(at, writeSuite(at, "fixture", FIXTURE_SUITE))).code).toBe(0);
    const files = filesUnder(path.join(at.out, "suites", "fixture"));
    expect(files).toContain("calls.jsonl");
    expect(files.filter((file) => file.endsWith("/suite.json"))).toHaveLength(1);
    expect(files.filter((file) => file.endsWith("/score.json"))).toHaveLength(1);
    expect(files.filter((file) => file.endsWith("/result.json"))).toHaveLength(FIXTURE_CALLS);
    expect(files.some((file) => /medal-gm-spoiler-game-judge-s0\/logs\/judge-gm_spoiler\.system\.txt$/.test(file))).toBe(true);
    const run = JSON.parse(fs.readFileSync(path.join(at.out, "suites", "fixture", files.find((file) => file.endsWith("/suite.json")) as string), "utf8"));
    expect(run).toMatchObject({ calls: { planned: FIXTURE_CALLS, made: FIXTURE_CALLS, recalled: 0, finished: FIXTURE_CALLS }, stopped: null, exit_code: 0 });
  });

  it("judges on every model a binding names and takes every sample, each its own verdict", async () => {
    const at = scratch();
    const file = writeSuite(at, "fixture", {
      subjects: { games: ["medal"] },
      judges: ["gm_spoiler"],
      models: { "game-judge": ["opus", "sonnet"] },
      samples: 2,
      thresholds: [{ judge: "gm_spoiler@sonnet", max_errors: 0 }],
    });
    const ran = await suite(at, file);
    expect(ran.code).toBe(0);
    const verdicts = resultsOf(at, "fixture").verdicts.map((verdict) => `${verdict.model}/${verdict.sample}`);
    expect(verdicts.sort()).toEqual(["opus/0", "opus/1", "sonnet/0", "sonnet/1"]);
    expect(ran.out).toContain("gm_spoiler@sonnet: 0 error(s), at most 0: met");
  });

  it("stores no prompt, log or workspace: only verdicts, and only in the results file", async () => {
    const at = scratch();
    const before = filesUnder(at.truth);
    expect((await suite(at, writeSuite(at, "fixture", FIXTURE_SUITE))).code).toBe(0);
    expect(filesUnder(at.truth)).toEqual([...before, "results/fixture.json"].sort());
    const text = fs.readFileSync(path.join(at.truth, "results", "fixture.json"), "utf8");
    for (const word of ["prompt", "system", "logs", "workspace", "evaluators", "reasoning", "answer", at.out]) expect(text).not.toContain(word);
    for (const verdict of resultsOf(at, "fixture").verdicts) {
      expect(Object.keys(verdict).sort()).toEqual(["cost_usd", "duration_ms", "findings", "judge", "model", "sample", "status", "subject"]);
    }
  });

  it("writes the results where --results says", async () => {
    const at = scratch();
    const elsewhere = path.join(at.dir, "elsewhere", "results.json");
    expect((await suite(at, writeSuite(at, "fixture", FIXTURE_SUITE), ["--results", elsewhere])).code).toBe(0);
    expect(fs.existsSync(elsewhere)).toBe(true);
    expect(fs.existsSync(path.join(at.truth, "results"))).toBe(false);
  });
});

describe("exit codes", () => {
  it("exits 2 when a threshold is not met, saying which", async () => {
    const at = scratch();
    const file = writeSuite(at, "fixture", {
      ...FIXTURE_SUITE,
      thresholds: [
        { judge: "gm_spoiler", min_real_of_reported: 0.9 },
        { judge: "age_appropriate_turn", min_found_of_real: 0.5 },
      ],
    });
    const ran = await suite(at, file);
    expect(ran.code).toBe(2);
    expect(ran.out).toMatch(/gm_spoiler spoiler: real of reported 0\.\d\d \(\d+\/\d+\), needs 0\.9: not met/);
    expect(ran.out).toContain("age_appropriate_turn not_age_fit: found of real unmeasured (0/0), needs 0.5: not met");
    // The results are stored all the same: a threshold judges them, it does not discard them.
    expect(resultsOf(at, "fixture").verdicts).toHaveLength(FIXTURE_CALLS);
  });

  it("exits 1 naming a missing binding, before any call", async () => {
    const at = scratch(ANSWERS, ["blueprint-judge", "game-judge"]);
    const ran = await suite(at, writeSuite(at, "fixture", FIXTURE_SUITE));
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('no binding "turn-judge"');
    expect(stubCalls(at)).toEqual([]);
  });

  it("exits 1 naming an unknown judge, a check, or a suite file that does not read", async () => {
    const at = scratch();
    const unknown = await suite(at, writeSuite(at, "fixture", { ...FIXTURE_SUITE, judges: ["gm_spoiler", "gm_mind_reader"] }));
    expect(unknown.code).toBe(1);
    expect(unknown.err).toContain('the suite names judge "gm_mind_reader", which is not in the registry');
    const check = await suite(at, writeSuite(at, "fixture", { ...FIXTURE_SUITE, judges: ["flesch"] }));
    expect(check.err).toContain('"flesch", which is a check, not a judge');
    const broken = path.join(at.dir, "broken.json");
    fs.writeFileSync(broken, "{ not json");
    expect((await suite(at, broken)).err).toContain("cannot be read as JSON");
    expect((await suite(at, writeSuite(at, "fixture", { judges: ["gm_spoiler"] }))).err).toContain("subjects: Required");
    const missing = await suite(at, "no-such-suite");
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no suite named "no-such-suite"');
    expect(stubCalls(at)).toEqual([]);
  });

  it("stores an ordinary judge failure as its error, counts it, and never makes it again", async () => {
    const at = scratch({ ...ANSWERS, gm_spoiler: undefined });
    const file = writeSuite(at, "fixture", { subjects: { games: ["medal"] }, judges: ["gm_spoiler"], thresholds: [{ max_errors: 0 }] });
    const first = await suite(at, file);
    expect(first.code).toBe(2);
    expect(first.out).toContain("gm_spoiler: 1 error(s), at most 0: not met");
    expect(resultsOf(at, "fixture").verdicts).toMatchObject([{ judge: "gm_spoiler", status: "error", findings: [] }]);
    expect((await suite(at, file)).code).toBe(2);
    expect(stubCalls(at)).toHaveLength(1);
    expect(journalLines(at, "fixture")).toHaveLength(1);
  });
});

describe("resuming", () => {
  it("makes only the calls a stopped run left, and ends with the results of an uninterrupted run", async () => {
    const whole = scratch();
    expect((await suite(whole, writeSuite(whole, "fixture", FIXTURE_SUITE))).code).toBe(0);

    const stopped = scratch();
    const file = writeSuite(stopped, "fixture", FIXTURE_SUITE);
    limitAfter(stopped, 7);
    expect((await suite(stopped, file)).code).toBe(1);
    // Calls side by side may each start before the seventh is counted, so a few more may finish.
    const madeBefore = stubCalls(stopped).length;
    expect(madeBefore).toBeGreaterThanOrEqual(7);
    expect(madeBefore).toBeLessThan(FIXTURE_CALLS);
    expect(journalLines(stopped, "fixture")).toHaveLength(madeBefore);

    // A run killed while it wrote a line leaves it torn; the next run cuts it off.
    fs.appendFileSync(path.join(stopped.out, "suites", "fixture", "calls.jsonl"), '{"subject":{"side":"ga');
    limitAfter(stopped, null);
    const resumed = await suite(stopped, file);
    expect(resumed.code).toBe(0);
    expect(resumed.out).toContain(`${FIXTURE_CALLS - madeBefore} call(s) made, ${madeBefore} finished before`);
    expect(stubCalls(stopped)).toHaveLength(FIXTURE_CALLS);
    expect(withoutDurations(resultsOf(stopped, "fixture"))).toEqual(withoutDurations(resultsOf(whole, "fixture")));
  });

  it("repeats nothing when nothing changed, and makes again only the calls whose prompt changed", async () => {
    const at = scratch();
    const file = writeSuite(at, "fixture", { subjects: { games: ["medal"], game_variants: ["medal-spoiler"] }, judges: ["gm_spoiler"] });
    expect((await suite(at, file)).code).toBe(0);
    expect((await suite(at, file)).code).toBe(0);
    expect(stubCalls(at)).toHaveLength(2);

    // Another plant on the variant changes what its judge is sent, so only that call is made again.
    const variant = path.join(at.truth, "plants", "turns", "medal-spoiler.json");
    const planted = JSON.parse(fs.readFileSync(variant, "utf8"));
    planted.plants[0].edits[0].replace += " He grins.";
    fs.writeFileSync(variant, JSON.stringify(planted));
    expect((await suite(at, file)).code).toBe(0);
    expect(stubCalls(at)).toHaveLength(3);
  });

  it("fails naming the journal when a line other than the last does not read", async () => {
    const at = scratch();
    const file = writeSuite(at, "fixture", { subjects: { games: ["medal"] }, judges: ["gm_spoiler"] });
    expect((await suite(at, file)).code).toBe(0);
    const journal = path.join(at.out, "suites", "fixture", "calls.jsonl");
    fs.writeFileSync(journal, `{"broken": true}\n${fs.readFileSync(journal, "utf8")}`);
    const ran = await suite(at, file);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain(`${journal}: line 1 is not a finished call`);
  });
});

describe("the usage limit", () => {
  it("stops with exit 1 and the CLI's message, stores no error, and the next run finishes repeating nothing", async () => {
    const at = scratch();
    // One subject at a time, and one call to each: the stop comes exactly after the third.
    const file = writeSuite(at, "fixture", { ...FIXTURE_SUITE, concurrency: 1 });
    limitAfter(at, 3);
    const stopped = await suite(at, file);
    expect(stopped.code).toBe(1);
    expect(stopped.err).toContain("usage limit is reached");
    expect(stopped.err).toContain("You've hit your 5-hour limit · resets 3pm (Europe/London)");
    expect(stopped.err).toContain(`3 of ${FIXTURE_CALLS} call(s) are finished`);
    expect(fs.existsSync(path.join(at.truth, "results", "fixture.json"))).toBe(false);
    expect(journalLines(at, "fixture").map((line) => (line.finished as { ok: boolean }).ok)).toEqual([true, true, true]);
    const runFile = filesUnder(path.join(at.out, "suites", "fixture")).find((name) => name.endsWith("/suite.json")) as string;
    expect(JSON.parse(fs.readFileSync(path.join(at.out, "suites", "fixture", runFile), "utf8"))).toMatchObject({ results: null, exit_code: 1 });

    limitAfter(at, null);
    const resumed = await suite(at, file);
    expect(resumed.code).toBe(0);
    expect(stubCalls(at)).toHaveLength(FIXTURE_CALLS);
    expect(resultsOf(at, "fixture").verdicts.filter((verdict) => verdict.status === "error")).toEqual([]);
  });

  it.each([
    ["a blueprint judge", { bases: ["mock"] }, "fairness"],
    ["a game judge", { games: ["medal"] }, "gm_spoiler"],
    ["a turn judge", { games: ["medal"] }, "age_appropriate_turn"],
  ])("stops %s's harness, not only the suite's own code", async (_what, subjects, judge) => {
    const at = scratch();
    limitAfter(at, 0);
    const ran = await suite(at, writeSuite(at, "fixture", { subjects, judges: [judge] }));
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("You've hit your 5-hour limit");
    expect(journalLines(at, "fixture")).toEqual([]);
  });
});

describe("judges and subjects", () => {
  it("runs a judge outside the default battery when the suite names it, storing its findings by kind", async () => {
    const { judgesFor } = await import("../../../evaluation/core/registry.ts");
    expect(judgesFor("game").map((entry) => entry.id)).not.toContain("gm_broad");
    expect(judgesFor("blueprint").map((entry) => entry.id)).not.toContain("solve_depth_fairness");
    const at = scratch();
    const file = writeSuite(at, "fixture", {
      subjects: { blueprint_plants: "all", game_variants: ["medal-spoiler"] },
      judges: ["gm_broad", "solve_depth_fairness"],
      thresholds: [{ judge: "gm_broad", kind: "spoiler", min_found_of_real: 1 }],
    });
    const ran = await suite(at, file);
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(stubCalls(at).sort()).toEqual(["gm_broad", "solve_depth_fairness"]);
    const verdicts = resultsOf(at, "fixture").verdicts;
    expect(verdicts.find((verdict) => verdict.judge === "gm_broad")).toMatchObject({ status: "fail", findings: [{ sequence: 4, kinds: ["spoiler"] }] });
    expect(verdicts.find((verdict) => verdict.judge === "solve_depth_fairness")).toMatchObject({ status: "fail", findings: [{ kinds: ["fairness"] }] });
    expect(ran.out).toContain("gm_broad spoiler: found of real 1.00 (1/1), needs 1: met");
  });

  it("refuses what it could see is wrong before any call, naming it", async () => {
    const at = scratch();
    const cases: Array<[unknown, string]> = [
      [{ ...FIXTURE_SUITE, subjects: { games: ["chess"] } }, 'subjects.games names "chess", which the truth set does not have'],
      [{ subjects: { games: ["medal"] }, judges: ["fairness"] }, '"fairness" judges bases and planted blueprints'],
      [{ ...FIXTURE_SUITE, models: { "investigator": ["opus"] } }, 'models names binding "investigator", which no judge of the suite calls'],
      [{ ...FIXTURE_SUITE, thresholds: [{ judge: "gm_roleplay", max_errors: 0 }] }, 'thresholds.0.judge: "gm_roleplay" is not one of the suite\'s judges'],
      [{ ...FIXTURE_SUITE, thresholds: [{ judge: "gm_spoiler@haiku", max_errors: 0 }] }, '"gm_spoiler" runs on game-judge, not "haiku"'],
      [{ ...FIXTURE_SUITE, thresholds: [{ judge: "gm_spoiler", kind: "fairness", max_errors: 0 }] }, 'thresholds.0.kind: "fairness" is not a kind of "gm_spoiler"'],
      [{ ...FIXTURE_SUITE, thresholds: [{ kind: "tone", max_errors: 0 }] }, '"tone" is not a kind of the suite\'s judges'],
      [{ ...FIXTURE_SUITE, thresholds: [{ judge: "gm_spoiler" }] }, "a threshold sets min_found_of_real, min_real_of_reported or max_errors"],
      [{ ...FIXTURE_SUITE, judges: ["gm_spoiler", "gm_spoiler"] }, "a judge is named once"],
      [{ ...FIXTURE_SUITE, subjects: {} }, "a suite names at least one part"],
    ];
    for (const [body, message] of cases) {
      const ran = await suite(at, writeSuite(at, "fixture", body));
      expect(ran.code, message).toBe(1);
      expect(ran.err, message).toContain(message);
    }
    expect(stubCalls(at)).toEqual([]);
  });

  it("fails naming a plant that no longer applies to its base", async () => {
    const at = scratch();
    const plant = path.join(at.truth, "plants", "turns", "medal-spoiler.json");
    const planted = JSON.parse(fs.readFileSync(plant, "utf8"));
    planted.plants[0].edits[0].find = "words the narration never says";
    fs.writeFileSync(plant, JSON.stringify(planted));
    const ran = await suite(at, writeSuite(at, "fixture", { subjects: { game_variants: "all" }, judges: ["gm_spoiler"] }));
    expect(ran.code).toBe(1);
    expect(ran.err).toContain('a plant does not apply: variant "medal-spoiler"');
  });
});

describe("the committed suites", () => {
  it("each read as a suite file and name registry judges only", async () => {
    const dir = path.join(ROOT, SUITES_DIR);
    const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
    expect(files.length).toBeGreaterThan(0);
    const { findEntry } = await import("../../../evaluation/core/registry.ts");
    for (const name of files) {
      const { suite: read } = readSuiteFile(path.join(dir, name));
      for (const judge of read.judges) expect(findEntry(judge)?.type, `${name}: ${judge}`).toBe("judge");
    }
  });
});
