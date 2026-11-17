import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { COMMANDS } from "../../../evaluation/commands.ts";
import { tailscaleName } from "../../../evaluation/core/tailscale.ts";
import { createLabelCommand, TAILSCALE_PORT } from "../../../evaluation/label/command.ts";
import { disagreementsAt, reportedTurns, tallyByJudge } from "../../../evaluation/label/disagreements.ts";
import type { Disagreement, VerdictAtTurn } from "../../../evaluation/label/disagreements.ts";
import { describeJudgeKind } from "../../../evaluation/label/judge-kinds.ts";
import { TURN_AGE_FINDING_KINDS } from "../../../evaluation/core/judge-prompt.ts";
import { schema as broadSchema } from "../../../evaluation/judges/gm-broad.schema.ts";
import { schema as clueSchema } from "../../../evaluation/judges/gm-clue-discipline.schema.ts";
import { schema as fabricationSchema } from "../../../evaluation/judges/gm-fabrication.schema.ts";
import { schema as roleplaySchema } from "../../../evaluation/judges/gm-roleplay.schema.ts";
import { schema as spoilerSchema } from "../../../evaluation/judges/gm-spoiler.schema.ts";
import { actionForKey, applyAction, KEYED_KINDS, KIND_KEYS } from "../../../evaluation/label/keys.ts";
import type { Draft } from "../../../evaluation/label/keys.ts";
import { escapeHtml, renderDisagreements } from "../../../evaluation/label/page.ts";
import { phasePath } from "../../../evaluation/label/hub.ts";
import type { Phase } from "../../../evaluation/label/hub.ts";
import { startLabelServer } from "../../../evaluation/label/server.ts";
import type { LabelServer, LabelServerOptions } from "../../../evaluation/label/server.ts";
import { buildTurnView, formFromLabel, playedTurns } from "../../../evaluation/label/turns.ts";
import { GAME_KINDS } from "../../../evaluation/lib/truth/kinds.ts";
import { loadTruthSet } from "../../../evaluation/lib/truth/loader.ts";
import type { StoredFinding, StoredVerdict } from "../../../evaluation/lib/truth/schemas.ts";

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

const SPOILER_FINDING = {
  sequence: 2,
  kinds: ["spoiler"],
  severity: "minor",
  judge_kind: "culprit-leak",
  quote: "the gardener looked guilty",
  why: "Points the player at the culprit before any clue does.",
  refers_to: "char-dorn",
};

/** What the spoiler judge said, which no response may show before pass 2. */
const JUDGE_WORDS = [SPOILER_FINDING.quote, SPOILER_FINDING.why, SPOILER_FINDING.refers_to, "runs flagged this turn"];

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

/** Labels every turn the copied fixture leaves unlabelled clean, so pass 2 opens. */
async function finishPass1(dir: string): Promise<string> {
  const file = path.join(dir, "games/medal/labels.json");
  const held = await readJson(file);
  for (const sequence of [1, 5, 6, 8, 9]) held.labels.push({ sequence, faults: [], by: "fixture", at: "2026-06-02T00:00:00Z", pass: 1 });
  await writeJson(file, held);
  return dir;
}

let clock = Date.parse("2026-07-01T10:00:00Z");
const now = () => new Date((clock += 1000));

type ServeOptions = Partial<LabelServerOptions> & { phase?: Phase };

/** The pass each server was opened on: the paths a test gives (`/`, `/done`, `/turn/<n>`) are that pass's own. */
const phases = new Map<LabelServer, string>();

async function serve(dir: string, { phase = "pass-1", ...overrides }: ServeOptions = {}): Promise<{ server: LabelServer; log: string[] }> {
  const log: string[] = [];
  const server = await startLabelServer({ truthRoot: dir, by: "tester", now, log: (text) => log.push(text), ...overrides });
  servers.push(server);
  phases.set(server, phasePath("medal", phase));
  return { server, log };
}

/** A path of the server's pass made whole, and a location made back into one; other paths pass as they are. */
function inPass(server: LabelServer, pathname: string): string {
  const base = phases.get(server) ?? "";
  return pathname === "/" || pathname === "/done" || pathname.startsWith("/turn/") ? `${base}${pathname}` : pathname;
}

function ofPass(server: LabelServer, location: string | null): string | null {
  const base = phases.get(server) ?? "";
  return location !== null && location.startsWith(`${base}/`) ? location.slice(base.length) : location;
}

async function get(server: LabelServer, pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; location: string | null; body: string }> {
  const response = await fetch(new URL(inPass(server, pathname), server.url), { redirect: "manual", headers });
  return { status: response.status, location: ofPass(server, response.headers.get("location")), body: await response.text() };
}

async function post(server: LabelServer, pathname: string, fields: [string, string][], headers: Record<string, string> = {}) {
  const response = await fetch(new URL(inPass(server, pathname), server.url), {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", origin: new URL(server.url).origin, ...headers },
    body: new URLSearchParams(fields).toString(),
  });
  return { status: response.status, location: ofPass(server, response.headers.get("location")), body: await response.text(), cookie: response.headers.get("set-cookie") };
}

const labelsOf = async (dir: string) => (await readJson(path.join(dir, "games/medal/labels.json"))).labels;

