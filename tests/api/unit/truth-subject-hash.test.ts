// A stored subject's hash: what a judge was shown, so a verdict on a subject
// changed since is known to be stale.

import path from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import { repoRoot } from "../../../evaluation/core/judge-loader.ts";
import { loadTruthSet } from "../../../evaluation/lib/truth/loader.ts";
import type { TruthSet } from "../../../evaluation/lib/truth/loader.ts";
import { subjectHash, subjectHasher } from "../../../evaluation/lib/truth/subject-hash.ts";

const FIXTURE = path.join(repoRoot(), "tests/api/unit/fixtures/truth");

let set: TruthSet;
beforeAll(async () => {
  set = await loadTruthSet(FIXTURE);
});

const MEDAL = { side: "game", game: "medal", variant: null, sequence: null } as const;
const SPOILER = { side: "game", game: "medal", variant: "medal-spoiler", sequence: null } as const;
const MOCK = { side: "blueprint", base: "mock", plant: null } as const;
const PLANT = { side: "blueprint", base: "mock", plant: "mock-bob-not-ruled-out" } as const;

/** The set with the variant's first plant changed by `change`. */
function withPlant(change: (plant: TruthSet["turnVariants"][number]["plants"][number]) => object): TruthSet {
  const variants = set.turnVariants.map((variant) =>
    variant.id === "medal-spoiler" ? { ...variant, plants: [{ ...variant.plants[0], ...change(variant.plants[0]) }, ...variant.plants.slice(1)] } : variant,
  );
  return { ...set, turnVariants: variants };
}

describe("a subject's hash", () => {
  it("tells a game from its variant, and a base from its plant, and is 16 hex digits", () => {
    const hashes = [MEDAL, SPOILER, MOCK, PLANT].map((subject) => subjectHash(set, subject));
    expect(new Set(hashes).size).toBe(4);
    for (const hash of hashes) expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is a turn's whole game: every turn of a game hashes as the game does", () => {
    expect(subjectHash(set, { ...SPOILER, sequence: 4 })).toBe(subjectHash(set, SPOILER));
    expect(subjectHash(set, { ...MEDAL, sequence: 2 })).toBe(subjectHash(set, MEDAL));
  });

  it("changes with a plant's edits, never with its note or what caught it", () => {
    const hash = subjectHash(set, SPOILER);
    expect(subjectHash(withPlant(() => ({ note: "Reworded.", caught_by: ["flesch"] })), SPOILER)).toBe(hash);
    expect(subjectHash(withPlant((plant) => ({ edits: [{ ...plant.edits[0], replace: `${(plant.edits[0] as { replace: string }).replace} He grins.` }] })), SPOILER)).not.toBe(hash);
    expect(subjectHash(withPlant(() => ({ note: "Reworded." })), MEDAL)).toBe(subjectHash(set, MEDAL));
  });

  it("names a subject the set does not have", () => {
    expect(() => subjectHash(set, { ...MEDAL, game: "chess" })).toThrow('the truth set has no game "chess"');
    expect(() => subjectHash(set, { ...MOCK, plant: "nothing" })).toThrow('the truth set has no blueprint plant "nothing"');
  });

  it("is memoised per game or blueprint by subjectHasher, giving the same hashes", () => {
    const hash = subjectHasher(set);
    expect(hash({ ...SPOILER, sequence: 4 })).toBe(subjectHash(set, SPOILER));
    expect(hash(PLANT)).toBe(subjectHash(set, PLANT));
    expect(hash(PLANT)).toBe(subjectHash(set, PLANT));
  });
});
