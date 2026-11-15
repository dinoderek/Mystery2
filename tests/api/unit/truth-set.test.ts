import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { judgesFor, SUBJECT_KINDS } from "../../../evaluation/core/registry.ts";
import type { Verdict } from "../../../evaluation/core/result.ts";
import { resolveVerdict } from "../../../evaluation/judges/index.ts";
import { catches, FINDINGS_TABLE, findingsRow, kindedFindings } from "../../../evaluation/lib/truth/findings.ts";
import type { TurnUnit } from "../../../evaluation/lib/truth/findings.ts";
import { findLeaks, leaksIn } from "../../../evaluation/lib/truth/guard.ts";
import { BLUEPRINT_KINDS, GAME_KINDS } from "../../../evaluation/lib/truth/kinds.ts";
import { loadTruthSet, TRUTH_ROOT } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import {
  BlueprintPlantSchema,
  LabelFileSchema,
  StoredGameSchema,
  parseTruthFile,
  StoredResultsSchema,
  TurnVariantSchema,
} from "../../../evaluation/lib/truth/schemas.ts";
import type { StoredVerdict } from "../../../evaluation/lib/truth/schemas.ts";
import { latestLabel, truthOf } from "../../../evaluation/lib/truth/truth.ts";
import { buildRawTrace } from "../../../evaluation/trace/lib/normalize.ts";
import { makeBlueprint, makeEvents, makeSession } from "./trace-fixtures.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");
const ANSWERS = path.join(repoRoot(), "tests/api/unit/fixtures/eval-snapshot-answers.json");

async function readFixture(relative: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path.join(FIXTURE, relative), "utf8")) as Record<string, unknown>;
}

const scratch: string[] = [];
afterEach(async () => {
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

/** A copy of the fixture in a temporary folder, to break. */
async function copyFixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "truth-set-"));
  scratch.push(dir);
  await fs.cp(FIXTURE, dir, { recursive: true });
  return dir;
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

/** A copy of `value` without `key`. */
function without(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...value };
  delete copy[key];
  return copy;
}

/** Sets the value at a dotted path, such as `labels.0.sequence`. */
function setPath(value: unknown, dotted: string, to: unknown): void {
  const keys = dotted.split(".");
  const last = keys.pop() as string;
  const parent = keys.reduce((node, key) => (node as Record<string, unknown>)[key], value);
  (parent as Record<string, unknown>)[last] = to;
}

