import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { createLabelCommand } from "../../../evaluation/label/command.ts";
import { disagreementsAt, reportedTurns } from "../../../evaluation/label/disagreements.ts";
import { actionForKey, applyAction, KEYED_KINDS, KIND_KEYS } from "../../../evaluation/label/keys.ts";
import type { Selection } from "../../../evaluation/label/keys.ts";
import { escapeHtml } from "../../../evaluation/label/page.ts";
import { startLabelServer } from "../../../evaluation/label/server.ts";
import type { LabelServer, LabelServerOptions } from "../../../evaluation/label/server.ts";
import { buildTurnView, playedTurns } from "../../../evaluation/label/turns.ts";
import { GAME_KINDS } from "../../../evaluation/lib/truth/kinds.ts";
import { loadTruthSet } from "../../../evaluation/lib/truth/loader.ts";
import type { StoredVerdict } from "../../../evaluation/lib/truth/schemas.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");

const scratch: string[] = [];
const servers: LabelServer[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(scratch.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function readJson(file: string): Promise<{ labels: Record<string, unknown>[] }> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(value, null, 2), "utf8");
}

const SPOILER_FINDING = { sequence: 2, kinds: ["spoiler"], severity: "minor", judge_kind: "culprit-leak" };

/**
 * A copy of the fixture in a temporary folder, with two disagreements made in
 * it: turn 2 is labelled clean and a spoiler judge caught it, and turn 3 is
 * labelled out of character and the roleplay judge found nothing.
 */
async function copyFixture({ withResults = true } = {}): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-label-"));
  scratch.push(dir);
  await fs.cp(FIXTURE, dir, { recursive: true });
  const labelsFile = path.join(dir, "games/medal/labels.json");
  const labels = await readJson(labelsFile);
  labels.labels.push({
    sequence: 3,
    faults: [{ kind: "out_of_character", severity: "major", note: "Mara talks like a narrator." }],
    by: "fixture",
    at: "2026-06-03T09:03:00Z",
    pass: 1,
  });
  await writeJson(labelsFile, labels);
  if (!withResults) {
    await fs.rm(path.join(dir, "results"), { recursive: true });
    return dir;
  }
  const game = { side: "game", game: "medal", variant: null, sequence: null };
  const base = { model: "claude-opus-stub", sample: 0, duration_ms: 1000, cost_usd: null };
  await writeJson(path.join(dir, "results/extra.json"), {
    schema_version: "mystery-truth-results/1",
    verdicts: [
      { ...base, subject: game, judge: "gm_spoiler", status: "fail", findings: [SPOILER_FINDING] },
      { ...base, subject: game, judge: "gm_roleplay", status: "pass", findings: [] },
      { ...base, subject: game, judge: "gm_clue_discipline", status: "error", findings: [] },
    ],
  });
  return dir;
}

let clock = Date.parse("2026-07-01T10:00:00Z");
const now = () => new Date((clock += 1000));

async function serve(dir: string, overrides: Partial<LabelServerOptions> = {}): Promise<{ server: LabelServer; log: string[] }> {
  const log: string[] = [];
  const server = await startLabelServer({ truthRoot: dir, game: "medal", pass: 1, by: "tester", now, log: (text) => log.push(text), ...overrides });
  servers.push(server);
  return { server, log };
}

async function get(server: LabelServer, pathname: string): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(new URL(pathname, server.url), { redirect: "manual" });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

async function post(server: LabelServer, pathname: string, fields: [string, string][]) {
  const response = await fetch(new URL(pathname, server.url), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(server.url).origin },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, location: response.headers.get("location"), body: await response.text() };
}

const labelsOf = async (dir: string) => (await readJson(path.join(dir, "games/medal/labels.json"))).labels;

