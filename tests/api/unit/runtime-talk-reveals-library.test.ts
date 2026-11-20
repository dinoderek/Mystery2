// The talk-reveals case library (`evaluation/runtime/cases/talk-reveals/`): every
// case loads and validates, names a blueprint in the repo, is graded or marked
// ungraded, and expects only clues its blueprint holds; and the whole library
// runs end to end on the stub narrator with no model.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { COMMANDS } from "../../../evaluation/commands.ts";
import { runEval } from "../../../evaluation/core/dispatch.ts";
import { readRunIndex } from "../../../evaluation/core/run-folder.ts";
import { loadCasesFrom, readBlueprint, type TurnCase } from "../../../evaluation/runtime/lib/case.ts";
import { readSummary } from "../../../evaluation/runtime/lib/expect-summary.ts";
import { validateExpect } from "../../../evaluation/runtime/lib/expect.ts";

const ROOT = process.cwd();
const LIBRARY = "evaluation/runtime/cases/talk-reveals";
const GROUPS = [
  "give-leverage-plain",
  "give-leverage-indirect",
  "give-self-protect",
  "give-ungated",
  "give-earned-before",
  "keep-held-not-used",
  "keep-topic-only",
  "bluff-narrators-call",
  "keep-past-earned",
  "keep-others-knowledge",
  "keep-gibberish",
];
const FROM_PLAY = ["play-toby-18-feather", "play-toby-19-glade-flash", "play-wanda-24-pawprints", "play-wanda-25-rack-tag"];

interface Holder {
  id: string;
  clues?: Array<{ id: string }>;
  sub_locations?: Holder[];
}

/** Every clue id a blueprint holds, on a character, a location or a place inside one. */
function clueIds(blueprint: { world: { characters: Holder[]; locations: Holder[] } }): Set<string> {
  const ids = new Set<string>();
  const visit = (holder: Holder) => {
    for (const clue of holder.clues ?? []) ids.add(clue.id);
    for (const sub of holder.sub_locations ?? []) visit(sub);
  };
  [...blueprint.world.characters, ...blueprint.world.locations].forEach(visit);
  return ids;
}

const expectedIds = (testCase: TurnCase): string[] => [
  ...(testCase.expect?.revealed_clue_ids ?? []),
  ...(testCase.expect?.used_clue_ids ?? []),
];

describe("the talk-reveals library", () => {
  it("holds about 28 distinct cases in the agreed groups, each with an expect and a group or ungraded", async () => {
    const cases = await loadCasesFrom(path.join(ROOT, LIBRARY));
    expect(cases.length).toBeGreaterThanOrEqual(24);
    expect(cases.length).toBeLessThanOrEqual(32);
    expect(new Set(cases.map((entry) => entry.id)).size).toBe(cases.length);
    for (const testCase of cases) {
      expect(testCase.action.type, testCase.id).toBe("ask");
      expect(() => validateExpect(testCase), testCase.id).not.toThrow();
      expect(testCase.expect, testCase.id).toBeDefined();
      expect(testCase.group, testCase.id).toBeTruthy();
    }
    expect([...new Set(cases.map((entry) => entry.group))].sort()).toEqual([...GROUPS].sort());
    expect(cases.filter((entry) => entry.ungraded).map((entry) => entry.group)).toEqual(["bluff-narrators-call", "bluff-narrators-call"]);
    expect(cases.filter((entry) => entry.id.startsWith("play-")).map((entry) => entry.id)).toEqual(FROM_PLAY);
  });

  it("names a blueprint that is in the repo and holds every clue it expects", async () => {
    for (const testCase of await loadCasesFrom(path.join(ROOT, LIBRARY))) {
      expect(path.isAbsolute(testCase.blueprint.path), testCase.id).toBe(false);
      const { blueprint } = await readBlueprint(testCase.blueprint.path, ROOT);
      const held = clueIds(blueprint as never);
      for (const id of expectedIds(testCase)) expect(held.has(id), `${testCase.id}: ${id}`).toBe(true);
      const character = (blueprint as never as { world: { characters: Holder[] } }).world.characters.find((entry) => entry.id === testCase.given.talk_character_id);
      expect(character, `${testCase.id}: ${testCase.given.talk_character_id}`).toBeDefined();
    }
  });

  it("stands on its own: the cut-from-play cases carry their blueprints and histories inside the library", async () => {
    for (const testCase of (await loadCasesFrom(path.join(ROOT, LIBRARY))).filter((entry) => entry.id.startsWith("play-"))) {
      expect(testCase.blueprint.path.startsWith(`${LIBRARY}/blueprints/`), testCase.id).toBe(true);
      expect(testCase.given.history?.length ?? 0, testCase.id).toBeGreaterThan(10);
    }
  });

  describe("offline", () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "mystery-talk-library-"));
    afterAll(() => fs.rmSync(scratch, { recursive: true, force: true }));

    it("runs end to end on the stub narrator and judge, grading every case without a model", async () => {
      const lines: string[] = [];
      const code = await runEval(
        ["judge", "turn", LIBRARY, "--narrator", "narrator-stub", "--judges", "flesch", "--judge-binding", "judge-stub", "--samples", "1", "--output-root", scratch],
        { root: ROOT, out: (text) => lines.push(text), err: (text) => lines.push(text), env: process.env },
        COMMANDS,
      );
      // The canned narrator reveals nothing, so graded cases fail and flesch may too (exit 2), but no sample errors (exit 1).
      expect(code, lines.join("\n")).toBe(2);
      const [day] = fs.readdirSync(scratch);
      const runDir = path.join(scratch, day, fs.readdirSync(path.join(scratch, day))[0]);
      const summary = readSummary(runDir);
      expect(summary.complete).toBe(true);
      expect(summary.narrators[0].cases.length).toBe(readRunIndex(runDir).subjects.length);
      expect(summary.narrators[0].groups.map((entry) => entry.group).sort()).toEqual(GROUPS.filter((group) => group !== "bluff-narrators-call").sort());
    }, 120_000);
  });
});