function rejection(schema: Parameters<typeof parseTruthFile>[0], value: unknown): string {
  try {
    parseTruthFile(schema, value, "the-file.json");
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("expected the schema to reject the value");
}

describe("truth set schemas", () => {
  it("accept a game as the trace extraction writes it", () => {
    const trace = buildRawTrace({ session: makeSession(), events: makeEvents(), blueprint: makeBlueprint(), source: { kind: "local" } });
    expect(StoredGameSchema.safeParse(JSON.parse(JSON.stringify(trace))).success).toBe(true);
  });

  it("reject a label missing who, when or pass, naming the field", async () => {
    const file = await readFixture("games/medal/labels.json");
    const labels = file.labels as Record<string, unknown>[];
    for (const field of ["by", "at", "pass"]) {
      const broken = { labels: labels.map((label, index) => (index === 0 ? { ...label, [field]: undefined } : label)) };
      const message = rejection(LabelFileSchema, JSON.parse(JSON.stringify(broken)));
      expect(message).toContain("the-file.json");
      expect(message).toContain(`labels.0.${field}`);
    }
  });

  it("reject an unknown kind and a severity other than minor or major", () => {
    const label = { sequence: 2, by: "someone", at: "2026-06-03T09:00:00Z", pass: 1 };
    const unknownKind = rejection(LabelFileSchema, { labels: [{ ...label, faults: [{ kind: "rudeness", severity: "major", note: "x" }] }] });
    expect(unknownKind).toContain("labels.0.faults.0.kind");
    const badSeverity = rejection(LabelFileSchema, { labels: [{ ...label, faults: [{ kind: "spoiler", severity: "critical", note: "x" }] }] });
    expect(badSeverity).toContain("labels.0.faults.0.severity");
    expect(rejection(LabelFileSchema, { labels: [{ ...label, pass: 3, faults: [] }] })).toContain("labels.0.pass");
  });

  it("reject two labels of one turn at the same time", () => {
    const label = { sequence: 2, faults: [], by: "someone", at: "2026-06-03T09:00:00Z", pass: 1 };
    expect(rejection(LabelFileSchema, { labels: [label, { ...label, pass: 2 }] })).toContain("labels.1.at");
  });

  it("reject a plant without its kind", async () => {
    const variant = await readFixture("plants/turns/medal-spoiler.json");
    const plants = (variant.plants as Record<string, unknown>[]).map((plant) => without(plant, "kind"));
    expect(rejection(TurnVariantSchema, { ...variant, plants })).toContain("plants.0.kind");
    const blueprintPlant = await readFixture("plants/blueprints/mock-bob-not-ruled-out.json");
    expect(rejection(BlueprintPlantSchema, without(blueprintPlant, "kind"))).toContain("kind: Required");
    expect(rejection(BlueprintPlantSchema, { ...blueprintPlant, kind: "spoiler" })).toContain("kind: Invalid enum value");
  });

  it("reject two plants on one turn, and an edit that is not exact", async () => {
    const variant = await readFixture("plants/turns/medal-spoiler.json");
    const [first] = variant.plants as Record<string, unknown>[];
    expect(rejection(TurnVariantSchema, { ...variant, plants: [first, first] })).toContain("plants.1.sequence");
    const noValue = { ...first, edits: [{ type: "patch", ops: [{ op: "replace", path: "/narration" }] }] };
    expect(rejection(TurnVariantSchema, { ...variant, plants: [noValue] })).toContain("plants.0.edits.0.ops.0.value");
    const rootPath = { ...first, edits: [{ type: "patch", ops: [{ op: "test", path: "", value: 1 }] }] };
    expect(rejection(TurnVariantSchema, { ...variant, plants: [rootPath] })).toContain("plants.0.edits.0.ops.0.path");
    const untested = { ...first, edits: [{ type: "patch", ops: [{ op: "remove", path: "/payload" }] }] };
    expect(rejection(TurnVariantSchema, { ...variant, plants: [untested] })).toContain("plants.0.edits.0.ops.0.op: a patch starts with a test");
  });

  it("reject a stored verdict without model or sample, and a finding of the other side's kind", async () => {
    const results = await readFixture("results/fixture-run.json");
    const [first, ...rest] = results.verdicts as Record<string, unknown>[];
    for (const field of ["model", "sample"]) {
      expect(rejection(StoredResultsSchema, { ...results, verdicts: [without(first, field), ...rest] })).toContain(`verdicts.0.${field}`);
    }
    const wrongKind = { ...first, findings: [{ sequence: 7, kinds: ["fairness"], severity: "major", judge_kind: null }] };
    expect(rejection(StoredResultsSchema, { ...results, verdicts: [wrongKind] })).toContain("verdicts.0.findings.0.kinds.0");
    expect(rejection(StoredResultsSchema, { ...results, verdicts: [first, first] })).toContain("verdicts.1");
  });

  it("keep cost the CLI did not report as unknown, never zero", async () => {
    const results = parseTruthFile(StoredResultsSchema, await readFixture("results/fixture-run.json"), "fixture-run.json");
    expect(results.verdicts[1].cost_usd).toBeNull();
    expect(rejection(StoredResultsSchema, { ...results, verdicts: [without(results.verdicts[0], "cost_usd")] })).toContain(
      "verdicts.0.cost_usd",
    );
  });
});

describe("loading a truth set", () => {
  it("loads the fixture", async () => {
    const set = await loadTruthSet(FIXTURE);
    expect(set.bases.map((base) => base.id)).toEqual(["mock"]);
    expect(set.games.map((game) => [game.id, game.labels.length, game.trace.events.length])).toEqual([["medal", 4, 9]]);
    expect(set.turnVariants.map((variant) => [variant.id, variant.game, variant.plants.map((plant) => plant.kind)])).toEqual([
      ["medal-leak", "medal", ["spoiler"]],
      ["medal-spoiler", "medal", ["spoiler", "clue_handling"]],
    ]);
    expect(set.blueprintPlants.map((plant) => [plant.id, plant.base, plant.kind])).toEqual([["mock-bob-not-ruled-out", "mock", "fairness"]]);
    expect(set.results.map((results) => [results.id, results.verdicts.length])).toEqual([["fixture-run", 5]]);
    expect(set.guide).toBeNull();
  });

  it("finds the guide where it belongs", async () => {
    const dir = await copyFixture();
    await fs.writeFile(path.join(dir, "guide.md"), "# Guide\n", "utf8");
    expect((await loadTruthSet(dir)).guide).toBe(path.join(dir, "guide.md"));
    await fs.writeFile(path.join(dir, "guide.md"), "  \n", "utf8");
    await expect(loadTruthSet(dir)).rejects.toThrow(`${path.join(dir, "guide.md")}: is empty`);
  });

  it("fails on a bad file, naming its path and the field", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "games/medal/labels.json");
    const labels = JSON.parse(await fs.readFile(file, "utf8"));
    delete labels.labels[1].by;
    await writeJson(file, labels);
    await expect(loadTruthSet(dir)).rejects.toThrow(`${file}: labels.1.by: Required`);
  });

  it("fails on a file that is not JSON, and on a folder that is not there", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "plants/turns/medal-spoiler.json");
    await fs.writeFile(file, "{ not json", "utf8");
    await expect(loadTruthSet(dir)).rejects.toThrow(`${file}: is not JSON`);
    await expect(loadTruthSet(path.join(dir, "missing"))).rejects.toThrow("is not a folder");
  });

  it.each([
    ["games/medal/notes.txt", "games/medal/notes.txt: not part of the truth set"],
    ["results/Run One.json", "results/Run One.json: not part of the truth set"],
    ["plants/other/x.json", "plants/other: not part of the truth set"],
    ["extra.json", "extra.json: not part of the truth set"],
  ])("fails on %s, which is not in the layout", async (relative, message) => {
    const dir = await copyFixture();
    await writeJson(path.join(dir, relative), {});
    await expect(loadTruthSet(dir)).rejects.toThrow(path.join(dir, message));
  });

  it("fails on a game without its trace, and a base whose blueprint is not Blueprint V2", async () => {
    const dir = await copyFixture();
    await fs.rm(path.join(dir, "games/medal/trace.json"));
    await expect(loadTruthSet(dir)).rejects.toThrow(`${path.join(dir, "games/medal/trace.json")}: is missing`);

    const other = await copyFixture();
    const blueprint = path.join(other, "bases/mock/blueprint.json");
    await writeJson(blueprint, { ...JSON.parse(await fs.readFile(blueprint, "utf8")), metadata: undefined });
    await expect(loadTruthSet(other)).rejects.toThrow(`${blueprint}: metadata`);
  });

  it("fails on a stored game whose turns repeat a sequence", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "games/medal/trace.json");
    const trace = JSON.parse(await fs.readFile(file, "utf8"));
    trace.events[1].sequence = 1;
    await writeJson(file, trace);
    await expect(loadTruthSet(dir)).rejects.toThrow(`${file}: events.1.sequence: sequence 1 repeats`);
  });

  it("fails when one part names what another does not have", async () => {
    const cases: [string, string, unknown, string][] = [
      ["games/medal/labels.json", "labels.0.sequence", 99, "labels.0.sequence: turn 99 is not in game \"medal\""],
      ["plants/turns/medal-spoiler.json", "game", "other", "game: no stored game \"other\""],
      ["plants/turns/medal-spoiler.json", "plants.1.sequence", 99, "plants.1.sequence: turn 99 is not in game"],
      ["plants/blueprints/mock-bob-not-ruled-out.json", "base", "other", "base: no base \"other\""],
      ["plants/blueprints/mock-bob-not-ruled-out.json", "judge", "gm_spoiler", "judge: \"gm_spoiler\" is not a blueprint judge"],
      ["plants/blueprints/mock-bob-not-ruled-out.json", "judge", "flesch", "judge: \"flesch\" is a check"],
      ["results/fixture-run.json", "verdicts.0.subject.game", "other", "verdicts.0.subject: no stored game \"other\""],
      ["results/fixture-run.json", "verdicts.1.subject.variant", "other", "verdicts.1.subject: no variant \"other\""],
      ["results/fixture-run.json", "verdicts.2.subject.sequence", 99, "verdicts.2.subject: turn 99 is not in game"],
      ["results/fixture-run.json", "verdicts.3.subject.plant", "other", "verdicts.3.subject: no plant \"other\""],
      ["results/fixture-run.json", "verdicts.4.subject.base", "other", "verdicts.4.subject: no base \"other\""],
      ["results/fixture-run.json", "verdicts.0.judge", "fairness", "verdicts.0.judge: \"fairness\" scores on the blueprint side"],
      ["results/fixture-run.json", "verdicts.0.judge", "nobody", "verdicts.0.judge: Unknown check or judge \"nobody\""],
      ["results/fixture-run.json", "verdicts.0.findings.0.kinds", ["spoiler"], "verdicts.0.findings.0.kinds: the findings table gives \"gm_fabrication\" fabrication, not \"spoiler\""],
    ];
    for (const [relative, field, value, message] of cases) {
      const dir = await copyFixture();
      const file = path.join(dir, relative);
      const content: unknown = JSON.parse(await fs.readFile(file, "utf8"));
      setPath(content, field, value);
      await writeJson(file, content);
      await expect(loadTruthSet(dir), relative).rejects.toThrow(`${file}: ${message}`);
    }
  });
});