describe("the labelling keyboard", () => {
  it("maps each key to its kind, severity or movement", () => {
    expect(KEYED_KINDS).toEqual(GAME_KINDS);
    for (const [key, kind] of Object.entries(KIND_KEYS)) expect(actionForKey(key, false)).toEqual({ type: "toggle-kind", kind });
    expect(actionForKey("m", false)).toEqual({ type: "set-severity", severity: "major" });
    expect(actionForKey("n", false)).toEqual({ type: "set-severity", severity: "minor" });
    expect(actionForKey("t", false)).toEqual({ type: "focus-note" });
    expect(actionForKey("c", false)).toEqual({ type: "clean" });
    expect(actionForKey("p", false)).toEqual({ type: "previous" });
    expect(actionForKey("Enter", false)).toEqual({ type: "save" });
    expect(actionForKey("x", false)).toBeNull();
    expect(actionForKey("toString", false)).toBeNull();
  });

  it("leaves the keys to the note while it is being typed in, except Escape", () => {
    for (const key of ["1", "m", "c", "Enter", "t"]) expect(actionForKey(key, true)).toBeNull();
    expect(actionForKey("Escape", true)).toEqual({ type: "leave-note" });
    expect(actionForKey("Escape", false)).toBeNull();
  });

  it("ticks and unticks kinds in the page's order, sets the severity and cleans", () => {
    let selection: Selection = { kinds: [], severity: "minor" };
    for (const key of ["4", "1", "m"]) selection = applyAction(selection, actionForKey(key, false)!);
    expect(selection).toEqual({ kinds: ["spoiler", "out_of_character"], severity: "major" });
    selection = applyAction(selection, actionForKey("4", false)!);
    expect(selection.kinds).toEqual(["spoiler"]);
    expect(applyAction(selection, { type: "save" })).toBe(selection);
    expect(applyAction(selection, { type: "clean" })).toEqual({ kinds: [], severity: "major" });
  });

  it("is served to the browser as a module that runs", async () => {
    const { server } = await serve(await copyFixture());
    const served = await get(server, "/keys.js");
    expect(served.status).toBe(200);
    expect(served.body).not.toMatch(/import type|: GameKind|satisfies/);
    const module = await import(`data:text/javascript;base64,${Buffer.from(served.body).toString("base64")}`);
    expect(module.actionForKey("2", false)).toEqual({ type: "toggle-kind", kind: "fabrication" });
  });
});

