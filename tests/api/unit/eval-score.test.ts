import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { loadTruthSet, readResultsFile } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { MAX_MEMBERS_PER_SIDE, scoreVerdicts } from "../../../evaluation/lib/truth/score.ts";
import type { MemberScore, ScoreReport, SideScore } from "../../../evaluation/lib/truth/score.ts";
import { STORED_RESULTS_VERSION } from "../../../evaluation/lib/truth/schemas.ts";
import type { StoredFinding, StoredSubject, StoredVerdict } from "../../../evaluation/lib/truth/schemas.ts";
import { wilson } from "../../../evaluation/lib/truth/wilson.ts";

const ROOT = repoRoot();
const FIXTURE = path.join(ROOT, "tests/api/unit/fixtures/truth");
const FIXTURE_RESULTS = path.join(FIXTURE, "results/fixture-run.json");

const MEDAL: StoredSubject = { side: "game", game: "medal", variant: null, sequence: null };
const MEDAL_SPOILER: StoredSubject = { side: "game", game: "medal", variant: "medal-spoiler", sequence: null };
const MOCK: StoredSubject = { side: "blueprint", base: "mock", plant: null };
const MOCK_PLANT: StoredSubject = { side: "blueprint", base: "mock", plant: "mock-bob-not-ruled-out" };

let set: TruthSet;
beforeAll(async () => {
  set = await loadTruthSet(FIXTURE);
});

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-score-"));
  scratch.push(dir);
  return dir;
}

function finding(sequence: number | null, kind: string, severity: "minor" | "major" = "major"): StoredFinding {
  return { sequence, kinds: [kind], severity, judge_kind: null };
}

function verdict(overrides: Partial<StoredVerdict> & Pick<StoredVerdict, "subject" | "judge">): StoredVerdict {
  return { model: "opus", sample: 0, status: "pass", findings: [], duration_ms: 1000, cost_usd: 0.1, ...overrides };
}

/** A fabrication finding at the fixture's one labelled fabrication (turn 7), or none. */
function fabrication(sample: number, catches: boolean, overrides: Partial<StoredVerdict> = {}): StoredVerdict {
  return verdict({
    subject: MEDAL,
    judge: "gm_fabrication",
    sample,
    status: catches ? "fail" : "pass",
    findings: catches ? [finding(7, "fabrication")] : [],
    ...overrides,
  });
}

function side(report: ScoreReport, which: "game" | "blueprint"): SideScore {
  const found = report.sides.find((candidate) => candidate.side === which);
  if (!found) throw new Error(`no ${which} side in the report`);
  return found;
}

function member(report: ScoreReport, which: "game" | "blueprint", id: string): MemberScore {
  const found = side(report, which).members.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
}

function smallest(report: ScoreReport, which: "game" | "blueprint"): string[] | undefined {
  return side(report, which).smallest?.members;
}

describe("Wilson ranges", () => {
  it("give about 0.44 to 0.97 for 5 of 6 and 0.70 to 0.97 for 18 of 20", () => {
    const small = wilson(5, 6);
    expect(small.low).toBeCloseTo(0.436, 2);
    expect(small.high).toBeCloseTo(0.97, 2);
    const large = wilson(18, 20);
    expect(large.low).toBeCloseTo(0.699, 2);
    expect(large.high).toBeCloseTo(0.972, 2);
    expect(large.share).toBe(0.9);
  });

  it("stay inside 0 to 1 at 0 of n and n of n, and are empty for 0 of 0", () => {
    for (const n of [1, 3, 20, 500]) {
      const none = wilson(0, n);
      const all = wilson(n, n);
      expect(none.low).toBe(0);
      expect(none.high).toBeGreaterThan(0);
      expect(none.high).toBeLessThanOrEqual(1);
      expect(all.high).toBe(1);
      expect(all.low).toBeGreaterThanOrEqual(0);
      expect(all.low).toBeLessThan(1);
    }
    expect(wilson(0, 0)).toEqual({ hits: 0, of: 0, share: null, low: null, high: null });
  });

  it("refuse counts that are not a share", () => {
    expect(() => wilson(3, 2)).toThrow("0 <= hits <= of");
    expect(() => wilson(-1, 2)).toThrow();
    expect(() => wilson(0.5, 2)).toThrow();
  });
});