describe("the truth of a unit", () => {
  let set: TruthSet;
  const turn = (sequence: number, kind: TurnUnit["kind"], variant: string | null = null): TurnUnit => ({
    side: "game",
    game: "medal",
    variant,
    sequence,
    kind,
  });

  it("is clean for a labelled clean turn, and unknown for an unlabelled one", async () => {
    set = await loadTruthSet(FIXTURE);
    expect(truthOf(set, turn(2, "spoiler"))).toEqual({ truth: "clean", severity: null });
    expect(truthOf(set, turn(3, "spoiler"))).toEqual({ truth: "unknown", severity: null });
  });

  it("takes a turn's latest label and keeps the earlier one", async () => {
    set = await loadTruthSet(FIXTURE);
    expect(set.games[0].labels.filter((label) => label.sequence === 4)).toHaveLength(2);
    expect(latestLabel(set.games[0].labels, 4)?.pass).toBe(2);
    expect(truthOf(set, turn(4, "spoiler"))).toEqual({ truth: "clean", severity: null });
  });

  it("is a fault of a labelled kind at its worst severity, and clean for the turn's other kinds", async () => {
    set = await loadTruthSet(FIXTURE);
    expect(truthOf(set, turn(7, "fabrication"))).toEqual({ truth: "fault", severity: "major" });
    expect(truthOf(set, turn(7, "spoiler"))).toEqual({ truth: "clean", severity: null });
  });

  it("is a fault on a planted turn, unknown for its other kinds, and the stored game's elsewhere", async () => {
    set = await loadTruthSet(FIXTURE);
    expect(truthOf(set, turn(4, "spoiler", "medal-spoiler"))).toEqual({ truth: "fault", severity: "major" });
    expect(truthOf(set, turn(4, "fabrication", "medal-spoiler"))).toEqual({ truth: "unknown", severity: null });
    expect(truthOf(set, turn(2, "spoiler", "medal-spoiler"))).toEqual({ truth: "clean", severity: null });
    expect(truthOf(set, turn(3, "spoiler", "medal-spoiler"))).toEqual({ truth: "unknown", severity: null });
  });

  it("is clean for a base blueprint, and a fault of a plant's kind only", async () => {
    set = await loadTruthSet(FIXTURE);
    for (const kind of BLUEPRINT_KINDS) {
      expect(truthOf(set, { side: "blueprint", base: "mock", plant: null, kind }).truth).toBe("clean");
    }
    const plant = "mock-bob-not-ruled-out";
    expect(truthOf(set, { side: "blueprint", base: "mock", plant, kind: "fairness" })).toEqual({ truth: "fault", severity: null });
    expect(truthOf(set, { side: "blueprint", base: "mock", plant, kind: "solve_depth" }).truth).toBe("unknown");
  });

  it("throws on a unit naming a subject the set does not have", async () => {
    set = await loadTruthSet(FIXTURE);
    expect(() => truthOf(set, { ...turn(2, "spoiler"), game: "other" })).toThrow('no stored game "other"');
    expect(() => truthOf(set, turn(2, "spoiler", "other"))).toThrow('no variant "other"');
    expect(() => truthOf(set, { side: "blueprint", base: "other", plant: null, kind: "fairness" })).toThrow('no base "other"');
    expect(() => truthOf(set, { side: "blueprint", base: "mock", plant: "other", kind: "fairness" })).toThrow('no plant "other"');
  });
});