describe("a turn's view", () => {
  it("holds the player's line, the narration, the revealed clues and the ground truth", async () => {
    const { server } = await serve(await copyFixture());
    const ask = (await get(server, "/turn/4")).body;
    expect(ask).toContain("Did you see anything?");
    expect(ask).toContain(escapeHtml('"I saw a shadow slip toward the garden," Mara says.'));
    expect(ask).toContain("clue_mara_1: Mara saw a shadow slip toward the garden.");
    expect(ask).toContain("Dorn slipped into the hall and took the medal while everyone was at dinner.");
    expect(ask).toContain("Dorn Pike");
    const search = (await get(server, "/turn/7")).body;
    expect(search).toContain("look by the wall");
    expect(search).toContain("clue_garden_1: Trampled roses by the wall.");
  });

  it("starts at the first turn with no label, and shows turn 1 as the game's first", async () => {
    const { server } = await serve(await copyFixture());
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/1" });
    const first = (await get(server, "/turn/1")).body;
    expect(first).toContain("turn 1 of 9");
    expect(first).toContain("(the game begins)");
    expect(first).toContain("You arrive at the grand hall as the dinner party winds down.");
    expect(first).toContain("none");
  });

  it("describes a turn the player typed nothing for, a clue the blueprint lacks, and leaves out refused lines", async () => {
    const set = await loadTruthSet(FIXTURE);
    const game = structuredClone(set.games[0].trace);
    game.events.push({ ...game.events[0], id: "e10", sequence: 10, event_type: "no_turn_line" });
    game.events[1].payload = { ...game.events[1].payload, revealed_clue_id: "clue_missing" };
    expect(playedTurns(game).map((event) => event.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const line = (sequence: number) => buildTurnView(game, sequence, 1, 1).playerLine;
    expect([line(3), line(5), line(6), line(8)]).toEqual([
      "(starts talking to Mara)",
      "(ends the conversation)",
      "(moves to Walled Garden)",
      "(starts the accusation)",
    ]);
    expect(line(9)).toBe("Dorn did it.");
    expect(buildTurnView(game, 2, 1, 1).clues).toEqual([{ id: "clue_missing", text: null }]);
    expect(() => buildTurnView(game, 99, 1, 1)).toThrow("has no turn 99");
  });
});

describe("saving a label", () => {
  it("appends it to the label file, valid by the truth schema, and goes on to the next turn", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const clean = await post(server, "/turn/1", []);
    expect(clean).toMatchObject({ status: 303, location: "/turn/2" });
    const fault = await post(server, "/turn/5", [["kind", "spoiler"], ["kind", "clue_handling"], ["severity", "major"], ["note", " too much "]]);
    expect(fault.location).toBe("/turn/6");
    const labels = await labelsOf(dir);
    expect(labels.slice(-2)).toEqual([
      { sequence: 1, faults: [], by: "tester", at: "2026-07-01T10:00:01.000Z", pass: 1 },
      {
        sequence: 5,
        faults: [
          { kind: "spoiler", severity: "major", note: "too much" },
          { kind: "clue_handling", severity: "major", note: "too much" },
        ],
        by: "tester",
        at: "2026-07-01T10:00:02.000Z",
        pass: 1,
      },
    ]);
    const set = await loadTruthSet(dir);
    expect(set.games[0].labels).toHaveLength(labels.length);
  });

  it("keeps earlier labels and shows the latest one on the form", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    await post(server, "/turn/7", [["kind", "fabrication"], ["severity", "minor"], ["note", "second look"]]);
    expect((await labelsOf(dir)).filter((label) => label.sequence === 7)).toHaveLength(2);
    const page = (await get(server, "/turn/7")).body;
    expect(page).toContain('value="fabrication" checked');
    expect(page).toContain('value="minor" checked');
    expect(page).toContain('value="second look"');
    expect(page).toContain("Latest label: tester");
  });

  it("appends to the labels the file holds now, keeping one added since the server started", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const file = path.join(dir, "games/medal/labels.json");
    const held = await readJson(file);
    held.labels.push({ sequence: 6, faults: [], by: "someone", at: "2026-06-05T00:00:00Z", pass: 1 });
    await writeJson(file, held);
    await post(server, "/turn/1", []);
    expect((await labelsOf(dir)).map((label) => label.by)).toEqual(["fixture", "fixture", "fixture", "fixture", "fixture", "someone", "tester"]);
    expect((await get(server, "/turn/6")).body).toContain("Latest label: someone");
  });

  it("never gives two labels of a turn the same time, even when the clock stands still", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir, { now: () => new Date("2026-07-02T00:00:00Z") });
    await post(server, "/turn/1", []);
    expect((await post(server, "/turn/1", [])).status).toBe(303);
    expect((await labelsOf(dir)).filter((label) => label.sequence === 1).map((label) => label.at)).toEqual([
      "2026-07-02T00:00:00.000Z",
      "2026-07-02T00:00:00.001Z",
    ]);
  });

  it.each([
    ["a fault with no note", [["kind", "spoiler"]], "a fault needs a note"],
    ["a note with no fault", [["note", "stray"]], "a note belongs to a fault"],
    ["a kind that does not exist", [["kind", "rude"], ["note", "x"]], '"rude" is not a kind of fault'],
    ["a severity that does not exist", [["kind", "spoiler"], ["severity", "huge"], ["note", "x"]], '"huge" is not a severity'],
  ] as [string, [string, string][], string][])("shows and logs %s, and writes nothing", async (_name, fields, message) => {
    const dir = await copyFixture();
    const before = await fs.readFile(path.join(dir, "games/medal/labels.json"), "utf8");
    const { server, log } = await serve(dir);
    const response = await post(server, "/turn/1", fields);
    expect(response.status).toBe(422);
    expect(response.body).toContain(escapeHtml(message));
    expect(response.body).toContain("Not saved");
    expect(log.join("\n")).toContain(message);
    expect(await fs.readFile(path.join(dir, "games/medal/labels.json"), "utf8")).toBe(before);
    expect((await get(server, "/turn/1")).body).not.toContain("Latest label");
  });

  it("keeps what was typed when a save is refused", async () => {
    const { server } = await serve(await copyFixture());
    const response = await post(server, "/turn/1", [["kind", "fabrication"], ["severity", "major"]]);
    expect(response.body).toContain('value="fabrication" checked');
    expect(response.body).toContain('value="major" checked');
  });

  it("shows and logs a file that cannot be written, and keeps nothing in memory", async () => {
    const dir = await copyFixture();
    const { server, log } = await serve(dir);
    const file = path.join(dir, "games/medal/labels.json");
    await fs.rm(file);
    await fs.mkdir(file);
    const response = await post(server, "/turn/1", []);
    expect(response.status).toBe(500);
    expect(response.body).toContain("the file could not be written");
    expect(log.join("\n")).toContain("label for turn 1 not saved");
    expect((await get(server, "/turn/1")).body).not.toContain("Latest label");
    expect(await fs.readdir(path.dirname(file))).toEqual(["labels.json", "trace.json"]);
  });

  it("creates the label file for a game that has none", async () => {
    const dir = await copyFixture();
    await fs.rm(path.join(dir, "games/medal/labels.json"));
    const { server } = await serve(dir);
    expect((await get(server, "/")).location).toBe("/turn/1");
    await post(server, "/turn/1", []);
    expect(await labelsOf(dir)).toHaveLength(1);
  });

  it("refuses a save for a turn the game does not have, and a form that is too large", async () => {
    const { server } = await serve(await copyFixture());
    expect((await post(server, "/turn/99", [])).status).toBe(404);
    const large = await post(server, "/turn/1", [["note", "x".repeat(70_000)]]);
    expect(large.status).toBe(422);
    expect(large.body).toContain("the form is too large");
  });

  it("finishes on a page that lists the turns", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    for (const sequence of [1, 5, 6, 8]) await post(server, `/turn/${sequence}`, []);
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/9" });
    expect((await post(server, "/turn/9", [])).location).toBe("/done");
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/done" });
    const done = (await get(server, "/done")).body;
    expect(done).toContain("9 of 9 turns done in pass 1.");
    expect(done).toContain('href="/turn/7"');
  });
});