describe("scoring a judge and kind", () => {
  it("leaves units of unknown truth out of both shares and counts them apart", () => {
    // On the stored game, turn 7 is a fabrication, turns 2 and 4 are clean, and the other six are unlabelled.
    const report = scoreVerdicts(set, [
      fabrication(0, true, { findings: [finding(7, "fabrication"), finding(5, "fabrication"), finding(2, "fabrication")] }),
    ]);
    const [kind] = member(report, "game", "gm_fabrication").kinds;
    expect(kind.units).toEqual({ fault: 1, clean: 2, unknown: 6 });
    expect(kind.shares.real_of_reported).toMatchObject({ hits: 1, of: 2 });
    expect(kind.shares.found_of_real).toMatchObject({ hits: 1, of: 1 });
    expect(kind.shares.unknown_reported).toBe(1);
  });

  it("counts a minor finding as a report, and gives the counts for major findings alone beside", () => {
    const report = scoreVerdicts(set, [fabrication(0, true, { findings: [finding(7, "fabrication", "minor"), finding(2, "fabrication")] })]);
    const [kind] = member(report, "game", "gm_fabrication").kinds;
    expect(kind.shares.real_of_reported).toMatchObject({ hits: 1, of: 2 });
    expect(kind.shares.found_of_real).toMatchObject({ hits: 1, of: 1 });
    expect(kind.major_only.real_of_reported).toMatchObject({ hits: 0, of: 1 });
    expect(kind.major_only.found_of_real).toMatchObject({ hits: 0, of: 1 });
  });

  it("catches by the majority of three samples, and measures how often they agree", () => {
    const report = scoreVerdicts(set, [fabrication(0, true), fabrication(1, true), fabrication(2, false)]);
    const score = member(report, "game", "gm_fabrication");
    expect(score.samples).toBe(3);
    expect(score.kinds[0].shares.found_of_real).toMatchObject({ hits: 1, of: 1 });
    // Turn 7 splits the samples; the other eight turns they agree on.
    expect(score.kinds[0].agreement).toEqual({ share: 8 / 9, units: 9 });
  });

  it("does not count a tie over two samples as a catch", () => {
    const report = scoreVerdicts(set, [fabrication(0, true), fabrication(1, false)]);
    expect(member(report, "game", "gm_fabrication").kinds[0].shares.found_of_real).toMatchObject({ hits: 0, of: 1 });
  });

  it("reports agreement with one sample as unmeasured, not as 100%", () => {
    const report = scoreVerdicts(set, [fabrication(0, true)]);
    expect(member(report, "game", "gm_fabrication").kinds[0].agreement).toEqual({ share: null, units: 0 });
  });

  it("lets only samples that judged vote, and counts the rest", () => {
    const report = scoreVerdicts(set, [
      fabrication(0, true),
      fabrication(1, false, { status: "error", duration_ms: null, cost_usd: null }),
      fabrication(2, false, { status: "skipped" }),
    ]);
    const score = member(report, "game", "gm_fabrication");
    expect(score.not_judged).toBe(2);
    expect(score.kinds[0].shares.found_of_real).toMatchObject({ hits: 1, of: 1 });
    expect(score.delay_ms).toBeNull();
  });

  it("counts findings that point at no turn of what was judged, which catch nothing", () => {
    const report = scoreVerdicts(set, [fabrication(0, true, { findings: [finding(null, "fabrication"), finding(99, "fabrication")] })]);
    const score = member(report, "game", "gm_fabrication");
    expect(score.findings_off_turn).toBe(2);
    expect(score.kinds[0].shares.real_of_reported).toMatchObject({ hits: 0, of: 0 });
  });

  it("scores a judge of one turn on that turn only, and the same judge on two models as two judges", () => {
    const turn = (model: string, status: "pass" | "fail"): StoredVerdict =>
      verdict({ subject: { ...MEDAL, sequence: 7 }, judge: "age_appropriate_turn", model, status, findings: status === "fail" ? [finding(7, "not_age_fit")] : [] });
    const report = scoreVerdicts(set, [turn("sonnet", "fail"), turn("haiku", "pass")]);
    expect(side(report, "game").members.map((score) => score.id)).toEqual(["age_appropriate_turn@haiku", "age_appropriate_turn@sonnet"]);
    // Turn 7 is labelled with fabrications only, so it is clean for not_age_fit.
    expect(member(report, "game", "age_appropriate_turn@sonnet").kinds[0].units).toEqual({ fault: 0, clean: 1, unknown: 0 });
    expect(side(report, "game").subsets.find((subset) => subset.members.length === 1 && subset.members[0].endsWith("sonnet"))?.false_reports).toBe(1);
  });
});