describe("the findings table", () => {
  it("has a row for every judge in the default battery of each subject", () => {
    for (const subject of SUBJECT_KINDS) {
      const missing = judgesFor(subject).map((judge) => judge.id).filter((id) => !(id in FINDINGS_TABLE));
      expect(missing, `judges of a ${subject} with no row in the findings table`).toEqual([]);
    }
  });

  it("maps each judge to a kind of its side, and the turn age judge to not age-fit", () => {
    for (const [judge, row] of Object.entries(FINDINGS_TABLE)) {
      const vocabulary: readonly string[] = row.side === "game" ? GAME_KINDS : BLUEPRINT_KINDS;
      expect(row.kinds.every((kind) => vocabulary.includes(kind)), judge).toBe(true);
    }
    expect(FINDINGS_TABLE.age_appropriate_turn.kinds).toEqual(["not_age_fit"]);
    for (const judge of judgesFor("blueprint")) expect(FINDINGS_TABLE[judge.id].kinds[0]).toBe(judge.id);
  });

  it("names the judge a row is missing for, and refuses a check", () => {
    expect(() => findingsRow("nobody")).toThrow('Unknown check or judge "nobody"');
    expect(() => findingsRow("flesch")).toThrow('"flesch" is a check');
  });
});

describe("findings with kinds", () => {
  async function stubAnswers(): Promise<Record<string, Record<string, unknown>>> {
    return JSON.parse(await fs.readFile(ANSWERS, "utf8"));
  }

  function verdictOf(id: string, answer: Record<string, unknown>, status: "pass" | "fail"): Verdict {
    return { id, tier: "judge", status, findings: Array.isArray(answer.findings) ? answer.findings : undefined, answer };
  }

  it("count a blueprint judge's fail as one major finding of its dimension", async () => {
    const answers = await stubAnswers();
    for (const judge of judgesFor("blueprint")) {
      const answer = answers[`blueprint.${judge.id}`];
      const findings = kindedFindings(verdictOf(judge.id, answer, answer.verdict as "pass" | "fail"), null);
      const expected = answer.verdict === "fail" ? [{ sequence: null, kinds: [judge.id], severity: "major", judge_kind: null }] : [];
      expect(findings, judge.id).toEqual(expected);
    }
    // The stub fails these two, so both branches ran.
    expect(answers["blueprint.fairness"].verdict).toBe("fail");
    expect(answers["blueprint.age_appropriate"].verdict).toBe("pass");
  });

  it("read a game judge's findings at their own turns, minor ones included", async () => {
    const answers = await stubAnswers();
    const mapped = Object.fromEntries(
      judgesFor("game").map((judge) => {
        const answer = answers[`trace.${judge.id}`];
        return [judge.id, kindedFindings(verdictOf(judge.id, answer, resolveVerdict(answer).status), null)];
      }),
    );
    expect(mapped).toEqual({
      gm_roleplay: [],
      gm_clue_discipline: [],
      gm_fabrication: [{ sequence: 6, kinds: ["fabrication"], severity: "major", judge_kind: "place" }],
      gm_spoiler: [{ sequence: 4, kinds: ["spoiler"], severity: "minor", judge_kind: "hidden_action" }],
    });
  });

  it("point a turn judge's findings at the turn it judged", async () => {
    const answers = await stubAnswers();
    const roleplay = answers["runtime.gm_roleplay"];
    expect(kindedFindings(verdictOf("gm_roleplay", roleplay, resolveVerdict(roleplay).status), 12)).toEqual([
      { sequence: 12, kinds: ["out_of_character"], severity: "major", judge_kind: "voice" },
    ]);
    const age = answers["runtime.age_appropriate"];
    expect(kindedFindings(verdictOf("age_appropriate_turn", age, "pass"), 12)).toEqual([
      { sequence: 12, kinds: ["not_age_fit"], severity: "minor", judge_kind: "figurative_language" },
    ]);
    expect(kindedFindings(verdictOf("age_appropriate_turn", age, "fail"), 12)).toEqual([
      { sequence: 12, kinds: ["not_age_fit"], severity: "major", judge_kind: "figurative_language" },
    ]);
  });

  it("count a fail with no finding as one major finding, and nothing for a verdict that did not judge", () => {
    const empty = { findings: [], verdict: "fail", reasoning: "too hard" };
    expect(kindedFindings(verdictOf("age_appropriate_turn", empty, "fail"), 5)).toEqual([
      { sequence: 5, kinds: ["not_age_fit"], severity: "major", judge_kind: null },
    ]);
    for (const status of ["error", "skipped"] as const) {
      expect(kindedFindings({ id: "gm_spoiler", status, findings: [{ sequence: 1, severity: "major" }] }, null)).toEqual([]);
      expect(kindedFindings({ id: "fairness", status }, null)).toEqual([]);
    }
    expect(() => kindedFindings({ id: "nobody", status: "pass" }, null)).toThrow('"nobody"');
  });
});