describe("pass one", () => {
  it("shows no judge finding in any response", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const bodies = [(await get(server, "/")).body, (await get(server, "/done")).body, (await get(server, "/keys.js")).body];
    for (let sequence = 1; sequence <= 9; sequence += 1) bodies.push((await get(server, `/turn/${sequence}`)).body);
    bodies.push((await post(server, "/turn/2", [["kind", "spoiler"]])).body);
    const everything = bodies.join("\n");
    for (const text of ["culprit-leak", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree"]) {
      expect(everything).not.toContain(text);
    }
  });

  it("works on a game that no result judged", async () => {
    const { server } = await serve(await copyFixture({ withResults: false }));
    expect((await get(server, "/turn/2")).status).toBe(200);
  });
});

/** The copied fixture with a catch on a planted variant: turn 5 is not planted there and counts, turn 3 is and does not. */
async function withVariantFinding(dir: string): Promise<string> {
  const finding = (sequence: number) => ({ sequence, kinds: ["out_of_character"], severity: "minor", judge_kind: "voice" });
  await writeJson(path.join(dir, "results/variant.json"), {
    schema_version: "mystery-truth-results/1",
    verdicts: [
      {
        subject: { side: "game", game: "medal", variant: "medal-leak", sequence: null },
        judge: "gm_roleplay",
        model: "claude-opus-stub",
        sample: 0,
        status: "pass",
        findings: [finding(5), finding(3)],
        duration_ms: null,
        cost_usd: null,
      },
    ],
  });
  return dir;
}