describe("the labelling keyboard", () => {
  it("maps each key to its kind, severity, row or movement", () => {
    expect(KEYED_KINDS).toEqual(GAME_KINDS);
    for (const [key, kind] of Object.entries(KIND_KEYS)) expect(actionForKey(key, false)).toEqual({ type: "set-kind", kind });
    expect(actionForKey("m", false)).toEqual({ type: "set-severity", severity: "major" });
    expect(actionForKey("n", false)).toEqual({ type: "set-severity", severity: "minor" });
    expect(actionForKey("a", false)).toEqual({ type: "add-fault" });
    expect(actionForKey("x", false)).toEqual({ type: "remove-fault" });
    expect(actionForKey("t", false)).toEqual({ type: "focus-note" });
    expect(actionForKey("c", false)).toEqual({ type: "clean" });
    expect(actionForKey("p", false)).toEqual({ type: "previous" });
    expect(actionForKey("g", false)).toEqual({ type: "toggle-truth" });
    expect(actionForKey("Enter", false)).toEqual({ type: "save" });
    expect(actionForKey("Escape", false)).toEqual({ type: "close" });
    expect(actionForKey("z", false)).toBeNull();
    expect(actionForKey("toString", false)).toBeNull();
  });

  it("leaves the keys to the note while it is being typed in, except Escape", () => {
    for (const key of ["1", "m", "a", "c", "Enter", "t"]) expect(actionForKey(key, true)).toBeNull();
    expect(actionForKey("Escape", true)).toEqual({ type: "leave-note" });
  });

  it("builds faults one row at a time, each with its own kind and severity", () => {
    const press = (draft: Draft, ...keys: string[]) => keys.reduce((next, key) => applyAction(next, actionForKey(key, false)!), draft);
    const empty: Draft = { faults: [], current: -1 };
    // A kind with no row makes one; a second row takes its own kind and severity.
    let draft = press(empty, "1", "m", "a", "4");
    expect(draft).toEqual({
      faults: [
        { kind: "spoiler", severity: "major", note: "" },
        { kind: "out_of_character", severity: "minor", note: "" },
      ],
      current: 1,
    });
    // The keys act on the current row only.
    draft = press({ ...draft, current: 0 }, "2", "n");
    expect(draft.faults.map((fault) => [fault.kind, fault.severity])).toEqual([
      ["fabrication", "minor"],
      ["out_of_character", "minor"],
    ]);
    expect(press(empty, "t")).toEqual({ faults: [{ kind: "", severity: "minor", note: "" }], current: 0 });
    expect(press(empty, "n").faults).toHaveLength(1);
    // Removing takes the current row; the one before becomes current.
    expect(press({ ...draft, current: 1 }, "x")).toEqual({ faults: [draft.faults[0]], current: 0 });
    expect(press(press(draft, "x", "x"), "x")).toEqual({ faults: [], current: -1 });
    expect(press(draft, "c")).toEqual(empty);
    for (const key of ["Enter", "p", "g", "Escape"]) expect(press(draft, key)).toBe(draft);
  });

  it("is served to the browser as a module that runs", async () => {
    const { server } = await serve(await copyFixture());
    const served = await get(server, "/keys.js");
    expect(served.status).toBe(200);
    expect(served.body).not.toMatch(/import type|: GameKind|satisfies/);
    const module = await import(`data:text/javascript;base64,${Buffer.from(served.body).toString("base64")}`);
    expect(module.actionForKey("2", false)).toEqual({ type: "set-kind", kind: "fabrication" });
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

  it("titles the turn with the game, the target age, the pass and its place, and puts the command with the player", async () => {
    const { server } = await serve(await copyFixture());
    const page = (await get(server, "/turn/7")).body;
    expect(page).toContain("<h1>medal &middot; age 9 &middot; pass 1 &middot; turn 7 of 9</h1>");
    expect(page).not.toMatch(/\(event \d+/);
    expect(page).toContain('<h2>The player</h2><p class="command"><code>search</code></p><p>look by the wall</p>');
    expect(page).toContain("<title>medal, turn 7</title>");
  });

  it("keeps the ground truth, its target age and the whole cast in a menu in the title", async () => {
    const { server } = await serve(await copyFixture());
    const page = (await get(server, "/turn/1")).body;
    const title = page.slice(page.indexOf('<div class="title">'), page.indexOf("<section>"));
    expect(title).toContain('<details class="menu" id="truth"><summary>Ground truth');
    expect(title).toContain("<b>Target age:</b> 9");
    expect(title).toContain("Dorn slipped into the hall and took the medal while everyone was at dinner.");
    expect(title).toContain("<h2>The cast</h2>");
    for (const name of ["Mara Vale", "Dorn Pike"]) expect(title).toContain(`<details class="fold"><summary>${name}</summary>`);
    expect(title).toContain("<b>Motive:</b> He owed money and the medal was valuable.");
    // Nothing of it is in the page's body, and a turn that talks to no one has no profile.
    expect(page.slice(page.indexOf("<section>"))).not.toContain("took the medal");
    expect(page).not.toContain('id="profile"');
  });

  it("opens the profile of the character a conversation turn talks to, what they hide under a fold", async () => {
    const { server } = await serve(await copyFixture());
    for (const sequence of [3, 4, 5]) {
      const page = (await get(server, `/turn/${sequence}`)).body;
      const player = page.slice(page.indexOf("<h2>The player</h2>"), page.indexOf("<h2>Narration</h2>"));
      expect(player).toContain('<details class="menu" id="profile"><summary>Mara Vale: profile</summary>');
      const shown = player.slice(0, player.indexOf('<details class="fold">'));
      const folded = player.slice(player.indexOf('<details class="fold">'));
      for (const text of ["Warm but nervous.", "Helpful.", "The household cook.", "female; Tall, in a green apron."]) expect(shown).toContain(text);
      for (const text of ["I was in the kitchen all evening.", "<b>Culprit:</b> no", "Knows the dinner menu.", "Mara cooked and served dinner", "clue_mara_1: Mara saw a shadow"]) {
        expect(folded).toContain(text);
      }
    }
  });

  it("starts at the first turn with no label, and shows turn 1 as the game's first", async () => {
    const { server } = await serve(await copyFixture());
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/1" });
    const first = (await get(server, "/turn/1")).body;
    expect(first).toContain("turn 1 of 9</h1>");
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

  it("reads a profile's tells and agendas, and has no age or speaker the blueprint does not give", async () => {
    const set = await loadTruthSet(FIXTURE);
    const game = structuredClone(set.games[0].trace);
    const blueprint = game.blueprint as { metadata: Record<string, unknown>; world: { characters: Record<string, unknown>[] } };
    Object.assign(blueprint.world.characters[0], {
      tells: [{ id: "tell_mara", text: "Wrings her apron.", trigger: { kind: "condition", condition: "asked about dinner" } }],
      agendas: [{ type: "protect_other", strategy: "Shield Dorn.", priority: "high", details: "Plays down the noise." }],
    });
    const mara = buildTurnView(game, 4, 1, 1).character;
    expect(mara).toMatchObject({ name: "Mara Vale", tells: ["Wrings her apron."], agendas: ["Shield Dorn. Plays down the noise."], motive: null, isCulprit: false });
    expect(buildTurnView(game, 4, 1, 1).groundTruth.culprit).toBe("Dorn Pike");
    delete blueprint.metadata.target_age;
    game.events[3].payload = { ...game.events[3].payload, character_id: "char_nobody" };
    expect(buildTurnView(game, 4, 1, 1)).toMatchObject({ targetAge: null, character: null });
    expect(buildTurnView(game, 7, 1, 1).character).toBeNull();
  });
});

describe("saving a label", () => {
  it("appends it to the label file, valid by the truth schema, and goes on to the next turn", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const clean = await post(server, "/turn/1", []);
    expect(clean).toMatchObject({ status: 303, location: "/turn/2" });
    const fault = await post(server, "/turn/5", [
      ["kind", "spoiler"],
      ["severity", "major"],
      ["note", " too much "],
      ["kind", "clue_handling"],
      ["severity", "minor"],
      ["note", "hands the clue over"],
    ]);
    expect(fault.location).toBe("/turn/6");
    const labels = await labelsOf(dir);
    expect(labels.slice(-2)).toEqual([
      { sequence: 1, faults: [], by: "tester", at: "2026-07-01T10:00:01.000Z", pass: 1 },
      {
        sequence: 5,
        faults: [
          { kind: "spoiler", severity: "major", note: "too much" },
          { kind: "clue_handling", severity: "minor", note: "hands the clue over" },
        ],
        by: "tester",
        at: "2026-07-01T10:00:02.000Z",
        pass: 1,
      },
    ]);
    const set = await loadTruthSet(dir);
    expect(set.games[0].labels).toHaveLength(labels.length);
    // Saved, the label reloads as its rows, each with its own severity and note.
    const page = (await get(server, "/turn/5")).body;
    const list = page.slice(page.indexOf('<div id="faults"'), page.indexOf("<template"));
    const rows = [...list.matchAll(/<fieldset class="fault[^"]*">(.*?)<\/fieldset>/g)].map((match) => match[1]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/value="spoiler" selected[\s\S]*value="major" selected[\s\S]*value="too much"/);
    expect(rows[1]).toMatch(/value="clue_handling" selected[\s\S]*value="minor" selected[\s\S]*value="hands the clue over"/);
  });

  it("fills the form with one row per fault of the latest label, none when it is clean", () => {
    const at = "2026-06-01T00:00:00Z";
    expect(formFromLabel(null)).toEqual({ faults: [] });
    expect(formFromLabel({ sequence: 1, faults: [], by: "a", at, pass: 1 })).toEqual({ faults: [] });
    const faults = [
      { kind: "spoiler" as const, severity: "major" as const, note: "names the culprit" },
      { kind: "out_of_character" as const, severity: "minor" as const, note: "too formal" },
    ];
    expect(formFromLabel({ sequence: 1, faults, by: "a", at, pass: 1 })).toEqual({ faults });
  });

  it("keeps earlier labels and shows the latest one on the form", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    await post(server, "/turn/7", [["kind", "fabrication"], ["severity", "minor"], ["note", "second look"]]);
    expect((await labelsOf(dir)).filter((label) => label.sequence === 7)).toHaveLength(2);
    const page = (await get(server, "/turn/7")).body;
    expect(page).toContain('value="fabrication" selected');
    expect(page).toContain('value="minor" selected');
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
    ["a fault with no note", [["kind", "spoiler"], ["severity", "minor"], ["note", " "]], "a fault needs a note saying what is wrong: the spoiler fault has none"],
    ["a fault with no kind", [["kind", ""], ["severity", "minor"], ["note", "stray"]], "choose a kind for every fault"],
    [
      "two faults of one kind",
      [["kind", "spoiler"], ["severity", "minor"], ["note", "x"], ["kind", "spoiler"], ["severity", "major"], ["note", "y"]],
      "two faults are spoiler",
    ],
    ["a fault missing a field", [["kind", "spoiler"], ["note", "x"]], "every fault needs a kind, a severity and a note field"],
    ["a kind that does not exist", [["kind", "rude"], ["severity", "minor"], ["note", "x"]], '"rude" is not a kind of fault'],
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

  it("names a label file that is not JSON, in the log and on the page", async () => {
    const dir = await copyFixture();
    const { server, log } = await serve(dir);
    const file = path.join(dir, "games/medal/labels.json");
    await fs.writeFile(file, "{ not json", "utf8");
    const unread = await get(server, "/turn/1");
    expect(unread.status).toBe(500);
    expect(unread.body).toContain(escapeHtml(`${file} is not JSON`));
    expect(log.join("\n")).toContain(`${file} is not JSON`);
  });

  it("keeps what was typed when a save is refused", async () => {
    const { server } = await serve(await copyFixture());
    const response = await post(server, "/turn/1", [
      ["kind", "fabrication"],
      ["severity", "major"],
      ["note", "invents a gate"],
      ["kind", "spoiler"],
      ["severity", "minor"],
      ["note", ""],
    ]);
    expect(response.status).toBe(422);
    expect(response.body).toContain('value="fabrication" selected');
    expect(response.body).toContain('value="major" selected');
    expect(response.body).toContain('value="invents a gate"');
    expect(response.body).toContain('value="spoiler" selected');
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
    expect(log.join("\n")).toContain("label for turn 1 of medal not saved");
    const unread = await get(server, "/turn/1");
    expect(unread.status).toBe(500);
    expect(unread.body).toContain("The label file of medal could not be read");
    expect(log.join("\n")).toContain("the label file of medal could not be read");
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
    const large = await post(server, "/turn/1", [["kind", "spoiler"], ["severity", "minor"], ["note", "x".repeat(70_000)]]);
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
    expect(done).toContain(`href="${phasePath("medal", "pass-1")}/turn/7"`);
  });
});

describe("pass one", () => {
  it("shows no judge finding in any response", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    const bodies = [(await get(server, "/")).body, (await get(server, "/done")).body, (await get(server, "/keys.js")).body];
    for (let sequence = 1; sequence <= 9; sequence += 1) bodies.push((await get(server, `/turn/${sequence}`)).body);
    bodies.push((await post(server, "/turn/2", [["kind", "spoiler"], ["severity", "minor"], ["note", ""]])).body);
    const everything = bodies.join("\n");
    for (const text of ["culprit-leak", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree", ...JUDGE_WORDS]) {
      expect(everything).not.toContain(text);
    }
  });

  it("works on a game that no result judged", async () => {
    const { server } = await serve(await copyFixture({ withResults: false }));
    expect((await get(server, "/turn/2")).status).toBe(200);
  });
});

/**
 * The copied fixture with a failing verdict on a planted variant: turn 5 is not
 * planted there and counts, turn 3 is and does not. A passing verdict's minor
 * finding at turn 6, and an erroring verdict's at turn 8, count for nothing.
 */
async function withVariantFinding(dir: string): Promise<string> {
  const finding = (sequence: number, severity = "minor") => ({ sequence, kinds: ["out_of_character"], severity, judge_kind: "voice", quote: null, why: null, refers_to: null });
  const ageFinding = (sequence: number) => ({ sequence, kinds: ["not_age_fit"], severity: "minor", judge_kind: null, quote: null, why: null, refers_to: null });
  const base = { judge: "gm_roleplay", model: "claude-opus-stub", sample: 0, duration_ms: null, cost_usd: null };
  await writeJson(path.join(dir, "results/variant.json"), {
    schema_version: "mystery-truth-results/1",
    verdicts: [
      { ...base, subject: { side: "game", game: "medal", variant: "medal-leak", sequence: null }, status: "fail", findings: [finding(5, "major"), finding(3)] },
      { ...base, subject: { side: "game", game: "medal", variant: null, sequence: 6 }, judge: "age_appropriate_turn", status: "pass", findings: [ageFinding(6)] },
      { ...base, subject: { side: "game", game: "medal", variant: null, sequence: 8 }, judge: "age_appropriate_turn", status: "error", findings: [ageFinding(8)] },
    ],
  });
  return dir;
}

describe("pass one, reported turns only", () => {
  it("are the turns a failing verdict's finding points at, on the game or a variant, leaving out a variant's planted turns", async () => {
    const fixture = await loadTruthSet(FIXTURE);
    // The fixture's catch on medal-spoiler is at its planted turn 4; its age verdict at turn 4 passed and found nothing.
    expect([...reportedTurns(fixture.results.flatMap((results) => results.verdicts), fixture.turnVariants, "medal")]).toEqual([7]);
    const set = await loadTruthSet(await withVariantFinding(await copyFixture()));
    const turns = reportedTurns(set.results.flatMap((results) => results.verdicts), set.turnVariants, "medal");
    // Turns 6 and 8 carry findings too, but on a passing and an erroring verdict.
    expect([...turns].sort((a, b) => a - b)).toEqual([2, 5, 7]);
    expect(reportedTurns(set.results.flatMap((results) => results.verdicts), set.turnVariants, "another").size).toBe(0);
  });

  it("serves only those turns, still showing no judge finding", async () => {
    const dir = await withVariantFinding(await copyFixture());
    const { server } = await serve(dir, { phase: "reported" });
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/5" });
    const pages = await Promise.all([2, 5, 7].map(async (sequence) => (await get(server, `/turn/${sequence}`)).body));
    expect(pages.map((page) => /turn (\d) of 3/.exec(page)?.[1])).toEqual(["1", "2", "3"]);
    for (const sequence of [1, 3, 4, 6, 8, 9]) expect((await get(server, `/turn/${sequence}`)).status).toBe(404);
    expect(await post(server, "/turn/5", [])).toMatchObject({ status: 303, location: "/turn/7" });
    const done = (await get(server, "/done")).body;
    expect(done).toContain("3 of 3 turns done in pass 1.");
    const everything = [...pages, done].join("\n");
    for (const text of ["culprit-leak", "voice", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree", ...JUDGE_WORDS]) {
      expect(everything).not.toContain(text);
    }
  });

  it("says so when results judge the game but no failing verdict's finding points at a turn", async () => {
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
          findings: [{ sequence: 5, kinds: ["out_of_character"], severity: "minor", judge_kind: "voice", quote: null, why: null, refers_to: null }],
          duration_ms: null,
          cost_usd: null,
        },
      ],
    });
    const { server } = await serve(dir, { phase: "reported" });
    expect(await get(server, "/")).toMatchObject({ location: "/done" });
    expect((await get(server, "/done")).body).toContain("No turn to label: no finding of a failing verdict points at a turn of this game.");
  });

  it("are not there without stored results that judge the game or its variants, saying so", async () => {
    const { server } = await serve(await copyFixture({ withResults: false }), { phase: "reported" });
    const refused = await get(server, "/");
    expect(refused.status).toBe(404);
    expect(refused.body).toMatch(/reported turns need stored judge results, and none in .*results judge game &#34;medal&#34; or its variants/);
  });
});

describe("pass two", () => {
  it("serves exactly the turns where a judge and the label disagree, with those findings", async () => {
    const dir = await finishPass1(await copyFixture());
    const { server } = await serve(dir, { phase: "pass-2" });
    expect(await get(server, "/")).toMatchObject({ status: 303, location: "/turn/2" });
    const caught = (await get(server, "/turn/2")).body;
    expect(caught).toContain("turn 1 of 2");
    expect(caught).toContain("a judge caught <b>spoiler</b>, the label says clean");
    expect(caught).toContain("gm_spoiler");
    expect(caught).toContain("culprit-leak");
    // Each run that flagged the turn, with what it quoted, why, and what it refers to; never the run's pass or fail.
    expect(caught).toContain("gm_spoiler (claude-opus-stub): 1 of 1 run flagged this turn: 1 minor");
    expect(caught).toContain("<blockquote>the gardener looked guilty</blockquote>");
    expect(caught).toContain("<p>Points the player at the culprit before any clue does.</p>");
    expect(caught).toContain("refers to <code>char-dorn</code>");
    expect(caught).not.toMatch(/<td>(pass|fail)<\/td>/);
    const missed = (await get(server, "/turn/3")).body;
    expect(missed).toContain("labelled <b>out_of_character</b>, no judge caught it");
    expect(missed).toContain("gm_roleplay");
    expect(missed).toContain("gm_roleplay (claude-opus-stub): 0 of 1 run flagged this turn");
    expect(missed).toContain("run 0: <span class=\"muted\">nothing at this turn</span>");
    expect(missed).not.toContain("culprit-leak");
    // Agreements, unlabelled turns, a judge that errored and a planted variant's catch are not disagreements.
    for (const sequence of [1, 4, 7, 9]) expect((await get(server, `/turn/${sequence}`)).status).toBe(404);
    expect(missed).not.toContain("gm_clue_discipline");
  });

  it("records a relabel as pass 2 and resumes at the turn after the last one looked at", async () => {
    const dir = await finishPass1(await copyFixture());
    const { server } = await serve(dir, { phase: "pass-2" });
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
    const dir = await finishPass1(await copyFixture());
    await fs.rm(path.join(dir, "results/extra.json"));
    const { server } = await serve(dir, { phase: "pass-2" });
    expect((await get(server, "/done")).body).toContain("No turn needs a second look");
  });

  it("opens only once every turn has a label, so no judge's view steers pass 1", async () => {
    const { server } = await serve(await copyFixture(), { phase: "pass-2" });
    const refused = await get(server, "/turn/2");
    expect(refused.status).toBe(404);
    expect(refused.body).toContain("pass 2 opens once every turn of game &#34;medal&#34; has a label; 5 still have none");
    expect(refused.body).not.toMatch(/gm_|culprit-leak/);
    for (const text of JUDGE_WORDS) expect(refused.body).not.toContain(text);
  });

  it("refuses without stored results that judge the game, saying so", async () => {
    const refusal = async (dir: string) => {
      const { server } = await serve(dir, { phase: "pass-2" });
      const page = await get(server, "/turn/2");
      expect(page.status).toBe(404);
      return page.body;
    };
    expect(await refusal(await copyFixture({ withResults: false }))).toMatch(/pass 2 needs stored judge results, and none in .*results judge game &#34;medal&#34;/);
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
    expect(await refusal(dir)).toContain("pass 2 needs stored judge results");
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
    findings: [{ sequence: 4, kinds: ["spoiler"], severity: "major", judge_kind: null, quote: null, why: null, refers_to: null }],
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

  it("leaves a clean label of age fit as it is, but still names an age fault no judge caught", () => {
    const age = verdict({ judge: "age_appropriate_turn", status: "pass", findings: [{ sequence: 4, kinds: ["not_age_fit"], severity: "minor", judge_kind: null, quote: null, why: null, refers_to: null }] });
    expect(disagreementsAt("medal", clean, [age], 4)).toEqual([]);
    expect(disagreementsAt("medal", clean, [{ ...age, status: "fail", findings: [{ ...age.findings[0], severity: "major" }] }], 4)).toEqual([]);
    const ageFault = [{ ...clean[0], faults: [{ kind: "not_age_fit" as const, severity: "minor" as const, note: "too long" }] }];
    expect(disagreementsAt("medal", ageFault, [{ ...age, findings: [] }], 4)).toMatchObject([{ kind: "not_age_fit", label: "fault" }]);
  });

  it("names a labelled fault that no sample caught, only when a judge of the kind judged the turn", () => {
    expect(disagreementsAt("medal", spoiler, [verdict({ status: "pass", findings: [] })], 4)).toMatchObject([{ kind: "spoiler", label: "fault" }]);
    expect(disagreementsAt("medal", spoiler, [verdict({ status: "pass", findings: [], judge: "gm_roleplay" })], 4)).toEqual([]);
    expect(disagreementsAt("medal", spoiler, [verdict({})], 4)).toEqual([]);
  });
});

describe("what pass 2 shows of each judge", () => {
  const worded = (severity: "minor" | "major", judgeKind: string | null = "out_of_character") => ({
    sequence: 15,
    kinds: ["out_of_character"],
    severity,
    judge_kind: judgeKind,
    quote: `a ${severity} quote`,
    why: `a ${severity} reason`,
    refers_to: null,
  });
  const run = (sample: number, findings: VerdictAtTurn["findings"], judge = "gm_broad", model = "opus"): VerdictAtTurn => ({ judge, model, sample, findings });
  // Three samples of one judge on one turn: a major, then two minors (one run carrying two findings), and another judge that found nothing.
  const runs = [run(2, [worded("minor")]), run(0, [worded("major"), worded("minor")]), run(1, [worded("minor")]), run(0, [], "gm_roleplay")];
  const disagreement: Disagreement = { kind: "out_of_character", label: "clean", verdicts: runs };

  it("tallies each judge and model's runs once each, by their most severe finding, and counts a run that found nothing as judged only", () => {
    expect(tallyByJudge(runs).map(({ judge, flagged, major, minor, runs: own }) => [judge, own.length, flagged, major, minor, own.map((r) => r.sample)])).toEqual([
      ["gm_broad", 3, 3, 1, 2, [0, 1, 2]],
      ["gm_roleplay", 1, 0, 0, 0, [0]],
    ]);
  });

  it("gives one line per judge and model, then each run's severity, category in plain words, quote, why and refers_to", () => {
    const html = renderDisagreements([disagreement]);
    expect(html).toContain("<summary>gm_broad (opus): 3 of 3 runs flagged this turn: 1 major, 2 minor</summary>");
    expect(html).toContain("<summary>gm_roleplay (opus): 0 of 1 run flagged this turn</summary>");
    expect(html).toContain("out_of_character: a character or the narrator out of character");
    expect(html).toContain("<blockquote>a major quote</blockquote><p>a major reason</p>");
    expect(html.indexOf("run 0<")).toBeLessThan(html.indexOf("run 1<"));
    expect(html).toContain('run 0: <span class="muted">nothing at this turn</span>');
    // Four findings fold under their line; a judge with fewer stays open.
    expect(html).toContain('<details class="judge"><summary>gm_broad');
    expect(html).toContain('<details class="judge" open><summary>gm_roleplay');
    expect(html).not.toMatch(/\b(pass|fail)\b/);
  });

  it("says so for a finding stored without the judge's words, and names a category it has no words for as it is", () => {
    const bare = { ...worded("major", null), quote: null, why: null, refers_to: "clue-1" };
    const html = renderDisagreements([{ ...disagreement, verdicts: [run(0, [bare])] }]);
    expect(html).toContain('<details class="judge" open>');
    expect(html).toContain("the stored result keeps no reason");
    expect(html).toContain("refers to <code>clue-1</code>");
    expect(html).not.toContain("blockquote");
    expect(describeJudgeKind("gm_clue_discipline", "withheld")).toBe("withheld: an earned clue the character would not give");
    expect(describeJudgeKind("gm_fabrication", "event")).toBe("event: a happening the blueprint does not support");
    expect(describeJudgeKind("gm_spoiler", "culprit-leak")).toBe("culprit-leak");
    expect(describeJudgeKind("nobody", "voice")).toBe("voice");
    expect(describeJudgeKind("gm_spoiler", null)).toBeNull();
  });

  it("has plain words for every category each game-side judge's answer may name", () => {
    const judges: Record<string, readonly string[]> = {
      gm_roleplay: roleplaySchema.shape.findings.element.shape.kind.options,
      gm_clue_discipline: clueSchema.shape.findings.element.shape.kind.options,
      gm_fabrication: fabricationSchema.shape.findings.element.shape.kind.options,
      gm_spoiler: spoilerSchema.shape.findings.element.shape.kind.options,
      gm_broad: broadSchema.shape.findings.element.shape.kind.options,
      age_appropriate_turn: TURN_AGE_FINDING_KINDS,
    };
    for (const [judge, kinds] of Object.entries(judges)) {
      for (const kind of kinds) expect(describeJudgeKind(judge, kind), `${judge} ${kind}`).toMatch(new RegExp(`^${kind}: \\S`));
    }
  });

  it("escapes what a judge wrote", () => {
    const html = renderDisagreements([{ ...disagreement, verdicts: [run(0, [{ ...worded("minor"), quote: "<b>x</b>", why: "a & b" }])] }]);
    expect(html).toContain("<blockquote>&#60;b&#62;x&#60;/b&#62;</blockquote><p>a &#38; b</p>");
  });

  it("shows only the findings of the disagreement's kind", () => {
    const verdict = { subject: { side: "game", game: "medal", variant: null, sequence: null }, judge: "gm_broad", model: "m", sample: 0, status: "fail", duration_ms: null, cost_usd: null } as const;
    const spoiler: StoredFinding = { sequence: 4, kinds: ["spoiler"], severity: "major", judge_kind: "spoiler", quote: "q", why: "w", refers_to: null };
    const fabrication = { ...spoiler, kinds: ["fabrication"], judge_kind: "fabrication" };
    const clean = [{ sequence: 4, faults: [], by: "a", at: "2026-06-01T00:00:00Z", pass: 1 as const }];
    const found = disagreementsAt("medal", clean, [{ ...verdict, findings: [spoiler, fabrication] }], 4);
    expect(found.map((item) => [item.kind, item.verdicts[0].findings.map((finding) => finding.judge_kind)])).toEqual([
      ["spoiler", ["spoiler"]],
      ["fabrication", ["fabrication"]],
    ]);
  });
});

describe("the server's address", () => {
  const PASS_1 = phasePath("medal", "pass-1");
  const status = (server: LabelServer, host: string) =>
    new Promise<number>((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: server.port, path: `${PASS_1}/turn/1`, headers: { host } }, (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }).on("error", reject);
    });

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
    expect(await status(server, "evil.example")).toBe(403);
    expect(await status(server, `localhost:${server.port}`)).toBe(200);
    expect(await status(server, "mac.tail1.ts.net")).toBe(403);
    const foreign = await fetch(new URL(`${PASS_1}/turn/1`, server.url), { method: "POST", headers: { origin: "http://evil.example" }, body: "" });
    expect(foreign.status).toBe(403);
    const opaque = await fetch(new URL(`${PASS_1}/turn/1`, server.url), { method: "POST", headers: { origin: "null" }, body: "" });
    expect(opaque.status).toBe(403);
    const name = await fetch(new URL("/name", server.url), { method: "POST", headers: { origin: "http://evil.example" }, body: "name=evil" });
    expect(name.status).toBe(403);
    expect(await labelsOf(dir)).toHaveLength(5);
  });

  it("answers the host names it is given, as tailscale serve forwards them, and saves from their pages", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir, { hosts: ["Mac.tail1.ts.net"] });
    expect(await status(server, "mac.tail1.ts.net")).toBe(200);
    expect(await status(server, "mac.tail1.ts.net:443")).toBe(200);
    expect(await status(server, "other.tail1.ts.net")).toBe(403);
    expect(await post(server, "/turn/1", [], { origin: "https://mac.tail1.ts.net" })).toMatchObject({ status: 303, location: "/turn/2" });
    expect(await labelsOf(dir)).toHaveLength(6);
  });

  it("answers an unknown path, method, game or pass with a not-found page", async () => {
    const { server } = await serve(await copyFixture());
    expect((await get(server, "/nowhere")).status).toBe(404);
    expect((await fetch(new URL(`${PASS_1}/turn/1`, server.url), { method: "DELETE" })).status).toBe(404);
    expect((await fetch(new URL("/", server.url), { method: "DELETE" })).status).toBe(404);
    const game = await get(server, "/g/nothing/pass-1/");
    expect(game.status).toBe(404);
    expect(game.body).toContain("no stored game &#34;nothing&#34;");
    const pass = await get(server, "/g/medal/pass-3/");
    expect(pass.status).toBe(404);
    expect(pass.body).toContain("is not a pass");
    expect((await get(server, "/g/%E0%A4%A/pass-1/")).status).toBe(404);
  });
});

describe("who labels", () => {
  it("is asked of a visitor before any pass, when the server has no default, and goes back after", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir, { by: undefined });
    expect((await get(server, "/")).status).toBe(303);
    expect(await get(server, "/turn/1")).toMatchObject({ status: 303, location: `/name?back=${encodeURIComponent(phasePath("medal", "pass-1") + "/turn/1")}` });
    expect((await get(server, "/name?back=/g/medal/pass-1/turn/1")).body).toContain('value="/g/medal/pass-1/turn/1"');
    const home = await fetch(new URL("/", server.url));
    expect(await home.text()).toContain("choose your name");
    const chosen = await post(server, "/name", [["name", " Dino_H "], ["back", "/g/medal/pass-1/turn/1"]]);
    expect(chosen).toMatchObject({ status: 303, location: "/turn/1" });
    expect(chosen.cookie).toMatch(/^mystery_label_by=Dino_H; Path=\/; Max-Age=\d+; SameSite=Lax; HttpOnly$/);
    const cookie = { cookie: "other=1; mystery_label_by=Dino_H" };
    expect((await get(server, "/turn/1", cookie)).body).toContain("labelling as <b>Dino_H</b>");
    await post(server, "/turn/1", [], cookie);
    expect((await labelsOf(dir)).at(-1)).toMatchObject({ sequence: 1, by: "Dino_H" });
  });

  it("refuses a name that is not a handle, and goes back only to a path of its own", async () => {
    const { server } = await serve(await copyFixture());
    for (const name of ["", "dino@example.com", "two words", "x".repeat(40)]) {
      const refused = await post(server, "/name", [["name", name]]);
      expect(refused.status).toBe(422);
      expect(refused.body).toContain("is not a name to label as");
    }
    expect((await post(server, "/name", [["name", "dino"], ["back", "//evil.example/"]])).location).toBe("/");
    expect((await post(server, "/name", [["name", "dino"], ["back", "https://evil.example/"]])).location).toBe("/");
    expect((await post(server, "/name", [["name", "dino"], ["back", "/\\evil.example/"]])).location).toBe("/");
    expect((await post(server, "/name", [["name", "dino"]])).location).toBe("/");
    const large = await post(server, "/name", [["name", "x".repeat(70_000)]]);
    expect(large.status).toBe(422);
    expect(large.body).toContain("the form is too large");
  });

  it("takes the visitor's name over the server's default, and the default over a cookie that is not a name", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    await post(server, "/turn/1", [], { cookie: "mystery_label_by=visitor" });
    await post(server, "/turn/5", [], { cookie: "mystery_label_by=%E0%A4%A" });
    await post(server, "/turn/6", [], { cookie: "mystery_label_by=a%20b" });
    expect((await labelsOf(dir)).slice(-3).map((label) => label.by)).toEqual(["visitor", "tester", "tester"]);
  });

  it("refuses a default that is not a name", async () => {
    await expect(serve(await copyFixture(), { by: "a b" })).rejects.toThrow("is not a name to label as");
  });
});

