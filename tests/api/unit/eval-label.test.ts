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
import { disagreementsAt, reportedTurns } from "../../../evaluation/label/disagreements.ts";
import { actionForKey, applyAction, KEYED_KINDS, KIND_KEYS } from "../../../evaluation/label/keys.ts";
import type { Draft } from "../../../evaluation/label/keys.ts";
import { escapeHtml, renderTurnPage } from "../../../evaluation/label/page.ts";
import { phasePath } from "../../../evaluation/label/hub.ts";
import type { Phase } from "../../../evaluation/label/hub.ts";
import { startLabelServer } from "../../../evaluation/label/server.ts";
import type { LabelServer, LabelServerOptions } from "../../../evaluation/label/server.ts";
import { buildTurnView, formFromLabel, playedTurns } from "../../../evaluation/label/turns.ts";
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
    expect(buildTurnView(game, 2, 1, 1).clues.revealed).toMatchObject([{ id: "clue_missing", text: null, holder: null }]);
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

describe("a turn's Clues panel", () => {
  const medal = async () => structuredClone((await loadTruthSet(FIXTURE)).games[0].trace);
  const panel = (game: Awaited<ReturnType<typeof medal>>, sequence: number) => buildTurnView(game, sequence, 1, 1).clues;
  const ids = (clues: { id: string }[]) => clues.map((clue) => clue.id);

  it("lists what a search reveals, every clue of the place and its sub-places, and marks the next a search gives", async () => {
    const search = panel(await medal(), 2);
    expect(search.revealed).toEqual([
      { id: "clue_hall_1", text: "A muddy footprint near the trophy case.", holder: "Grand Hall", holderKind: "place", requires: [], requiresMet: true, pointsTo: [], held: false, next: false, offScript: false },
    ]);
    expect(search.source).toEqual({ kind: "place", name: "Grand Hall" });
    expect(search.candidates.map(({ id, holder, held, next }) => ({ id, holder, held, next }))).toEqual([
      { id: "clue_hall_1", holder: "Grand Hall", held: false, next: true },
      { id: "clue_rug_1", holder: "Grand Hall, under the rug", held: false, next: false },
    ]);
    expect(search.held).toEqual([]);
  });

  it("follows what the player held before each turn, from the reveals of the turns before it", async () => {
    const game = await medal();
    const ask = panel(game, 4);
    expect(ask.source).toEqual({ kind: "character", name: "Mara Vale" });
    expect(ask.revealed).toMatchObject([{ id: "clue_mara_1", holder: "Mara Vale", holderKind: "character", held: false }]);
    expect(ask.candidates).toMatchObject([{ id: "clue_mara_1", held: false, next: false }]);
    expect(ids(ask.held)).toEqual(["clue_hall_1"]);
    // The talk that opens it and the end_talk that closes it name the same character.
    expect(panel(game, 3).candidates).toMatchObject([{ id: "clue_mara_1", held: false }]);
    expect(panel(game, 5).candidates).toMatchObject([{ id: "clue_mara_1", held: true }]);
    // A move lists the place it enters, and only a search marks a next clue.
    const move = panel(game, 6);
    expect(move).toMatchObject({ source: { kind: "place", name: "Walled Garden" }, revealed: [] });
    expect(move.candidates).toMatchObject([{ id: "clue_garden_1", held: false, next: false }]);
    expect(panel(game, 7).candidates).toMatchObject([{ id: "clue_garden_1", next: true }]);
    expect(ids(panel(game, 7).held)).toEqual(["clue_hall_1", "clue_mara_1"]);
    expect(panel(game, 8)).toMatchObject({ source: null, candidates: [], noSource: "this accuse_start turn has no speaker or place whose clues it could reveal" });
    expect(ids(panel(game, 9).held)).toEqual(["clue_hall_1", "clue_mara_1", "clue_garden_1"]);
  });

  it("weighs requires against the clues held before the turn, skips a locked clue for the next, and names what a clue points to", async () => {
    const game = await medal();
    const world = (game.blueprint as { world: { locations: { clues: Record<string, unknown>[]; sub_locations: { clues: Record<string, unknown>[] }[] }[]; characters: { clues: Record<string, unknown>[] }[] } }).world;
    Object.assign(world.locations[0].clues[0], { requires: { clue_ids: ["clue_mara_1"], rationale: "Only once Mara points at the case." } });
    Object.assign(world.characters[0].clues[0], { about_character_id: "char_dorn", hint_location_id: "loc_garden", requires: { clue_ids: ["clue_hall_1"], rationale: "She opens up once you saw the print." } });
    Object.assign(world.locations[0].sub_locations[0].clues[0], { about_character_id: "char_ghost" });
    const search = panel(game, 2);
    expect(search.revealed).toMatchObject([{ id: "clue_hall_1", requires: ["clue_mara_1"], requiresMet: false }]);
    expect(search.candidates).toMatchObject([
      { id: "clue_hall_1", requiresMet: false, next: false },
      { id: "clue_rug_1", next: true, pointsTo: ["about char_ghost (not in the blueprint)"] },
    ]);
    expect(panel(game, 4).revealed).toMatchObject([{ id: "clue_mara_1", requires: ["clue_hall_1"], requiresMet: true, pointsTo: ["about Dorn Pike", "points to Walled Garden"], offScript: false }]);
    // A reveal the trace records off script says so beside its unmet requires.
    Object.assign(world.characters[0].clues[0], { requires: { clue_ids: ["clue_garden_1"], rationale: "Only once you saw the roses." } });
    (game.events[3].payload as Record<string, unknown>).revealed_off_script = ["clue_mara_1"];
    expect(panel(game, 4).revealed).toMatchObject([{ id: "clue_mara_1", requiresMet: false, offScript: true }]);
    const page = renderTurnPage({ game: "medal", phaseName: "pass 1", base: "", who: "tester", view: buildTurnView(game, 4, 1, 9), form: { faults: [] }, labelled: null, error: null, previous: null, next: null, disagreements: [] });
    expect(page).toContain('<span class="tag locked">requires not met</span> <span class="tag">recorded off script</span>');
  });

  it("says what the trace lacks instead of guessing a speaker or a place", async () => {
    const game = await medal();
    const payload = (sequence: number) => game.events[sequence - 1].payload as Record<string, unknown>;
    delete payload(6).location_id;
    payload(7).location_id = "loc_attic";
    delete payload(3).character_id;
    payload(4).character_id = "char_nobody";
    expect(panel(game, 6)).toMatchObject({ source: null, candidates: [], noSource: "the trace records no location_id for this move turn" });
    expect(panel(game, 7)).toMatchObject({ source: null, noSource: 'the blueprint has no location "loc_attic"' });
    expect(panel(game, 3)).toMatchObject({ source: null, noSource: "the trace records no character_id for this talk turn" });
    expect(panel(game, 4)).toMatchObject({ source: null, noSource: 'the blueprint has no character "char_nobody"' });
    // The reveal itself is still listed, with its blueprint text.
    expect(panel(game, 4).revealed).toMatchObject([{ id: "clue_mara_1", text: "Mara saw a shadow slip toward the garden." }]);
  });

  it("renders beside the narration: reveals open, a short list open, a long one and what was held folded, and says when there is nothing", async () => {
    const { server } = await serve(await copyFixture());
    const search = (await get(server, "/turn/2")).body;
    const clues = search.slice(search.indexOf('<section class="clues" id="clues">'), search.indexOf("</section>", search.indexOf('id="clues"')));
    expect(search).toMatch(/<div class="beside"><section><h2>Narration<\/h2>[\s\S]*<\/section><section class="clues" id="clues">/);
    expect(clues).toContain("<h3>This turn reveals</h3><ul><li>clue_hall_1: A muddy footprint near the trophy case.");
    expect(clues).toContain('<details class="fold" id="clues-here" open><summary><h3>Could be revealed here: Grand Hall (2, 0 held, next clue_hall_1)</h3>');
    expect(clues).toContain('<span class="tag next">next a search gives</span>');
    expect(clues).toContain("at Grand Hall, under the rug");
    expect(clues).toContain("<h3>Already held</h3><p class=\"muted\">none</p>");
    const garden = (await get(server, "/turn/7")).body;
    expect(garden).toContain('<details class="fold" id="clues-held"><summary><h3>Already held (2)</h3>');
    const accuse = (await get(server, "/turn/8")).body;
    expect(accuse).toContain("<h3>This turn reveals</h3><p class=\"muted\">none</p>");
    expect(accuse).toContain("this accuse_start turn has no speaker or place whose clues it could reveal");
    // A judge's finding never reaches it.
    expect(search).not.toContain("culprit-leak");

    const game = await medal();
    const world = (game.blueprint as { world: { locations: { clues: Record<string, unknown>[] }[]; characters: { clues: unknown[] }[] } }).world;
    world.locations[0].clues.push(...[2, 3, 4].map((n) => ({ id: `clue_hall_${n}`, text: `Hall clue ${n}.`, requires: { clue_ids: ["clue_dorn_1"], rationale: "Later." } })));
    world.characters[0].clues = [];
    const page = (sequence: number) =>
      renderTurnPage({ game: "medal", phaseName: "pass 1", base: "", who: "tester", view: buildTurnView(game, sequence, 1, 9), form: { faults: [] }, labelled: null, error: null, previous: null, next: null, disagreements: [] });
    const long = page(2);
    expect(long).toContain('<details class="fold" id="clues-here"><summary><h3>Could be revealed here: Grand Hall (5, 0 held, next clue_hall_1)</h3>');
    expect(long).toContain('<span class="tag locked">requires not met</span>');
    expect(long).toContain("requires clue_dorn_1");
    expect(page(4)).toContain("<h3>Could be revealed here: Mara Vale (0, 0 held)</h3><p class=\"muted\">the blueprint gives them no clue</p>");
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
    for (const text of ["culprit-leak", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree"]) {
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
  const finding = (sequence: number, severity = "minor") => ({ sequence, kinds: ["out_of_character"], severity, judge_kind: "voice" });
  const ageFinding = (sequence: number) => ({ sequence, kinds: ["not_age_fit"], severity: "minor", judge_kind: null });
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
    for (const text of ["culprit-leak", "voice", "gm_spoiler", "gm_roleplay", "gm_fabrication", "claude-opus-stub", "Where a judge and the label disagree"]) {
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
          findings: [{ sequence: 5, kinds: ["out_of_character"], severity: "minor", judge_kind: "voice" }],
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
    const missed = (await get(server, "/turn/3")).body;
    expect(missed).toContain("labelled <b>out_of_character</b>, no judge caught it");
    expect(missed).toContain("gm_roleplay");
    expect(missed).toContain("nothing at this turn");
    expect(missed).not.toContain("culprit-leak");
    // Agreements, unlabelled turns, a judge that errored and a planted variant's catch are not disagreements.
    for (const sequence of [1, 4, 7, 9]) expect((await get(server, `/turn/${sequence}`)).status).toBe(404);
    expect(missed).not.toContain("gm_clue_discipline");
    // The Clues panel is built from the trace alone, so pass 2 shows it as pass 1 does.
    expect(caught).toContain('<section class="clues" id="clues">');
    expect(caught).toContain("clue_hall_1: A muddy footprint near the trophy case.");
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

  it("leaves a clean label of age fit as it is, but still names an age fault no judge caught", () => {
    const age = verdict({ judge: "age_appropriate_turn", status: "pass", findings: [{ sequence: 4, kinds: ["not_age_fit"], severity: "minor", judge_kind: null }] });
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