describe("pass one, reported turns only", () => {
  it("are the turns a finding points at, on the game or a variant, leaving out a variant's planted turns", async () => {
    const fixture = await loadTruthSet(FIXTURE);
    // The fixture's catch on medal-spoiler is at its planted turn 4; its age verdict at turn 4 found nothing.
    expect([...reportedTurns(fixture.results.flatMap((results) => results.verdicts), fixture.turnVariants, "medal")]).toEqual([7]);
    const set = await loadTruthSet(await withVariantFinding(await copyFixture()));
    const turns = reportedTurns(set.results.flatMap((results) => results.verdicts), set.turnVariants, "medal");
    expect([...turns].sort((a, b) => a - b)).toEqual([2, 5, 7]);
    expect(reportedTurns(set.results.flatMap((results) => results.verdicts), set.turnVariants, "another").size).toBe(0);
  });

  it("serves only those turns, still showing no judge finding", async () => {
    const dir = await withVariantFinding(await copyFixture());
    const { server } = await serve(dir, { reported: true });
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/5" });
    const pages = await Promise.all([2, 5, 7].map(async (sequence) => (await get(server, `/turn/${sequence}`)).body));
    expect(pages.map((page) => /turn (\d) of 3/.exec(page)?.[1])).toEqual(["1", "2", "3"]);
    for (const sequence of [1, 3, 4, 6, 8, 9]) expect((await get(server, `/turn/${sequence}`)).status).toBe(404);
    expect(await post(server, "/turn/5", [])).toMatchObject({ status: 303, location: "/turn/7" });
    const done = (await get(server, "/done")).body;
    expect(done).toContain("3 of 3 turns done in pass 1.");
    const everything = [...pages, done].join("\n");
    for (const text of ["culprit-leak", "voice", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree"]) {
      expect(everything).not.toContain(text);
    }
  });

  it("says so when results judge the game but no finding points at a turn", async () => {
    const dir = await copyFixture({ withResults: false });
    await writeJson(path.join(dir, "results/clean.json"), {
      schema_version: "mystery-truth-results/1",
      verdicts: [
        {
          subject: { side: "game", game: "medal", variant: "medal-leak", sequence: null },
          judge: "gm_roleplay",
          model: "claude-opus-stub",
          sample: 0,
          status: "pass",
          findings: [],
          duration_ms: null,
          cost_usd: null,
        },
      ],
    });
    const { server } = await serve(dir, { reported: true });
    expect(await get(server, "/")).toMatchObject({ location: "/done" });
    expect((await get(server, "/done")).body).toContain("No turn to label: no stored finding points at a turn of this game.");
  });

  it("refuses without stored results that judge the game or its variants, and in pass 2", async () => {
    await expect(serve(await copyFixture({ withResults: false }), { reported: true })).rejects.toThrow(
      /--reported needs stored judge results, and none in .*results judge game "medal" or its variants/,
    );
    await expect(serve(await copyFixture(), { reported: true, pass: 2 })).rejects.toThrow("--reported limits pass 1");
  });
});

describe("pass two", () => {
  it("serves exactly the turns where a judge and the label disagree, with those findings", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir, { pass: 2 });
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/2" });
    const caught = (await get(server, "/turn/2")).body;
    expect(caught).toContain("turn 1 of 2");
    expect(caught).toContain("a judge caught <b>spoiler</b>, the label says clean");
    expect(caught).toContain("gm_spoiler");
    expect(caught).toContain("culprit-leak");
    const missed = (await get(server, "/turn/3")).body;
    expect(missed).toContain("labelled <b>out_of_character</b>, no judge caught it");
    expect(missed).toContain("gm_roleplay");
    expect(missed).toContain("nothing at this turn");
    expect(missed).not.toContain("culprit-leak");
    // Agreements, unlabelled turns, a judge that errored and a planted variant's catch are not disagreements.
    for (const sequence of [1, 4, 7, 9]) expect((await get(server, `/turn/${sequence}`)).status).toBe(404);
    expect(missed).not.toContain("gm_clue_discipline");
  });

  it("records a relabel as pass 2 and resumes at the turn after the last one looked at", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir, { pass: 2 });
    const saved = await post(server, "/turn/2", [["kind", "spoiler"], ["severity", "minor"], ["note", "the judge is right"]]);
    expect(saved).toMatchObject({ status: 303, location: "/turn/3" });
    const last = (await labelsOf(dir)).at(-1);
    expect(last).toMatchObject({ sequence: 2, pass: 2, by: "tester", faults: [{ kind: "spoiler", severity: "minor", note: "the judge is right" }] });
    // Agreeing now, turn 2 leaves the list.
    expect((await get(server, "/turn/2")).status).toBe(404);
    expect(await get(server, "/")).toMatchObject({ location: "/turn/3" });
    // Turn 3 is still a disagreement after it is looked at again, so it stays, done.
    await post(server, "/turn/3", [["kind", "out_of_character"], ["severity", "major"], ["note", "still wrong"]]);
    expect(await get(server, "/")).toMatchObject({ location: "/done" });
    expect((await get(server, "/done")).body).toContain("1 of 1 turns done in pass 2.");
  });

  it("says so when nothing disagrees", async () => {
    const dir = await copyFixture();
    await fs.rm(path.join(dir, "results/extra.json"));
    const { server } = await serve(dir, { pass: 2 });
    expect((await get(server, "/done")).body).toContain("No turn needs a second look");
  });

  it("refuses without stored results that judge the game, saying so", async () => {
    await expect(startLabelServer({ truthRoot: await copyFixture({ withResults: false }), game: "medal", pass: 2, by: "tester" })).rejects.toThrow(
      /pass 2 needs stored judge results, and none in .*results judge game "medal"/,
    );
    const dir = await copyFixture({ withResults: false });
    await writeJson(path.join(dir, "results/blueprints-only.json"), {
      schema_version: "mystery-truth-results/1",
      verdicts: [
        {
          subject: { side: "blueprint", base: "mock", plant: null },
          judge: "fairness",
          model: "claude-opus-stub",
          sample: 0,
          status: "pass",
          findings: [],
          duration_ms: null,
          cost_usd: null,
        },
      ],
    });
    await expect(startLabelServer({ truthRoot: dir, game: "medal", pass: 2, by: "tester" })).rejects.toThrow(/pass 2 needs stored judge results/);
  });
});

