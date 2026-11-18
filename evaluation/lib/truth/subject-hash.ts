/**
 * A stored subject's hash: what a judge was shown, so a verdict reached on a
 * subject that has since changed is known to be stale.
 *
 * A game or one of its turns hashes the stored trace and, for a variant, its
 * plants' turns and edits; a blueprint hashes the base's blueprint and brief
 * and, for a plant, its patch. A plant's note, kind and `caught_by` describe
 * the fault and change nothing a judge reads, so they are not hashed. A turn
 * hashes as its whole game does: a plant on any turn of a variant changes the
 * history the others are judged with.
 */

import { createHash } from "node:crypto";
import fs from "node:fs";

import type { TruthSet } from "./loader.ts";
import type { StoredSubject, TurnPlant } from "./schemas.ts";

/** How many hex digits of SHA-256 a subject's hash keeps. */
const HASH_LENGTH = 16;

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, HASH_LENGTH);
}

function readJson(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function find<T extends { id: string }>(items: readonly T[], id: string, what: string): T {
  const found = items.find((item) => item.id === id);
  if (!found) throw new Error(`the truth set has no ${what} "${id}"`);
  return found;
}

/** A game's hash, or a variant's: its trace and its plants. */
export function gameHash(trace: unknown, plants: readonly Pick<TurnPlant, "sequence" | "edits">[] | null): string {
  return digest({ trace, plants: plants?.map((plant) => ({ sequence: plant.sequence, edits: plant.edits })) ?? null });
}

/** A base's hash, or a planted blueprint's: the base's blueprint and brief, and the plant's patch. */
export function blueprintHash(blueprint: unknown, brief: unknown, patch: unknown): string {
  return digest({ blueprint, brief, patch });
}

/** The hash of what a judge of `subject` is shown, as the truth set holds it now. */
export function subjectHash(set: TruthSet, subject: StoredSubject): string {
  if (subject.side === "game") {
    const game = find(set.games, subject.game, "game");
    return gameHash(game.trace, subject.variant === null ? null : find(set.turnVariants, subject.variant, "variant").plants);
  }
  const base = find(set.bases, subject.base, "base");
  const patch = subject.plant === null ? null : find(set.blueprintPlants, subject.plant, "blueprint plant").patch;
  return blueprintHash(readJson(base.blueprintFile), readJson(base.briefFile), patch);
}

/** A memo of `subjectHash` over one truth set, for reading many verdicts on few subjects. */
export function subjectHasher(set: TruthSet): (subject: StoredSubject) => string {
  const memo = new Map<string, string>();
  return (subject) => {
    const key = subject.side === "game" ? JSON.stringify(["game", subject.game, subject.variant]) : JSON.stringify(["blueprint", subject.base, subject.plant]);
    const known = memo.get(key);
    if (known !== undefined) return known;
    const hash = subjectHash(set, subject);
    memo.set(key, hash);
    return hash;
  };
}