describe("scoring subsets", () => {
  it("scores the fixture results: the union of what members catch, and the lose-nothing set", async () => {
    const report = scoreVerdicts(set, await readResultsFile(set, FIXTURE_RESULTS));
    const game = side(report, "game");
    expect(game.subsets).toHaveLength(8);
    expect(game.subsets[0]).toMatchObject({ members: [], found: 0, delay_ms: 0, usage_usd: 0 });
    expect(game.faults).toBe(2);
    expect(game.full_found).toBe(2);
    const pair = game.subsets.find((subset) => subset.members.join() === "gm_fabrication,gm_spoiler");
    expect(pair).toMatchObject({ found: 2, found_by_kind: { fabrication: 1, spoiler: 1 }, meets_bar: true, delay_ms: 79000, usage_usd: null });
    expect(game.subsets.filter((subset) => subset.meets_bar).map((subset) => subset.members.length)).toEqual([2, 3]);
    expect(smallest(report, "game")).toEqual(["gm_fabrication", "gm_spoiler"]);
    expect(smallest(report, "blueprint")).toEqual(["fairness"]);
  });

  it("names the empty set when the full battery catches nothing", () => {
    const report = scoreVerdicts(set, [fabrication(0, false)]);
    expect(smallest(report, "game")).toEqual([]);
  });

  it("breaks a tie in size by the shorter delay, then by the lower usage, a known usage beating an unknown", () => {
    // A judge is scored on its own kind only, so two judges that catch the one plant are one judge on two models.
    const fairness = (model: string, duration_ms: number | null, cost_usd: number | null): StoredVerdict =>
      verdict({ subject: MOCK_PLANT, judge: "fairness", model, status: "fail", findings: [finding(null, "fairness")], duration_ms, cost_usd });

    // Each winner's name sorts last, so the listing's order alone would pick the loser.
    expect(smallest(scoreVerdicts(set, [fairness("a-slow", 9000, 0.1), fairness("z-fast", 1000, 0.9)]), "blueprint")).toEqual(["fairness@z-fast"]);
    expect(smallest(scoreVerdicts(set, [fairness("a-dear", 1000, 0.9), fairness("z-cheap", 1000, 0.1)]), "blueprint")).toEqual(["fairness@z-cheap"]);
    expect(smallest(scoreVerdicts(set, [fairness("a-unknown", 1000, null), fairness("z-known", 1000, 5)]), "blueprint")).toEqual(["fairness@z-known"]);
    // An unknown delay loses to a known one too.
    expect(smallest(scoreVerdicts(set, [fairness("a-untimed", null, 0.1), fairness("z-timed", 9000, 0.1)]), "blueprint")).toEqual(["fairness@z-timed"]);
  });

  it("takes delay per stored subject as the slowest member, summed, with a member's samples averaged and its turns summed", () => {
    const turn = (sequence: number, sample: number, duration_ms: number): StoredVerdict =>
      verdict({ subject: { ...MEDAL, sequence }, judge: "age_appropriate_turn", sample, duration_ms, cost_usd: 0.01 });
    const report = scoreVerdicts(set, [
      // Two turns, two samples: (2 + 4) and (4 + 6) seconds, averaging 8.
      turn(2, 0, 2000),
      turn(4, 0, 4000),
      turn(2, 1, 4000),
      turn(4, 1, 6000),
      fabrication(0, true, { duration_ms: 5000, cost_usd: 0.5 }),
      fabrication(0, true, { subject: MEDAL_SPOILER, duration_ms: 3000, cost_usd: 0.25 }),
    ]);
    expect(member(report, "game", "age_appropriate_turn")).toMatchObject({ delay_ms: 8000 });
    expect(member(report, "game", "age_appropriate_turn").usage_usd).toBeCloseTo(0.02, 10);
    const all = side(report, "game").subsets.at(-1);
    // The stored game: max(8, 5); the variant: 3.
    expect(all?.delay_ms).toBe(11000);
    expect(all?.usage_usd).toBeCloseTo(0.77, 10);
  });

  it("meets a floor on the share found when one is given instead", () => {
    const report = scoreVerdicts(
      set,
      [fabrication(0, true), verdict({ subject: MEDAL_SPOILER, judge: "gm_spoiler", status: "pass" })],
      { kind: "min_found", share: 0.5 },
    );
    expect(side(report, "game").faults).toBe(2);
    expect(smallest(report, "game")).toEqual(["gm_fabrication"]);
    expect(report.rules.bar.text).toContain("0.5");
    const strict = scoreVerdicts(set, [verdict({ subject: MEDAL_SPOILER, judge: "gm_spoiler", status: "pass" })], { kind: "min_found", share: 1 });
    expect(side(strict, "game").smallest).toBeNull();
  });

  it("orders judges by code point, not by locale, so the report is the same on every machine", () => {
    const report = scoreVerdicts(set, [verdict({ subject: MOCK, judge: "fairness", model: "a" }), verdict({ subject: MOCK, judge: "fairness", model: "B" })]);
    expect(side(report, "blueprint").members.map((score) => score.id)).toEqual(["fairness@B", "fairness@a"]);
  });

  it(`stops with the count above ${MAX_MEMBERS_PER_SIDE} judges on a side`, () => {
    const many = Array.from({ length: MAX_MEMBERS_PER_SIDE + 1 }, (_, index) => verdict({ subject: MOCK, judge: "fairness", model: `m${index}` }));
    expect(() => scoreVerdicts(set, many)).toThrow(`the blueprint side has ${MAX_MEMBERS_PER_SIDE + 1} judges`);
    expect(() => scoreVerdicts(set, many.slice(1))).not.toThrow();
  });
});