describe("where a judge and a label disagree", () => {
  const game = { side: "game", game: "medal", variant: null, sequence: null } as const;
  const verdict = (overrides: Partial<StoredVerdict>): StoredVerdict => ({
    subject: game,
    judge: "gm_spoiler",
    model: "m",
    sample: 0,
    status: "fail",
    findings: [{ sequence: 4, kinds: ["spoiler"], severity: "major", judge_kind: null }],
    duration_ms: null,
    cost_usd: null,
    ...overrides,
  });
  const clean = [{ sequence: 4, faults: [], by: "a", at: "2026-06-01T00:00:00Z", pass: 1 as const }];
  const spoiler = [{ sequence: 4, faults: [{ kind: "spoiler" as const, severity: "minor" as const, note: "x" }], by: "a", at: "2026-06-01T00:00:00Z", pass: 1 as const }];

  it("counts any sample's catch, and a verdict of one turn only on its own turn", () => {
    expect(disagreementsAt("medal", clean, [verdict({ sample: 1, findings: [] }), verdict({})], 4).map((found) => found.kind)).toEqual(["spoiler"]);
    expect(disagreementsAt("medal", spoiler, [verdict({ subject: { ...game, sequence: 5 } })], 4)).toEqual([]);
    expect(disagreementsAt("medal", clean, [verdict({ subject: { ...game, sequence: 4 } })], 4)).toHaveLength(1);
  });

  it("ignores a planted variant, an answer that was an error, and a turn with no label", () => {
    expect(disagreementsAt("medal", clean, [verdict({ subject: { ...game, variant: "medal-spoiler" } })], 4)).toEqual([]);
    expect(disagreementsAt("medal", clean, [verdict({ status: "error", findings: [] })], 4)).toEqual([]);
    expect(disagreementsAt("medal", [], [verdict({})], 4)).toEqual([]);
  });

  it("names a labelled fault that no sample caught, only when a judge of the kind judged the turn", () => {
    expect(disagreementsAt("medal", spoiler, [verdict({ status: "pass", findings: [] })], 4)).toMatchObject([{ kind: "spoiler", label: "fault" }]);
    expect(disagreementsAt("medal", spoiler, [verdict({ status: "pass", findings: [], judge: "gm_roleplay" })], 4)).toEqual([]);
    expect(disagreementsAt("medal", spoiler, [verdict({})], 4)).toEqual([]);
  });
});

