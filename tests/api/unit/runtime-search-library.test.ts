import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";
import { loadCasesFrom, readBlueprint, type TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { searchCase } from "../../../evaluation/runtime/lib/search-case.ts";

// The search library is data, so these tests hold it to what it claims: every
// case loads, names a blueprint in the repo, and states a situation the
// blueprint can produce. No model runs.

const LIBRARY = "evaluation/runtime/cases/search-reveals";
const ROOT = path.resolve(".");

interface Spot {
  id: string;
  name: string;
  clues: Array<{ id: string; requires?: { clue_ids: string[] } }>;
}
interface Place extends Spot {
  sub_locations?: Spot[];
}

async function placeFor(testCase: TurnCase): Promise<Place> {
  const { blueprint } = await readBlueprint(testCase.blueprint.path, ROOT);
  const locations = blueprint.world.locations as unknown as Place[];
  const place = locations.find((l) => l.id === testCase.given.location_id);
  if (!place) throw new Error(`${testCase.id}: no location ${testCase.given.location_id}`);
  return place;
}

function cluesAt(place: Place) {
  return [...place.clues, ...(place.sub_locations ?? []).flatMap((s) => s.clues)];
}

let cases: TurnCase[] = [];
beforeAll(async () => {
  cases = await loadCasesFrom(LIBRARY);
});

describe("the search-reveals library", () => {
  it("holds about two dozen cases, with unique ids, each with a group and an expectation", () => {
    expect(cases.length).toBeGreaterThanOrEqual(22);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.action.type, c.id).toBe("search");
      expect(c.action.search_query, c.id).toBeTruthy();
      expect(c.group, c.id).toBeTruthy();
      expect(c.expect, c.id).toBeDefined();
      expect(c.expect?.revealed_clue_id, c.id).not.toBeUndefined();
    }
  });

  it("covers every group of the brief, reveal and not", () => {
    const groups = new Set(cases.map((c) => c.group));
    for (const group of [
      "reveal-exact", "reveal-loose", "reveal-inventive", "reveal-evidence", "reveal-unlocked",
      "not-already-revealed", "not-neighbour", "not-hidden-vague", "not-vague-search", "not-gibberish",
    ]) {
      expect(groups, group).toContain(group);
    }
  });

  it("names a blueprint that exists in the repo", async () => {
    for (const c of cases) {
      expect(fs.existsSync(path.resolve(c.blueprint.path)), c.id).toBe(true);
      expect(path.isAbsolute(c.blueprint.path), c.id).toBe(false);
      await readBlueprint(c.blueprint.path, ROOT);
    }
  });

  it("expects a clue only where the blueprint puts it, unlocked by what the player holds", async () => {
    for (const c of cases.filter((x) => x.expect?.revealed_clue_id)) {
      const place = await placeFor(c);
      const clue = cluesAt(place).find((k) => k.id === c.expect?.revealed_clue_id);
      expect(clue, `${c.id}: ${c.expect?.revealed_clue_id} is not at ${place.id}`).toBeDefined();
      const held = new Set(c.given.discovered_clues ?? []);
      expect(held.has(clue!.id), `${c.id}: the clue is already found`).toBe(false);
      for (const pointer of clue?.requires?.clue_ids ?? []) {
        expect(held.has(pointer), `${c.id}: ${pointer} is not found`).toBe(true);
      }
    }
  });

  it("expects nothing only when no unlocked, unfound clue sits where the query points", async () => {
    for (const c of cases.filter((x) => x.expect?.revealed_clue_id === null)) {
      const place = await placeFor(c);
      const held = new Set(c.given.discovered_clues ?? []);
      const spot = (place.sub_locations ?? []).find((s) => c.action.search_query!.includes(s.name));
      // A spot the query names must hold nothing to find: its clues are found, or locked.
      for (const clue of spot?.clues ?? []) {
        const unlocked = (clue.requires?.clue_ids ?? []).every((id) => held.has(id));
        expect(held.has(clue.id) || !unlocked, `${c.id}: ${clue.id} could be revealed`).toBe(true);
      }
    }
  });

  it("states what already-revealed and hidden-spot cases hold", async () => {
    for (const c of cases.filter((x) => x.group === "not-already-revealed")) {
      const place = await placeFor(c);
      const named = (place.sub_locations ?? []).find((s) => c.action.search_query!.includes(s.name));
      expect(named, c.id).toBeDefined();
      for (const clue of named!.clues) expect(c.given.revealed_clue_ids, c.id).toContain(clue.id);
    }
    for (const c of cases.filter((x) => x.group === "not-hidden-vague")) {
      const place = await placeFor(c);
      const hidden = (place.sub_locations ?? []).filter((s) => s.clues.length && s.clues.every((k) => k.requires));
      expect(hidden.length, c.id).toBeGreaterThan(0);
      for (const clue of hidden.flatMap((s) => s.clues)) {
        for (const pointer of clue.requires!.clue_ids) expect(c.given.discovered_clues, c.id).not.toContain(pointer);
      }
    }
    for (const c of cases.filter((x) => x.group === "not-gibberish")) {
      expect(c.expect?.input_understood, c.id).toBe(false);
    }
  });

  it("keeps the two cuts from play: the player's own query, with the pointer already found", async () => {
    const played = new Map([
      ["lucia-heartwood-under-the-tower", ["under the lifeguard tower", "clue_buried_heartwood", "clue_footprint_trail"]],
      ["midnight-express-under-the-tarpaulin", ["under the parcel trolley tarpaulin", "trolley_hatbox", "wally_echo"]],
    ]);
    for (const [id, [query, clue, pointer]] of played) {
      const c = cases.find((x) => x.id === id);
      expect(c, id).toBeDefined();
      expect(c!.action.search_query).toBe(query);
      expect(c!.expect?.revealed_clue_id).toBe(clue);
      expect(c!.given.discovered_clues).toContain(pointer);
      expect(c!.given.history!.length).toBeGreaterThan(8);
      expect(c!.given.history!.at(-1)?.event_type).toBe("move");
    }
  });
});