describe("the catch rule", () => {
  const verdict = (overrides: Partial<StoredVerdict> = {}): StoredVerdict => ({
    subject: { side: "game", game: "medal", variant: "medal-spoiler", sequence: null },
    judge: "gm_spoiler",
    model: "m",
    sample: 0,
    status: "fail",
    findings: [{ sequence: 4, kinds: ["spoiler"], severity: "major", judge_kind: "culprit" }],
    duration_ms: 1,
    cost_usd: null,
    ...overrides,
  });
  const unit: TurnUnit = { side: "game", game: "medal", variant: "medal-spoiler", sequence: 4, kind: "spoiler" };

  it("catches with a finding on the right turn with a mapped kind", () => {
    expect(catches(verdict(), unit)).toBe(true);
    const minor = verdict({ status: "pass", findings: [{ sequence: 4, kinds: ["spoiler"], severity: "minor", judge_kind: null }] });
    expect(catches(minor, unit)).toBe(true);
  });

  it("does not catch on the wrong turn, an unmapped kind or another subject", () => {
    expect(catches(verdict(), { ...unit, sequence: 5 })).toBe(false);
    expect(catches(verdict(), { ...unit, kind: "fabrication" })).toBe(false);
    expect(catches(verdict(), { ...unit, variant: null })).toBe(false);
    expect(catches(verdict(), { ...unit, game: "other" })).toBe(false);
    expect(catches(verdict({ findings: [] }), unit)).toBe(false);
  });

  it("matches a judge of one turn only on that turn", () => {
    const ofTurn = verdict({ subject: { side: "game", game: "medal", variant: "medal-spoiler", sequence: 4 } });
    expect(catches(ofTurn, unit)).toBe(true);
    expect(catches({ ...ofTurn, subject: { ...ofTurn.subject, sequence: 3 } as StoredVerdict["subject"] }, unit)).toBe(false);
  });

  it("catches a planted blueprint fault with a finding of its kind, on that blueprint only", () => {
    const blueprint = verdict({
      subject: { side: "blueprint", base: "mock", plant: "p" },
      judge: "fairness",
      findings: [{ sequence: null, kinds: ["fairness"], severity: "major", judge_kind: null }],
    });
    expect(catches(blueprint, { side: "blueprint", base: "mock", plant: "p", kind: "fairness" })).toBe(true);
    expect(catches(blueprint, { side: "blueprint", base: "mock", plant: "p", kind: "solve_depth" })).toBe(false);
    expect(catches(blueprint, { side: "blueprint", base: "mock", plant: null, kind: "fairness" })).toBe(false);
    expect(catches(blueprint, unit)).toBe(false);
    expect(catches(verdict(), { side: "blueprint", base: "mock", plant: "p", kind: "fairness" })).toBe(false);
  });
});