describe("the server's address", () => {
  it("listens on the loopback address only", async () => {
    const { server } = await serve(await copyFixture());
    expect(new URL(server.url).hostname).toBe("127.0.0.1");
    const outside = Object.values(os.networkInterfaces())
      .flat()
      .find((entry) => entry?.family === "IPv4" && !entry.internal);
    if (outside) {
      await expect(fetch(`http://${outside.address}:${server.port}/`)).rejects.toThrow();
    }
  });

  it("answers only requests for its own address, and saves only from its own page", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const headers = (host: string) => new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: server.port, path: "/turn/1", headers: { host } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }).on("error", reject);
    });
    expect(await headers("evil.example")).toBe(403);
    expect(await headers(`localhost:${server.port}`)).toBe(200);
    const foreign = await fetch(new URL("/turn/1", server.url), { method: "POST", headers: { origin: "http://evil.example" }, body: "" });
    expect(foreign.status).toBe(403);
    const opaque = await fetch(new URL("/turn/1", server.url), { method: "POST", headers: { origin: "null" }, body: "" });
    expect(opaque.status).toBe(403);
    expect(await labelsOf(dir)).toHaveLength(5);
  });

  it("answers an unknown path and method with a not-found page", async () => {
    const { server } = await serve(await copyFixture());
    expect((await get(server, "/nowhere")).status).toBe(404);
    expect((await fetch(new URL("/turn/1", server.url), { method: "DELETE" })).status).toBe(404);
  });
});

describe("./dev eval label", () => {
  const context = (out: string[], err: string[]) => ({ root: repoRoot(), out: (text: string) => out.push(text), err: (text: string) => err.push(text), env: {} });

  it("is the ninth command, and explains its flags", async () => {
    expect(COMMANDS.map((command) => command.name)).toContain("label");
    const out: string[] = [];
    expect(await runEval(["label", "--help"], context(out, []), COMMANDS)).toBe(0);
    for (const flag of ["--pass", "--reported", "--by", "--truth", "--port"]) expect(out.join("\n")).toContain(flag);
  });

  it("serves the named game until told to stop, then closes the server", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    let seen = "";
    const command = createLabelCommand(async (server) => {
      seen = (await get(server, "/turn/1")).body;
    });
    expect(await runEval(["label", "medal", "--truth", dir, "--by", " Dino "], context(out, []), [command])).toBe(0);
    expect(seen).toContain("turn 1 of 9");
    expect(out.join("\n")).toMatch(/Labelling medal, pass 1, as Dino\.\nOpen http:\/\/127\.0\.0\.1:\d+\//);
  });

  it("defaults to the repository's truth set, and needs --by", async () => {
    const out: string[] = [];
    const err: string[] = [];
    const command = createLabelCommand(async () => undefined);
    expect(await runEval(["label", "medal", "--by", "tester"], context(out, err), [command])).toBe(1);
    expect(err.join("\n")).toMatch(/no stored game "medal" in .*evaluation\/truth \(it holds: [^)]+\)/);
    const dir = await copyFixture();
    expect(await runEval(["label", "medal", "--truth", dir], context(out, err), [command])).toBe(1);
    expect(err.join("\n")).toContain("--by is required");
    expect(out).toEqual([]);
  });

  it("labels only the reported turns with --reported", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    let seen = "";
    const command = createLabelCommand(async (server) => {
      seen = (await get(server, "/turn/7")).body;
    });
    expect(await runEval(["label", "medal", "--truth", dir, "--by", "tester", "--reported"], context(out, []), [command])).toBe(0);
    expect(seen).toContain("turn 2 of 2");
    expect(out.join("\n")).toContain("Labelling medal, pass 1, reported turns, as tester.");
  });

  it("refuses pass 2 without results, with its message and exit 1", async () => {
    const err: string[] = [];
    const command = createLabelCommand(async () => undefined);
    const dir = await copyFixture({ withResults: false });
    expect(await runEval(["label", "medal", "--pass", "2", "--truth", dir, "--by", "tester"], context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain("pass 2 needs stored judge results");
  });

  it.each([
    [["label"], "expected at least 1"],
    [["label", "medal", "--pass", "3"], "--pass takes 1 or 2"],
    [["label", "medal", "--port", "99999"], "--port takes a number"],
    [["label", "medal", "--port", "abc"], "--port takes a number"],
    [["label", "medal", "--by", " "], "--by needs a value"],
    [["label", "medal"], "--by is required"],
    [["label", "medal", "--by", "tester", "--pass", "2", "--reported"], "--reported limits pass 1"],
  ])("rejects %j as a usage error", async (argv, message) => {
    const err: string[] = [];
    const command = createLabelCommand(async () => undefined);
    expect(await runEval(argv, context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain(message);
  });
});