/** The copied fixture with a second game, `medal-two`, played later and never labelled. */
async function withSecondGame(dir: string): Promise<string> {
  const trace = JSON.parse(await fs.readFile(path.join(dir, "games/medal/trace.json"), "utf8"));
  trace.session = { ...trace.session, created_at: "2026-08-15T09:00:00Z" };
  trace.source = { ...trace.source, persona: "kid-7" };
  trace.blueprint.metadata.title = "The Second Medal";
  await writeJson(path.join(dir, "games/medal-two/trace.json"), trace);
  return dir;
}

describe("the list of games", () => {
  it("shows each game's blueprint, persona, dates and stage, and opens its passes", async () => {
    const { server } = await serve(await withSecondGame(await copyFixture()));
    const home = (await get(server, "/?")).body;
    expect(home).toContain("2 of 2 games");
    expect(home).toContain("The Missing Medal &middot; age 9 &middot; played 2026-06-01 &middot; last labelled 2026-06-04 by fixture");
    expect(home).toContain("pass 1 in progress &middot; 4 of 9 turns labelled");
    expect(home).toContain("The Second Medal &middot; age 9 &middot; persona kid-7 &middot; played 2026-08-15 &middot; never labelled");
    expect(home).toContain("not started &middot; 0 of 9 turns labelled");
    expect(home).toContain('href="/g/medal/pass-1/"');
    expect(home).toContain('href="/g/medal/reported/"');
    // Pass 1 is not complete, so nothing a judge said shows, not even a way to pass 2.
    expect(home).not.toContain("/pass-2/");
    expect(home).not.toMatch(/pass 2: \d+ to answer/);
    expect(home).not.toMatch(/gm_|claude-opus-stub|culprit-leak/);
    for (const text of JUDGE_WORDS) expect(home).not.toContain(text);
    // The newer game first.
    expect(home.indexOf("medal-two")).toBeLessThan(home.indexOf("The Missing Medal"));
  });

  it("offers pass 2 once pass 1 is complete, counts what is left to answer, and finishes done", async () => {
    const dir = await copyFixture();
    const { server } = await serve(dir);
    for (const sequence of [1, 5, 6, 8, 9]) await post(server, `/turn/${sequence}`, []);
    let home = (await get(server, "/?")).body;
    expect(home).toContain('href="/g/medal/pass-2/"');
    expect(home).toContain("pass 2: 2 to answer &middot; 9 of 9 turns labelled");
    const second = `${phasePath("medal", "pass-2")}/turn`;
    await post(server, `${second}/2`, [["kind", "spoiler"], ["severity", "minor"], ["note", "the judge is right"]]);
    await post(server, `${second}/3`, [["kind", "out_of_character"], ["severity", "minor"], ["note", "still wrong"]]);
    home = (await get(server, "/?")).body;
    expect(home).toMatch(/done &middot; 9 of 9 turns labelled/);
  });

  it("says pass 1 is done when no stored result judges the game", async () => {
    const dir = await copyFixture({ withResults: false });
    const { server } = await serve(dir);
    for (const sequence of [1, 5, 6, 8, 9]) await post(server, `/turn/${sequence}`, []);
    const home = (await get(server, "/?")).body;
    expect(home).toContain("pass 1 done, no judge results for pass 2");
    expect(home).not.toContain("reported/");
  });

  it("filters by search, stage and date, and sorts", async () => {
    const { server } = await serve(await withSecondGame(await copyFixture()));
    const names = async (query: string) => [...(await get(server, `/?${query}`)).body.matchAll(/<h2 class="name">([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(await names("q=second")).toEqual(["medal-two"]);
    expect(await names("q=KID-7 medal")).toEqual(["medal-two"]);
    expect(await names("q=fixture")).toEqual(["medal"]);
    expect(await names("stage=not-started")).toEqual(["medal-two"]);
    expect(await names("stage=pass-1")).toEqual(["medal"]);
    expect(await names("stage=done")).toEqual([]);
    expect(await names("stage=todo&sort=name")).toEqual(["medal", "medal-two"]);
    expect(await names("date=played&from=2026-08-01")).toEqual(["medal-two"]);
    expect(await names("date=played&to=2026-06-30")).toEqual(["medal"]);
    expect(await names("date=labelled&from=2026-01-01")).toEqual(["medal"]);
    expect(await names("sort=played-asc")).toEqual(["medal", "medal-two"]);
    expect(await names("sort=labelled-desc")).toEqual(["medal", "medal-two"]);
    expect(await names("sort=labelled-asc")).toEqual(["medal", "medal-two"]);
    expect(await names("stage=bogus&sort=bogus&from=yesterday")).toEqual(["medal-two", "medal"]);
    const empty = (await get(server, "/?q=nothing")).body;
    expect(empty).toContain("No stored game matches.");
    expect(empty).toContain('value="nothing"');
    expect(empty).toContain("<details><summary>");
    expect((await get(server, "/?sort=name")).body).toContain("<details open><summary>");
  });
});

describe("./dev eval label", () => {
  const context = (out: string[], err: string[]) => ({ root: repoRoot(), out: (text: string) => out.push(text), err: (text: string) => err.push(text), env: {} });
  const fetchText = async (url: string) => (await fetch(url, { redirect: "follow" })).text();
  const opened = (out: string[]) => /Open (http:\/\/127\.0\.0\.1:\d+\/\S*)/.exec(out.join("\n"))?.[1] ?? "";

  it("is the ninth command, and explains its flags", async () => {
    expect(COMMANDS.map((command) => command.name)).toContain("label");
    const out: string[] = [];
    expect(await runEval(["label", "--help"], context(out, []), COMMANDS)).toBe(0);
    for (const flag of ["--pass", "--reported", "--by", "--tailscale", "--truth", "--port"]) expect(out.join("\n")).toContain(flag);
  });

  it("serves the list of games until told to stop, asking each visitor's name", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    let seen = "";
    const command = createLabelCommand(async () => {
      seen = await fetchText(opened(out));
    });
    expect(await runEval(["label", "--truth", dir], context(out, []), [command])).toBe(0);
    expect(out.join("\n")).toMatch(/^Labelling the stored games\.\nOpen http:\/\/127\.0\.0\.1:\d+\/\nCtrl-C stops it\.$/);
    expect(seen).toContain("choose your name");
    expect(seen).toContain("1 of 1 games");
  });

  it("opens the named game's pass, labelling as --by until a visitor picks a name, then closes the server", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    let seen = "";
    let url = "";
    const command = createLabelCommand(async (server) => {
      url = server.url;
      seen = await fetchText(opened(out));
    });
    expect(await runEval(["label", "medal", "--truth", dir, "--by", " Dino "], context(out, []), [command])).toBe(0);
    expect(seen).toContain("turn 1 of 9");
    expect(seen).toContain("labelling as <b>Dino</b>");
    expect(out.join("\n")).toMatch(/Labelling medal, pass 1, as Dino until a visitor picks a name\.\nOpen http:\/\/127\.0\.0\.1:\d+\/g\/medal\/pass-1\//);
    await expect(fetch(url)).rejects.toThrow();
  });

  it("opens the reported turns with --reported, and pass 2 with --pass 2", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    const seen: string[] = [];
    const command = createLabelCommand(async () => {
      seen.push(await fetchText(opened(out)));
      out.splice(0);
    });
    expect(await runEval(["label", "medal", "--truth", dir, "--by", "tester", "--reported"], context(out, []), [command])).toBe(0);
    await finishPass1(dir);
    expect(await runEval(["label", "medal", "--truth", dir, "--by", "tester", "--pass", "2"], context(out, []), [command])).toBe(0);
    // The fixture's labels already answer both reported turns.
    expect(seen[0]).toContain("medal &middot; age 9 &middot; pass 1, reported turns</h1><section><p>2 of 2 turns done in pass 1.");
    expect(seen[1]).toContain("medal &middot; age 9 &middot; pass 2 &middot; turn 1 of 2");
  });

  it("defaults to the repository's truth set, and refuses a game or a pass that is not there, with exit 1", async () => {
    const err: string[] = [];
    const command = createLabelCommand(async () => undefined);
    expect(await runEval(["label", "medal"], context([], err), [command])).toBe(1);
    expect(err.join("\n")).toMatch(/no stored game "medal" in .*evaluation\/truth \(it holds: [^)]+\)/);
    const dir = await copyFixture({ withResults: false });
    expect(await runEval(["label", "medal", "--pass", "2", "--truth", dir], context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain("pass 2 needs stored judge results");
    expect(await runEval(["label", "medal", "--reported", "--truth", dir], context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain("reported turns need stored judge results");
    expect(await runEval(["label", "medal", "--pass", "2", "--truth", await copyFixture()], context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain("pass 2 opens once every turn");
  });

  it("answers the machine's tailnet name with --tailscale, and says how to serve it there", async () => {
    const dir = await copyFixture();
    const out: string[] = [];
    let status = 0;
    const command = createLabelCommand(
      async (server) => {
        status = await new Promise<number>((resolve, reject) => {
          http.get({ host: "127.0.0.1", port: server.port, path: "/", headers: { host: "mac.tail1.ts.net" } }, (response) => {
            response.resume();
            resolve(response.statusCode ?? 0);
          }).on("error", reject);
        });
      },
      { tailscaleName: async () => "mac.tail1.ts.net" },
    );
    // A fixed port, so `tailscale serve` still reaches the server after a restart; any free one here, as the test shares its machine.
    expect(await runEval(["label", "medal", "--truth", dir, "--tailscale", "--port", "0"], context(out, []), [command])).toBe(0);
    expect(status).toBe(200);
    expect(out.join("\n")).toMatch(/On the tailnet, run `tailscale serve --bg (\d+)` once, then open https:\/\/mac\.tail1\.ts\.net\/g\/medal\/pass-1\//);
    let port = 0;
    const fixed = createLabelCommand(
      async (server) => {
        port = server.port;
      },
      { tailscaleName: async () => "mac.tail1.ts.net" },
    );
    const busy = http.createServer();
    const free = await new Promise<boolean>((resolve) => busy.once("error", () => resolve(false)).listen(TAILSCALE_PORT, "127.0.0.1", () => resolve(true)));
    if (free) await new Promise<void>((resolve) => busy.close(() => resolve()));
    if (free) {
      expect(await runEval(["label", "medal", "--truth", dir, "--tailscale"], context([], []), [fixed])).toBe(0);
      expect(port).toBe(TAILSCALE_PORT);
    }
  });

  it.each([
    [["label", "--pass", "2"], "name the game"],
    [["label", "--reported"], "name the game"],
    [["label", "a", "b"], "expected at most 1"],
    [["label", "medal", "--pass", "3"], "--pass takes 1 or 2"],
    [["label", "medal", "--port", "99999"], "--port takes a number"],
    [["label", "medal", "--port", "abc"], "--port takes a number"],
    [["label", "medal", "--by", " "], "--by needs a value"],
    [["label", "medal", "--by", "a@b.c"], "--by: \"a@b.c\" is not a name to label as"],
    [["label", "medal", "--pass", "2", "--reported"], "--reported limits pass 1"],
  ])("rejects %j as a usage error", async (argv, message) => {
    const err: string[] = [];
    const command = createLabelCommand(async () => undefined);
    expect(await runEval(argv, context([], err), [command])).toBe(1);
    expect(err.join("\n")).toContain(message);
  });
});

describe("this machine's tailnet name", () => {
  const answers = (...results: (string | Error)[]) => {
    const asked: string[] = [];
    const run = async (command: string, args: string[]) => {
      asked.push(`${command} ${args.join(" ")}`);
      const result = results.shift();
      if (result instanceof Error || result === undefined) throw result ?? new Error("no answer");
      return result;
    };
    return { asked, run };
  };

  it("is the DNS name `tailscale status --json` gives, without its last dot, trying the macOS app after the path", async () => {
    const { asked, run } = answers(new Error("spawn tailscale ENOENT"), JSON.stringify({ Self: { DNSName: "mac.tail1.ts.net." } }));
    expect(await tailscaleName(run)).toBe("mac.tail1.ts.net");
    expect(asked).toEqual(["tailscale status --json", "/Applications/Tailscale.app/Contents/MacOS/Tailscale status --json"]);
  });

  it("says why there is none", async () => {
    await expect(tailscaleName(answers(new Error("ENOENT"), new Error("ENOENT")).run)).rejects.toThrow(/could not ask Tailscale.*tailscale: ENOENT/);
    await expect(tailscaleName(answers("not json").run)).rejects.toThrow("did not answer JSON");
    await expect(tailscaleName(answers(JSON.stringify({ Self: { DNSName: "" } })).run)).rejects.toThrow("names no tailnet name");
    await expect(tailscaleName(answers(JSON.stringify({})).run)).rejects.toThrow("is it signed in?");
  });
});
