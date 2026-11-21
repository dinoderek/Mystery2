import fs from "node:fs";

import { describe, expect, it } from "vitest";

import { findNamedHiddenSpots } from "../../../evaluation/checks/lib/hidden-spots.ts";
import { analyzeLocks } from "../../../evaluation/checks/lib/locks.ts";
import { runMechanicalChecks } from "../../../evaluation/checks/mechanical.ts";
import type { BlueprintV2 } from "../../../packages/shared/src/blueprint-schema-v2.ts";
import { validBlueprintV2 } from "./fixtures/blueprint-v2.fixture.ts";

const LOCK_CHECKS = [
  "location_locks_are_pointers",
  "pointers_point_to_target",
  "self_protect_has_parts",
  "parts_name_real_clues",
  "descriptions_hide_locked_spots",
];

/**
 * The fixture, with a mat in the hallway hiding a note gated behind the
 * kitchen crumbs, which point under the mat, and Alice keeping a false alibi
 * that the crumbs break. Every lock check passes on it; each test breaks one
 * rule.
 */
function soundBlueprint(): BlueprintV2 {
  const bp = structuredClone(validBlueprintV2) as unknown as BlueprintV2;
  const [kitchen, hallway] = bp.world.locations;
  Object.assign(kitchen.clues[0], {
    text: "Cookie crumbs lead toward the hallway, to the mat under the door.",
    hint_location_id: "hallway",
    hint_sub_location_id: "under-mat",
  });
  hallway.sub_locations = [
    {
      id: "under-mat",
      name: "under the door mat",
      hint: "A lumpy mat by the door.",
      clues: [
        {
          id: "loc-mat-note",
          text: "A note under the mat.",
          requires: {
            kind: "pointer",
            clue_ids: [kitchen.clues[0].id],
            rationale: "The crumbs lead under the mat.",
            target: { location_id: "hallway", sub_location_id: "under-mat" },
          },
        },
      ],
    },
  ];
  bp.solution_paths[0].location_clue_ids.push("loc-mat-note");
  bp.world.characters[0].agendas = [
    {
      type: "self_protect",
      strategy: "maintain_false_alibi",
      priority: "high",
      details: "Alice insists she was washing dishes.",
      parts: [{ clue_ids: [kitchen.clues[0].id], shows: "Crumbs lead from the plate.", reaction: "Says anyone could drop crumbs." }],
      confession: "She admits she took the cookies.",
      hides_steps: [],
    },
  ];
  return bp;
}

function matNoteLock(bp: BlueprintV2) {
  const lock = bp.world.locations[1].sub_locations[0].clues[0].requires;
  if (!lock) throw new Error("the mat note lost its lock");
  return lock;
}

function failing(bp: BlueprintV2): string[] {
  return runMechanicalChecks({ blueprintCandidate: bp })
    .filter((check) => check.status === "fail")
    .map((check) => check.id);
}

