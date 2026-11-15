import { afterEach, beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { LISTED } from "../../../evaluation/compare/table.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { compareRuns, signTest } from "../../../evaluation/lib/truth/compare.ts";
import type { CompareReport, KindComparison, MemberComparison, SideComparison } from "../../../evaluation/lib/truth/compare.ts";
import { loadTruthSet, readResultsFile } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { STORED_RESULTS_VERSION } from "../../../evaluation/lib/truth/schemas.ts";
import type { StoredSubject, StoredVerdict } from "../../../evaluation/lib/truth/schemas.ts";

const ROOT = repoRoot();
const FIXTURE = path.join(ROOT, "tests/api/unit/fixtures/truth");
const FIXTURE_RESULTS = path.join(FIXTURE, "results/fixture-run.json");

const MEDAL: StoredSubject = { side: "game", game: "medal", variant: null, sequence: null };
const MEDAL_SPOILER: StoredSubject = { side: "game", game: "medal", variant: "medal-spoiler", sequence: null };

let set: TruthSet;
beforeAll(async () => {
  set = await loadTruthSet(FIXTURE);
});

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-compare-"));
  scratch.push(dir);
  return dir;
}

/** One sample of gm_fabrication on the stored game, finding fabrications at `turns`. */
function fabrication(sample: number, turns: number[], overrides: Partial<StoredVerdict> = {}): StoredVerdict {
  return {
    subject: MEDAL,
    judge: "gm_fabrication",
    model: "opus",
    sample,
    status: turns.length > 0 ? "fail" : "pass",
    findings: turns.map((sequence) => ({ sequence, kinds: ["fabrication"], severity: "major", judge_kind: null })),
    duration_ms: 1000,
    cost_usd: 0.1,
    ...overrides,
  };
}

/** A run of gm_fabrication: one sample per entry, each finding fabrications at its turns. */
function run(samples: number[][], overrides: Partial<StoredVerdict> = {}): StoredVerdict[] {
  return samples.map((turns, sample) => fabrication(sample, turns, overrides));
}

function game(report: CompareReport): SideComparison {
  const found = report.sides.find((side) => side.side === "game");
  if (!found) throw new Error("no game side in the report");
  return found;
}

function member(report: CompareReport, id = "gm_fabrication"): MemberComparison {
  const found = game(report).members.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`no member ${id}`);
  return found;
}

function kind(report: CompareReport, id = "gm_fabrication"): KindComparison {
  return member(report, id).kinds[0];
}

const FIRST_EIGHT = [1, 2, 3, 4, 5, 6, 7, 8];

describe("the sign test", () => {
  it("is exact: 5 to 0 is 0.0625, 6 to 0 is 0.03125, an even split is 1, and 2 of 14 is 0.0129", () => {
    expect(signTest(5, 0)).toBeCloseTo(0.0625, 10);
    expect(signTest(0, 6)).toBeCloseTo(0.03125, 10);
    expect(signTest(3, 3)).toBe(1);
    expect(signTest(0, 0)).toBe(1);
    expect(signTest(12, 2)).toBeCloseTo(0.012939, 5);
  });

  it("stays a chance, and finite, for hundreds of differences", () => {
    expect(signTest(600, 0)).toBeGreaterThanOrEqual(0);
    expect(signTest(600, 0)).toBeLessThan(1e-100);
    expect(signTest(300, 300)).toBe(1);
  });
});