describe("the credential and home-path guard", () => {
  it("passes on the truth set and its fixture", async () => {
    await expect(fs.stat(path.join(repoRoot(), TRUTH_ROOT))).resolves.toBeTruthy();
    expect(await findLeaks(path.join(repoRoot(), TRUTH_ROOT))).toEqual([]);
    expect(await findLeaks(FIXTURE)).toEqual([]);
  });

  it("fails on a planted fixture line, naming the file", async () => {
    const dir = await copyFixture();
    const file = path.join(dir, "games/medal/trace.json");
    const trace = JSON.parse(await fs.readFile(file, "utf8"));
    trace.source.database = ["", "Users", "someone", "game.db"].join("/");
    await writeJson(file, trace);
    const leaks = await findLeaks(dir);
    expect(leaks.map((leak) => [path.relative(dir, leak.file), leak.what])).toEqual([["games/medal/trace.json", "an absolute home path"]]);
  });

  it.each([
    ["an Anthropic API key", `"key": "${["sk", "ant", "api03", "abcdefghijklmnop"].join("-")}"`],
    ["an OpenRouter or OpenAI API key", `token ${["sk", "or", "v1", "abcdefghijklmnopqrstuvwxyz"].join("-")}`],
    ["a GitHub token", `${"ghp"}_${"a".repeat(36)}`],
    ["an AWS access key", `${"AKIA"}${"B".repeat(16)}`],
    ["a Slack token", `${"xoxb"}-1234567890-abc`],
    ["a private key", `-----BEGIN ${"RSA PRIVATE"} KEY-----`],
    ["a bearer token", `Authorization: ${"Bearer"} ${"x".repeat(24)}`],
    ["an .env line setting a secret", `${"OPENROUTER_API_KEY"}=abc`],
    ["an absolute home path", `see ${["", "home", "someone", "x"].join("/")}`],
    ["an absolute home path", `${"C:"}\\Users\\someone\\x`],
  ])("sees %s", (what, line) => {
    expect(leaksIn(`clean line\n${line}\n`, "f").map((leak) => [leak.line, leak.what])).toContainEqual([2, what]);
  });

  it("leaves ordinary text alone", () => {
    const text = ["/tmp/mystery/game.db", "evaluation/truth/README.md", "the sk-etch was there", "MODEL=claude", "a Bearer of news"].join("\n");
    expect(leaksIn(text, "f")).toEqual([]);
  });
});