describe("lock, reaction and hidden-spot checks", () => {
  it("pass on a blueprint that keeps every rule", () => {
    expect(failing(soundBlueprint())).toEqual([]);
  });

  it("stay quiet on the migrated large-snow-foxes-kid-7 game", () => {
    const trace = JSON.parse(
      fs.readFileSync("evaluation/truth/games/large-snow-foxes-kid-7/trace.json", "utf8"),
    ) as { blueprint: BlueprintV2 };
    const checks = runMechanicalChecks({ blueprintCandidate: trace.blueprint });
    expect(checks.filter((check) => LOCK_CHECKS.includes(check.id)).map((check) => [check.id, check.status])).toEqual(
      LOCK_CHECKS.map((id) => [id, "pass"]),
    );
  });

  it("fail a location lock that is leverage, not a pointer", () => {
    const bp = soundBlueprint();
    matNoteLock(bp).kind = "leverage";
    expect(failing(bp)).toEqual(["location_locks_are_pointers"]);
    expect(analyzeLocks(bp).location_locks_not_pointers).toEqual([
      { clue_id: "loc-mat-note", location_id: "hallway", sub_location_id: "under-mat", kind: "leverage", problem: "not_a_pointer" },
    ]);
  });

  it("fail a locked clue at a location's top level, where no pointer can lead", () => {
    const bp = soundBlueprint();
    bp.world.locations[1].clues[0].requires = { kind: "pointer", clue_ids: ["loc-crumbs"], rationale: "Later." };
    expect(failing(bp)).toEqual(["location_locks_are_pointers"]);
    expect(analyzeLocks(bp).location_locks_not_pointers[0]).toMatchObject({ clue_id: "loc-bag", problem: "not_in_a_sub_location" });
  });

  it("fail a pointer whose prerequisites do not point to its target", () => {
    const bp = soundBlueprint();
    delete bp.world.locations[0].clues[0].hint_sub_location_id;
    expect(failing(bp)).toEqual(["pointers_point_to_target"]);
    expect(analyzeLocks(bp).pointers_off_target).toEqual([
      { clue_id: "loc-mat-note", target: { location_id: "hallway", sub_location_id: "under-mat" }, problem: "no_prerequisite_points_there" },
    ]);
  });

  it("fail a location pointer with no target, or a target elsewhere", () => {
    const noTarget = soundBlueprint();
    delete matNoteLock(noTarget).target;
    expect(analyzeLocks(noTarget).pointers_off_target).toMatchObject([{ clue_id: "loc-mat-note", problem: "no_target" }]);

    const elsewhere = soundBlueprint();
    elsewhere.world.locations[0].sub_locations.push({ id: "pantry", name: "the pantry", hint: "Shelves.", clues: [] });
    matNoteLock(elsewhere).target = { location_id: "kitchen", sub_location_id: "pantry" };
    expect(analyzeLocks(elsewhere).pointers_off_target).toMatchObject([{ clue_id: "loc-mat-note", problem: "target_is_not_its_spot" }]);
    expect(failing(elsewhere)).toEqual(["pointers_point_to_target"]);
  });

  it("fail a pointer clue whose text does not name the spot it opens, naming the clue and the spot", () => {
    const bp = soundBlueprint();
    bp.world.locations[0].clues[0].text = "Cookie crumbs lead toward the hallway.";
    expect(failing(bp)).toEqual(["pointers_point_to_target"]);
    expect(analyzeLocks(bp).pointers_off_target).toEqual([
      {
        clue_id: "loc-mat-note",
        target: { location_id: "hallway", sub_location_id: "under-mat" },
        problem: "pointer_does_not_name_spot",
        pointer_clue_id: "loc-crumbs",
      },
    ]);
  });

  it("pass a pointer clue that names its spot by the engine's matcher, plural or singular", () => {
    const bp = soundBlueprint();
    bp.world.locations[0].clues[0].text = "Crumbs trail toward the hallway and a door mats.";
    expect(failing(bp)).toEqual([]);
  });

  it("judge every prerequisite that points at the spot, not only one", () => {
    const bp = soundBlueprint();
    Object.assign(bp.world.characters[1].clues[0], {
      text: "Bob saw someone heading for the hallway.",
      hint_location_id: "hallway",
      hint_sub_location_id: "under-mat",
    });
    matNoteLock(bp).clue_ids.push(bp.world.characters[1].clues[0].id);
    expect(analyzeLocks(bp).pointers_off_target).toMatchObject([
      { clue_id: "loc-mat-note", problem: "pointer_does_not_name_spot", pointer_clue_id: bp.world.characters[1].clues[0].id },
    ]);
  });

  it("leave a character clue's pointer, which leads to the character, unchecked", () => {
    const bp = soundBlueprint();
    bp.world.characters[1].clues[0].requires = { kind: "pointer", clue_ids: ["loc-crumbs"], rationale: "Ask Bob about crumbs." };
    expect(failing(bp)).toEqual([]);
  });

  it("fail a self-protect agenda without parts, a confession or its hidden steps", () => {
    const bp = soundBlueprint();
    const agenda = bp.world.characters[0].agendas[0];
    delete agenda.parts;
    delete agenda.confession;
    delete agenda.hides_steps;
    expect(failing(bp)).toEqual(["self_protect_has_parts"]);
    expect(analyzeLocks(bp).self_protect_incomplete).toEqual([
      { character_id: "alice", agenda_index: 0, missing: ["parts", "confession", "hides_steps"] },
    ]);
  });

  it("accept an empty hides_steps: a cover that hides a motive, not a step", () => {
    const bp = soundBlueprint();
    expect(bp.world.characters[0].agendas[0].hides_steps).toEqual([]);
    expect(analyzeLocks(bp).self_protect_incomplete).toEqual([]);
  });

  it("fail a part naming a clue that does not exist, or none at all", () => {
    // The schema refuses this too, so the analysis is read on the raw candidate.
    const bp = soundBlueprint();
    const real = bp.world.locations[0].clues[0].id;
    bp.world.characters[0].agendas[0].parts = [
      { clue_ids: [real, "loc-nope"], shows: "Nothing.", reaction: "Nothing." },
      { clue_ids: [], shows: "Nothing.", reaction: "Nothing." },
    ];
    expect(analyzeLocks(bp).parts_with_unknown_clues).toEqual([
      { character_id: "alice", agenda_index: 0, clue_id: "loc-nope" },
      { character_id: "alice", agenda_index: 0, clue_id: "" },
    ]);
    expect(failing(bp)).toEqual(["blueprint_schema_valid"]);
  });

  it("fail a location description that names a spot whose clues are all locked, even by a short word", () => {
    const bp = soundBlueprint();
    bp.world.locations[1].description = "A long hallway with a muddy mat.";
    expect(failing(bp)).toEqual(["descriptions_hide_locked_spots"]);
    expect(findNamedHiddenSpots(bp)).toEqual([{ location_id: "hallway", sub_location_id: "under-mat", words: ["mat"] }]);
  });

  it("let a description name a spot once one of its clues is unlocked, or share only a place word", () => {
    const unlocked = soundBlueprint();
    unlocked.world.locations[1].description = "A hallway with a door mat.";
    delete unlocked.world.locations[1].sub_locations[0].clues[0].requires;
    expect(findNamedHiddenSpots(unlocked)).toEqual([]);

    const placeWord = soundBlueprint();
    placeWord.world.locations[1].sub_locations[0].name = "under the back stairs";
    placeWord.world.locations[1].description = "Snow blows in under the back window.";
    expect(findNamedHiddenSpots(placeWord)).toEqual([]);
  });

  it("match plural and singular words, but not the location's own name", () => {
    const bp = soundBlueprint();
    bp.world.locations[1].sub_locations[0].name = "the snowshoe hooks in the hallway";
    bp.world.locations[1].description = "A cold hallway. Snowshoes hang by the coats.";
    expect(findNamedHiddenSpots(bp)).toMatchObject([{ words: ["snowsho"] }]);
  });
});