describe("comparing two runs", () => {
  it("finds no difference between two identical runs", () => {
    const samples = [[7], [7, 3], [7]];
    const report = compareRuns(set, run(samples), run(samples));
    const result = kind(report);
    expect(result).toMatchObject({ paired: 9, outcome: "same", p: null, differences: [], catches: { a: 1, b: 1 } });
    expect(result.differing).toEqual({ a_only: 0, b_only: 0 });
    expect(result.agreement.a).toEqual({ share: 8 / 9, units: 9 });
    expect(result.agreement.b).toEqual(result.agreement.a);
  });

  it("flags a large paired difference the samples agree on, and names who catches more", () => {
    const report = compareRuns(set, run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT]), run([[], [], []]));
    const result = kind(report);
    expect(result.outcome).toBe("differs");
    expect(result.firm).toEqual({ a_only: 8, b_only: 0 });
    expect(result.p).toBeCloseTo(2 / 256, 10);
    expect(result.differences).toHaveLength(8);
    expect(result.differences[0]).toMatchObject({ unit: "game medal, turn 1", catching: "a", call: "firm", truth: "unknown", a: { catches: 3, of: 3 }, b: { catches: 0, of: 3 } });
    // Turn 7 is a labelled fabrication, turn 2 is labelled clean of it.
    expect(result.differences.find((difference) => difference.unit.endsWith("turn 7"))?.truth).toBe("fault");
    expect(result.differences.find((difference) => difference.unit.endsWith("turn 2"))?.truth).toBe("clean");

    const reversed = kind(compareRuns(set, run([[], [], []]), run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT])));
    expect(reversed.outcome).toBe("differs");
    expect(reversed.firm).toEqual({ a_only: 0, b_only: 8 });
  });

  it("does not flag a difference within the samples' own disagreement", () => {
    // Run A catches by two samples in three on every turn, so each of its units splits.
    const report = compareRuns(set, run([FIRST_EIGHT, [], FIRST_EIGHT]), run([[], [], []]));
    const result = kind(report);
    expect(result).toMatchObject({ outcome: "within_variation", p: null, within_variation: 8, unmeasured: 0 });
    expect(result.firm).toEqual({ a_only: 0, b_only: 0 });
    expect(result.differences.every((difference) => difference.call === "within_variation")).toBe(true);
    expect(result.agreement.a).toEqual({ share: 1 / 9, units: 9 });
  });

  it("counts only the firm differences when some are within variation", () => {
    // A is unanimous on turns 1 to 3 and split on 4 to 8; B catches nothing.
    const report = compareRuns(set, run([FIRST_EIGHT, [1, 2, 3], FIRST_EIGHT]), run([[], [], []]));
    const result = kind(report);
    expect(result.firm).toEqual({ a_only: 3, b_only: 0 });
    expect(result.within_variation).toBe(5);
    expect(result.differences.map((difference) => difference.call)).toEqual(["firm", "firm", "firm", "within_variation", "within_variation", "within_variation", "within_variation", "within_variation"]);

    const mixed = kind(compareRuns(set, run([[1, 2, 3, 4], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6, 7, 8]]), run([[], [], []])));
    // Turns 1 to 4 are firm; turns 5 to 8 catch in one sample in three, so neither run catches them.
    expect(mixed.differing).toEqual({ a_only: 4, b_only: 0 });
    expect(mixed.firm).toEqual({ a_only: 4, b_only: 0 });
    expect(mixed.p).toBeCloseTo(0.125, 10);
    expect(mixed.outcome).toBe("not_shown");
  });

  it("does not call firm differences too few to rule out chance", () => {
    const result = kind(compareRuns(set, run([[1, 2, 3], [1, 2, 3], [1, 2, 3]]), run([[], [], []])));
    expect(result).toMatchObject({ outcome: "not_shown", firm: { a_only: 3, b_only: 0 } });
    expect(result.p).toBeCloseTo(0.25, 10);
  });

  it("compares a unit on the first samples both runs have, so a run with more samples is not favoured", () => {
    // Each run has its own unanimous catches on turns 1 to 4 and none elsewhere. A has two samples, B five.
    // Judged on all five of B's samples, a turn caught in only some of them would read as a firm miss for B.
    const a = run([[1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]);
    const b = run([[1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]]);
    const result = kind(compareRuns(set, a, b));
    // On B's first two samples (1-4 and 1-6) turns 5 and 6 are caught once of two: a tie, so not a catch, and split.
    expect(result.differing).toEqual({ a_only: 2, b_only: 0 });
    expect(result.firm).toEqual({ a_only: 0, b_only: 0 });
    expect(result.within_variation).toBe(2);
    expect(result.differences[0].b).toEqual({ catches: 1, of: 2 });
    expect(result.outcome).toBe("within_variation");

    // Judged on all samples, B would catch turns 5 and 6 by majority of five and look firm against nothing:
    // the runs behave alike, and must not be called different either way round.
    const swapped = kind(compareRuns(set, b, a));
    expect(swapped.outcome).toBe("within_variation");
    expect(swapped.firm).toEqual({ a_only: 0, b_only: 0 });
  });

  it("ignores the samples beyond the count both runs have, whichever run has them", () => {
    // B's first two samples are A's; its later three are not part of the comparison.
    const a = run([FIRST_EIGHT, FIRST_EIGHT]);
    const b = run([FIRST_EIGHT, FIRST_EIGHT, [], [], []]);
    for (const result of [kind(compareRuns(set, a, b)), kind(compareRuns(set, b, a))]) {
      expect(result.outcome).toBe("same");
      expect(result.differing).toEqual({ a_only: 0, b_only: 0 });
      expect(result.agreement.a.units).toBe(9);
      expect(result.agreement.b.units).toBe(9);
    }
  });

  it("does not call an even split of firm differences", () => {
    const result = kind(compareRuns(set, run([[1, 2, 3], [1, 2, 3]]), run([[4, 5, 6], [4, 5, 6]])));
    expect(result).toMatchObject({ outcome: "not_shown", firm: { a_only: 3, b_only: 3 }, p: 1 });
  });

  it("lists units one run alone judged and leaves them out of the test", () => {
    // B also judged the variant, and the variant's nine turns are not in A.
    const b = [...run([[], [], []]), ...run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT], { subject: MEDAL_SPOILER })];
    const report = compareRuns(set, run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT]), b);
    const result = kind(report);
    expect(result.paired).toBe(9);
    expect(result.only_in.a).toEqual([]);
    expect(result.only_in.b).toHaveLength(9);
    expect(result.only_in.b[0]).toBe("game medal, variant medal-spoiler, turn 1");
    // The variant's catches are not compared: only the paired stored game's turns are.
    expect(result.firm).toEqual({ a_only: 8, b_only: 0 });
    expect(result.differences.every((difference) => !difference.unit.includes("variant"))).toBe(true);

    const reversed = kind(compareRuns(set, b, run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT])));
    expect(reversed.only_in.a).toHaveLength(9);
    expect(reversed.only_in.b).toEqual([]);
  });

  it("lists a judge only one run holds, and compares nothing for it", () => {
    const spoiler = fabrication(0, [], { judge: "gm_spoiler" });
    const report = compareRuns(set, run([[7]]), [...run([[7]]), spoiler]);
    expect(game(report).only_in).toEqual({ a: [], b: ["gm_spoiler"] });
    expect(game(report).members.map((own) => own.id)).toEqual(["gm_fabrication"]);
  });

  it("reports a run with one sample per unit as unmeasured, lists its differences, and never calls them", () => {
    const report = compareRuns(set, run([FIRST_EIGHT]), run([[]]));
    const result = kind(report);
    expect(result).toMatchObject({ outcome: "unmeasured", p: null, firm: { a_only: 0, b_only: 0 } });
    expect(result.differences).toHaveLength(8);
    expect(result.differences.every((difference) => difference.call === "unmeasured")).toBe(true);
    expect(result.agreement.a).toEqual({ share: null, units: 0 });

    // One run with three samples does not measure the other's variation.
    const half = kind(compareRuns(set, run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT]), run([[]])));
    expect(half.outcome).toBe("unmeasured");
    expect(half.differences).toHaveLength(8);
    const other = kind(compareRuns(set, run([[]]), run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT])));
    expect(other.outcome).toBe("unmeasured");
  });

  it("says same, not unmeasured, when single-sample runs do not differ", () => {
    expect(kind(compareRuns(set, run([[7]]), run([[7]]))).outcome).toBe("same");
  });

  it("leaves a difference on a unit with one sample unmeasured, and tests the rest", () => {
    // The stored game has three samples in each run; the variant has one.
    const a = [...run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT]), ...run([FIRST_EIGHT], { subject: MEDAL_SPOILER })];
    const b = [...run([[], [], []]), ...run([[]], { subject: MEDAL_SPOILER })];
    const result = kind(compareRuns(set, a, b));
    expect(result.paired).toBe(18);
    expect(result.differing).toEqual({ a_only: 16, b_only: 0 });
    expect(result.firm).toEqual({ a_only: 8, b_only: 0 });
    expect(result.unmeasured).toBe(8);
    expect(result.outcome).toBe("differs");
    expect(result.differences.filter((difference) => difference.call === "unmeasured").every((difference) => difference.unit.includes("variant"))).toBe(true);
  });

  it("pairs a judge on two models with itself, and a judge on different models across the runs", () => {
    const opus = run([[7], [7], [7]]);
    const sonnet = run([[7], [7], [7]], { model: "sonnet" });
    const split = compareRuns(set, [...opus, ...sonnet], opus);
    expect(game(split).members.map((own) => own.id)).toEqual(["gm_fabrication@opus"]);
    expect(game(split).only_in).toEqual({ a: ["gm_fabrication@sonnet"], b: [] });

    const crossed = compareRuns(set, opus, sonnet);
    expect(member(crossed).a.model).toBe("opus");
    expect(member(crossed).b.model).toBe("sonnet");
    expect(kind(crossed).outcome).toBe("same");
  });

  it("only lets samples that judged vote", () => {
    const errored = run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT]).map((verdict, index) =>
      index === 2 ? { ...verdict, status: "error" as const, findings: [], duration_ms: null, cost_usd: null } : verdict,
    );
    const report = compareRuns(set, errored, run([[], [], []]));
    expect(kind(report).differences[0]).toMatchObject({ a: { catches: 2, of: 2 }, b: { catches: 0, of: 2 }, call: "firm" });
  });

  it("puts each run's delay and usage beside each judge, over the subjects both judged", () => {
    const a = run([[7], [7], [7]], { duration_ms: 1000, cost_usd: 0.1 });
    const b = [
      ...run([[7], [7], [7]], { duration_ms: 4000, cost_usd: 0.4, model: "sonnet" }),
      // The variant is not one A judged, so it is not charged.
      ...run([[7]], { subject: MEDAL_SPOILER, duration_ms: 90000, cost_usd: 9, model: "sonnet" }),
    ];
    const own = member(compareRuns(set, a, b));
    expect(own.a).toEqual({ model: "opus", delay_ms: 1000, usage_usd: expect.closeTo(0.1, 10) });
    expect(own.b).toEqual({ model: "sonnet", delay_ms: 4000, usage_usd: expect.closeTo(0.4, 10) });
  });

  it("charges a judge of one turn the sum over its turns, and says unknown when a part is", () => {
    const turn = (sequence: number, extra: Partial<StoredVerdict> = {}): StoredVerdict => ({
      subject: { ...MEDAL, sequence },
      judge: "age_appropriate_turn",
      model: "sonnet",
      sample: 0,
      status: "pass",
      findings: [],
      duration_ms: 500,
      cost_usd: 0.01,
      ...extra,
    });
    const a = [turn(1), turn(2)];
    const b = [turn(1), turn(2, { duration_ms: null, cost_usd: null })];
    const own = member(compareRuns(set, a, b), "age_appropriate_turn");
    expect(own.a).toMatchObject({ delay_ms: 1000 });
    expect(own.b).toEqual({ model: "sonnet", delay_ms: null, usage_usd: null });
    expect(own.kinds[0]).toMatchObject({ kind: "not_age_fit", paired: 2, outcome: "same" });
  });

  it("compares the blueprint side, one plant or base at a time, and orders it before the game side", () => {
    const fairness = (status: "pass" | "fail", plant: string | null, sample = 0): StoredVerdict => ({
      subject: { side: "blueprint", base: "mock", plant },
      judge: "fairness",
      model: "opus",
      sample,
      status,
      findings: status === "fail" ? [{ sequence: null, kinds: ["fairness"], severity: "major", judge_kind: null }] : [],
      duration_ms: 60000,
      cost_usd: 1,
    });
    const a = [fairness("pass", null), fairness("fail", "mock-bob-not-ruled-out")];
    const b = [fairness("pass", null), fairness("pass", "mock-bob-not-ruled-out")];
    const report = compareRuns(set, [...a, fabrication(0, [7])], [...b, fabrication(0, [7])]);
    expect(report.sides.map((side) => side.side)).toEqual(["blueprint", "game"]);
    const result = report.sides[0].members[0].kinds[0];
    expect(result).toMatchObject({ kind: "fairness", paired: 2, outcome: "unmeasured", differing: { a_only: 1, b_only: 0 } });
    expect(result.differences[0]).toMatchObject({ unit: "blueprint mock, plant mock-bob-not-ruled-out", truth: "fault", catching: "a" });
    expect(report.sides[0].members[0].a.delay_ms).toBe(120000);
  });

  it("reports no paired units, and no sides at all for two empty runs", () => {
    const report = compareRuns(set, run([[7]]), run([[7]], { subject: MEDAL_SPOILER }));
    expect(kind(report)).toMatchObject({ outcome: "no_paired_units", paired: 0 });
    expect(member(report).a.delay_ms).toBeNull();
    expect(compareRuns(set, [], []).sides).toEqual([]);
  });

  it("is the same every time", () => {
    const a = run([FIRST_EIGHT, [], FIRST_EIGHT]);
    const b = run([[], [3], []]);
    expect(JSON.stringify(compareRuns(set, a, b))).toBe(JSON.stringify(compareRuns(set, a, b)));
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

async function compare(argv: string[], env: NodeJS.ProcessEnv = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runEval(["compare", ...argv], { root: ROOT, out: (text) => out.push(text), err: (text) => err.push(text), env }, COMMANDS);
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function writeResults(file: string, verdicts: StoredVerdict[]): Promise<string> {
  await fs.writeFile(file, JSON.stringify({ schema_version: STORED_RESULTS_VERSION, verdicts }), "utf8");
  return file;
}

describe("./dev eval compare", () => {
  it("runs on the fixture with bindings that cannot run, prints the tables, writes the report and exits 0", async () => {
    const dir = await tempDir();
    const out = path.join(dir, "report.json");
    const ran = await compare(["fixture-run", "fixture-run", "--truth", FIXTURE, "--out", out, "--config", await unrunnableConfig(dir)]);
    expect(ran.err).toBe("");
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("Compared A tests/api/unit/fixtures/truth/results/fixture-run.json with B");
    expect(ran.out).toContain("Game side: 3 judges in both runs");
    expect(ran.out).toContain("Delay and usage");
    expect(ran.out).toContain("gm_spoiler");
    expect(ran.out).toContain("claude-opus-stub");
    const report = JSON.parse(await fs.readFile(out, "utf8")) as CompareReport & { inputs: { truth: string; a: string; b: string } };
    expect(report.inputs.truth).toBe("tests/api/unit/fixtures/truth");
    expect(report.sides.flatMap((side) => side.members.flatMap((own) => own.kinds)).every((own) => own.outcome === "same")).toBe(true);
  });

  it("prints a difference with its call, delay and usage beside each judge, for two real runs", async () => {
    const dir = await tempDir();
    const a = await writeResults(path.join(dir, "a.json"), run([FIRST_EIGHT, FIRST_EIGHT, FIRST_EIGHT], { duration_ms: 2000, cost_usd: 0.25 }));
    const b = await writeResults(path.join(dir, "b.json"), run([[], [], []], { model: "sonnet", duration_ms: 500, cost_usd: 0.05 }));
    const ran = await compare([a, b, "--truth", FIXTURE, "--out", path.join(dir, "r.json")]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("differs: A catches more");
    expect(ran.out).toContain("gm_fabrication fabrication, game medal, turn 7: A catches (A 3/3, B 0/3), firm, truth fault");
    expect(ran.out).toMatch(/gm_fabrication\s+opus\s+sonnet\s+2\.0s\s+0\.5s\s+\$0\.2500\s+\$0\.0500/);
  });

  it("says in its output that unmeasured variation is listed and never called", async () => {
    const dir = await tempDir();
    const a = await writeResults(path.join(dir, "a.json"), run([FIRST_EIGHT]));
    const b = await writeResults(path.join(dir, "b.json"), run([[]]));
    const ran = await compare([a, b, "--truth", FIXTURE, "--out", path.join(dir, "r.json")]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("variation unmeasured");
    expect(ran.out).toContain("Variation unmeasured: a run with one judging sample per unit");
    expect(ran.out).not.toContain("differs:");
  });

  it("lists units one run alone judged, and stops a long listing", async () => {
    const dir = await tempDir();
    const a = await writeResults(path.join(dir, "a.json"), run([[7]]));
    const b = await writeResults(path.join(dir, "b.json"), run([[7]], { subject: MEDAL_SPOILER }));
    const ran = await compare([a, b, "--truth", FIXTURE, "--out", path.join(dir, "r.json")]);
    expect(ran.out).toContain("Left out, judged by one run only");
    expect(ran.out).toContain("A only: gm_fabrication fabrication, game medal, turn 1");
    expect(ran.out).toContain("B only: gm_fabrication fabrication, game medal, variant medal-spoiler, turn 9");
    expect(ran.out).toContain("no paired units");

    expect(LISTED).toBeGreaterThan(0);
    const lines = ran.out.split("\n").filter((line) => line.includes("only: gm_fabrication"));
    expect(lines.length).toBeLessThanOrEqual(LISTED);
  });

  it("writes byte-identical files from the same inputs", async () => {
    const dir = await tempDir();
    const a = await writeResults(path.join(dir, "a.json"), run([FIRST_EIGHT, [], FIRST_EIGHT]));
    const b = await writeResults(path.join(dir, "b.json"), run([[], [3], []]));
    const first = path.join(dir, "first.json");
    const second = path.join(dir, "second.json");
    expect((await compare([a, b, "--truth", FIXTURE, "--out", first])).code).toBe(0);
    expect((await compare([a, b, "--truth", FIXTURE, "--out", second])).code).toBe(0);
    expect(await fs.readFile(second)).toEqual(await fs.readFile(first));
  });

  it("writes into a new run folder under the output root without --out", async () => {
    const dir = await tempDir();
    const ran = await compare(["fixture-run", "fixture-run", "--truth", FIXTURE, "--output-root", dir]);
    expect(ran.code).toBe(0);
    const [day] = await fs.readdir(dir);
    const [folder] = await fs.readdir(path.join(dir, day));
    expect(folder).toMatch(/-compare$/);
    expect(await fs.readdir(path.join(dir, day, folder))).toEqual(["compare.json"]);
  });

  it("exits 1 when the inputs cannot be read", async () => {
    const dir = await tempDir();
    const missing = await compare(["fixture-run", path.join(dir, "nope.json"), "--truth", FIXTURE]);
    expect(missing.code).toBe(1);
    expect(missing.err).toContain("no results named");

    await fs.writeFile(path.join(dir, "broken.json"), "{", "utf8");
    const broken = await compare(["fixture-run", path.join(dir, "broken.json"), "--truth", FIXTURE]);
    expect(broken.code).toBe(1);
    expect(broken.err).toContain("is not JSON");

    const noSet = await compare(["fixture-run", "fixture-run", "--truth", path.join(dir, "no-set")]);
    expect(noSet.code).toBe(1);
    expect(noSet.err).toContain("is not a folder");
  });

  it("takes exactly two results", async () => {
    const one = await compare(["fixture-run", "--truth", FIXTURE]);
    expect(one.code).toBe(1);
    expect(one.err).toContain("expected at least 2 argument");
    const three = await compare(["fixture-run", "fixture-run", "fixture-run", "--truth", FIXTURE]);
    expect(three.code).toBe(1);
    expect(three.err).toContain("expected at most 2 argument");
  });

  it("names the test in its help, and says what it does when variation is unmeasured", async () => {
    const ran = await compare(["--help"]);
    expect(ran.code).toBe(0);
    expect(ran.out).toContain("exact two-sided sign test (McNemar's exact test)");
    expect(ran.out).toContain("the variation is unmeasured");
    expect(ran.out).toContain("--truth <dir>");
  });

  it("reads the same stored verdicts the loader does", async () => {
    // The fixture's results compare with themselves as the loader reads them.
    const verdicts = await readResultsFile(set, FIXTURE_RESULTS);
    const report = compareRuns(set, verdicts, verdicts);
    expect(report.sides.map((side) => side.members.length)).toEqual([1, 3]);
  });
});
