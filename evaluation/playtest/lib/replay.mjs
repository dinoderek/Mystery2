// Replaying a recorded game's inputs, and noticing when the game has moved on.
//
// Every input in a script.json is saved with a checkpoint: where the game stood
// just before it was typed. A replay compares each checkpoint with the live
// game before typing its input. When the mode, the place, the person being
// talked to or the people in the room differ, the input no longer means what
// it meant (the character to talk to may not be here), so the replay stops
// there and records what differed. Found clues can differ without changing
// what an input means (a narrator reveals in a different turn); the first such
// difference is recorded, and the replay carries on.

import fs from "node:fs";

import { buildPlacesView } from "../../../web/src/lib/domain/notebook.ts";
import { normalizeState } from "./view.mjs";

// The fields that decide what an input does.
const BLOCKING_FIELDS = ["mode", "location", "talk_character", "people_here"];

/** Where the game stands, in the terms a replay compares. */
export function checkpointOf(state) {
  const normalized = normalizeState(state);
  const here = buildPlacesView(normalized).find((place) => place.isCurrent);
  return {
    mode: normalized.mode,
    location: normalized.location,
    talk_character: normalized.current_talk_character ?? null,
    people_here: [...(here?.people ?? [])].sort(),
    clues: normalized.discovered_clues.map((clue) => clue.id).sort(),
  };
}

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * The fields that differ between two checkpoints, split into `blocking`
 * (the replay must stop) and `clues`. Each is null when nothing differs.
 */
export function compareCheckpoints(expected, actual) {
  const differing = BLOCKING_FIELDS.filter((field) => !same(expected[field], actual[field]));
  return {
    blocking: differing.length > 0
      ? Object.fromEntries(
        differing.map((field) => [field, { expected: expected[field], actual: actual[field] }]),
      )
      : null,
    clues: same(expected.clues ?? [], actual.clues)
      ? null
      : { expected: expected.clues ?? [], actual: actual.clues },
  };
}

/**
 * Reads a script.json. `checkpoints` is null for a script saved before
 * checkpoints existed; such a script replays without divergence checks.
 */
export function loadScript(file) {
  const script = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(script.inputs) || script.inputs.some((input) => typeof input !== "string")) {
    throw new Error(`${file}: "inputs" must be a list of strings`);
  }
  if (!script.blueprint_id) throw new Error(`${file}: no "blueprint_id"`);
  const checkpoints = Array.isArray(script.checkpoints) ? script.checkpoints : null;
  if (checkpoints && checkpoints.length !== script.inputs.length) {
    throw new Error(
      `${file}: ${script.inputs.length} inputs but ${checkpoints.length} checkpoints`,
    );
  }
  return {
    blueprintId: script.blueprint_id,
    persona: script.persona ?? "unknown",
    inputs: script.inputs,
    checkpoints,
  };
}