// ---------------------------------------------------------------------------

/** A bindings file in which every binding points at a command that does not exist. */
async function unrunnableConfig(dir: string): Promise<string> {
  const example = JSON.parse(await fs.readFile(path.join(ROOT, "evaluation/config.example.json"), "utf8")) as Record<string, unknown>;
  const config = Object.fromEntries(
    Object.entries(example).map(([name, binding]) => [
      name,
      typeof binding === "object" && binding !== null ? { ...binding, cmd: path.join(dir, `missing-${name}`) } : binding,
    ]),
  );
  const file = path.join(dir, "config.json");
  await fs.writeFile(file, JSON.stringify(config), "utf8");
  return file;
}

async function score(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(["score", ...argv], { root: ROOT, out: (text) => out.push(text), err: (text) => err.push(text), env }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function writeResults(file: string, verdicts: StoredVerdict[]): Promise<string> {
  await fs.writeFile(file, JSON.stringify({ schema_version: STORED_RESULTS_VERSION, verdicts }), "utf8");
  return file;
}

describe("./dev eval score", () => {
  it("runs on the fixture with bindings that cannot run, prints the tables, writes the report and exits 0", async () => {
    const dir = await tempDir();
    const out = path.join(dir, "report.json");
    const ran = await score(["fixture-run", "--truth", FIXTURE, "--out", out, "--config", await unrunnableConfig(dir)]);
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("Blueprint side: 1 judge, 1 real fault judged");
    expect(ran.out).toContain("Game side: 3 judges, 2 real faults judged");
    expect(ran.out).toContain("Smallest that loses no fault the full battery catches: gm_fabrication + gm_spoiler.");
    expect(ran.out).toContain("fairness: 1 of 2 verdicts did not judge");
    const report = JSON.parse(await fs.readFile(out, "utf8")) as ScoreReport & { inputs: { truth: string; results: string[] } };
    expect(report.inputs).toEqual({ truth: "tests/api/unit/fixtures/truth", results: ["tests/api/unit/fixtures/truth/results/fixture-run.json"] });
    expect(smallest(report, "game")).toEqual(["gm_fabrication", "gm_spoiler"]);
  });

  it("writes byte-identical files from the same inputs", async () => {
    const dir = await tempDir();
    const extra = await writeResults(path.join(dir, "extra.json"), [fabrication(0, true), fabrication(1, false), fabrication(2, true)]);
    const first = path.join(dir, "first.json");
    const second = path.join(dir, "second.json");
    expect((await score([FIXTURE_RESULTS, extra, "--truth", FIXTURE, "--out", first])).code).toBe(0);
    expect((await score([FIXTURE_RESULTS, extra, "--truth", FIXTURE, "--out", second])).code).toBe(0);
    expect(await fs.readFile(second)).toEqual(await fs.readFile(first));
  });

  it("writes into a new run folder under the output root without --out", async () => {
    const dir = await tempDir();
    const ran = await score(["fixture-run", "--truth", FIXTURE, "--output-root", dir]);
    expect(ran.code).toBe(0);
    const [day] = await fs.readdir(dir);
    const [run] = await fs.readdir(path.join(dir, day));
    expect(run).toMatch(/-score$/);
    expect(await fs.readdir(path.join(dir, day, run))).toEqual(["score.json"]);
  });

  it("takes a floor on the share found with --min-found, and refuses one outside 0 to 1", async () => {
    const dir = await tempDir();
    const ran = await score(["fixture-run", "--truth", FIXTURE, "--out", path.join(dir, "r.json"), "--min-found", "0.5"]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("Smallest that finds at least 0.5 of the real faults on its side: gm_spoiler.");
    const refused = await score(["fixture-run", "--truth", FIXTURE, "--min-found", "2"]);
    expect(refused.code).toBe(1);
    expect(refused.err).toContain("--min-found takes a share from 0 to 1");
  });

  it("exits 1 when the inputs cannot be read", async () => {
    const dir = await tempDir();
    const missing = await score([path.join(dir, "nope.json"), "--truth", FIXTURE]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain('no results named');

    await fs.writeFile(path.join(dir, "broken.json"), "{", "utf8");
    const broken = await score([path.join(dir, "broken.json"), "--truth", FIXTURE]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("is not JSON");

    const stray = await writeResults(path.join(dir, "stray.json"), [verdict({ subject: { ...MEDAL, game: "absent" }, judge: "gm_spoiler" })]);
    const strayRun = await score([stray, "--truth", FIXTURE]);
    expect(strayRun.code).toBe(1);
    expect(strayRun.err).toContain('no stored game "absent"');

    const noSet = await score(["fixture-run", "--truth", path.join(dir, "no-set")]);
    expect(noSet.code).toBe(1);
    expect(noSet.err).toContain("is not a folder");

    const twice = await score(["fixture-run", FIXTURE_RESULTS, "--truth", FIXTURE]);
    expect(twice.code).toBe(1);
    expect(twice.err).toContain("is also in tests/api/unit/fixtures/truth/results/fixture-run.json");
  });

  it("exits 1 naming the count when a side has more than 16 judges", async () => {
    const dir = await tempDir();
    const many = await writeResults(
      path.join(dir, "many.json"),
      Array.from({ length: 17 }, (_, index) => verdict({ subject: MOCK, judge: "fairness", model: `m${index}` })),
    );
    const ran = await score([many, "--truth", FIXTURE, "--out", path.join(dir, "r.json")]);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("the blueprint side has 17 judges");
  });

  it("needs at least one results argument", async () => {
    const ran = await score(["--truth", FIXTURE]);
    expect(ran.code).toBe(1);
    expect(ran.err).toContain("expected at least 1 argument");
  });

  it("says in its help which findings count as a report", async () => {
    const ran = await score(["--help"]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("A finding of either");
    expect(ran.out).toContain("--min-found <share>");
  });

  it("reports no sides when the results hold no verdicts", async () => {
    const dir = await tempDir();
    const empty = await writeResults(path.join(dir, "empty.json"), []);
    const ran = await score([empty, "--truth", FIXTURE, "--out", path.join(dir, "r.json")]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("No verdicts to score.");
  });
});