describe("the stored baselines", () => {
  it.each(["haiku", "sonnet"])("hold a complete %s run of every case, five samples each", (model) => {
    const summary = readSummary(`${LIBRARY}/baselines/${model}.json`);
    expect(summary.complete).toBe(true);
    const [narrator] = summary.narrators;
    expect(summary.narrators).toHaveLength(1);
    expect(narrator.narrator).toBe("narrator-claude");
    expect(narrator.model).toContain(model);
    expect(narrator.samples_per_case).toBe(5);
    expect(narrator.cases.map((c) => c.id).sort()).toEqual(cases.map((c) => c.id).sort());
    for (const entry of narrator.cases) expect(entry.graded, entry.id).toBe(5);
  });
});

describe("the library on the stub narrator", () => {
  let scratch = "";
  afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

  it("loads, replays and grades every case without a model", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-search-library-"));
    const lines: string[] = [];
    const code = await runEval(
      [
        "judge", "turn", LIBRARY, "--narrator", "narrator-stub", "--judges", "flesch", "--samples", "1",
        "--config", "evaluation/config.example.json", "--output-root", scratch,
      ],
      { root: ROOT, out: (t) => lines.push(t), err: (t) => lines.push(t), env: process.env },
      COMMANDS,
    );
    // The stub finds nothing, so a case expecting a clue is wrong (exit 2), but every one was graded.
    expect(code, lines.join("\n")).toBe(2);
    const [day] = fs.readdirSync(scratch);
    const [run] = fs.readdirSync(path.join(scratch, day));
    const [narrator] = readSummary(path.join(scratch, day, run)).narrators;
    expect(narrator.cases).toHaveLength(cases.length);
    const expectsNothing = new Set(cases.filter((c) => c.expect?.revealed_clue_id === null).map((c) => c.id));
    for (const entry of narrator.cases) {
      expect(entry.incomplete, entry.id).toBe(0);
      expect(entry.right, entry.id).toBe(expectsNothing.has(entry.id) && !entry.id.startsWith("gibberish") ? 1 : 0);
    }
  });
});

describe("searchCase", () => {
  const glitterwood = "evaluation/truth/bases/glitterwood-forest/blueprint.json";

  it("leaves a history that matches what the player holds, ending where they stand", () => {
    const c = searchCase({
      id: "t",
      group: "g",
      blueprint: glitterwood,
      location: "moonglow_pond",
      query: "under the weeping willow",
      found: ["clue_fake_stick", "clue_barnaby_twigs", "clue_ruby_list"],
      expect: { revealed_clue_id: "clue_twig_pile" },
    });
    expect(c.given.discovered_clues).toEqual(["clue_fake_stick", "clue_barnaby_twigs", "clue_ruby_list"]);
    // Only a clue found at the searched location counts as revealed there.
    expect(c.given.revealed_clue_ids).toEqual(["clue_ruby_list"]);
    const events = c.given.history!.map((h) => h.event_type);
    expect(events[0]).toBe("start");
    expect(events).toContain("ask");
    expect(c.given.history!.at(-1)).toMatchObject({ event_type: "search", payload: { location_id: "moonglow_pond" } });
  });

  it("refuses a clue or a location its blueprint lacks", () => {
    const base = { id: "t", group: "g", blueprint: glitterwood, expect: { revealed_clue_id: null } };
    expect(() => searchCase({ ...base, location: "nowhere", query: "q" })).toThrow(/no location nowhere/);
    expect(() => searchCase({ ...base, location: "dungeon", query: "q", found: ["clue_missing"] })).toThrow(
      /no clue clue_missing/,
    );
  });
});
