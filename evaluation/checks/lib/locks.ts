// Deterministic facts about why locks exist and what breaks a cover story.
//
// A location clue is found by searching, so its lock can only be a pointer:
// it sits in a sub-location, its `requires.target` names that spot, and a
// prerequisite points there through `hint_location_id` and
// `hint_sub_location_id`. A self-protect agenda lists the clues that break it
// as `parts`, says what the character finally admits as `confession`, and
// names the steps of their day the cover hides as `hides_steps`.
//
// The schema refuses unknown ids a blueprint names, and the mechanical checks
// run only on a blueprint that parses, so `parts_name_real_clues` is a backstop
// that never fails there: no plant should expect it to. The other rules are
// checks, not schema, so a blueprint that breaks one still parses and is caught.
// These helpers read a candidate that need not be well formed.

interface LockClue {
  id: string;
  hint_location_id?: string;
  hint_sub_location_id?: string;
  requires?: {
    kind?: string;
    clue_ids?: string[];
    target?: { location_id?: string; sub_location_id?: string } | null;
  } | null;
}

interface LockAgenda {
  type?: string;
  parts?: Array<{ clue_ids?: string[] | null }> | null;
  confession?: string | null;
  hides_steps?: number[] | null;
}

/** The fields read below, all optional: a candidate blueprint need not be well formed. */
export interface LocksBlueprint {
  world?: {
    locations?: Array<{
      id: string;
      clues?: LockClue[];
      sub_locations?: Array<{ id: string; clues?: LockClue[] }>;
    }>;
    characters?: Array<{ id: string; clues?: LockClue[]; agendas?: LockAgenda[] }>;
  };
}

/** A location clue's lock that is not a pointer, or that sits where no pointer can lead. */
export interface LocationLockFault {
  clue_id: string;
  location_id: string;
  sub_location_id: string | null;
  kind: string | null;
  problem: "not_a_pointer" | "not_in_a_sub_location";
}

/** A pointer that names no target, the wrong target, or one no prerequisite points to. */
export interface PointerFault {
  clue_id: string;
  target: { location_id: string; sub_location_id: string } | null;
  problem: "no_target" | "target_is_not_its_spot" | "no_prerequisite_points_there";
}

export interface SelfProtectFault {
  character_id: string;
  agenda_index: number;
  missing: Array<"parts" | "confession" | "hides_steps">;
}

export interface PartFault {
  character_id: string;
  agenda_index: number;
  clue_id: string;
}

export interface LocksAnalysis {
  location_locks_not_pointers: LocationLockFault[];
  pointers_off_target: PointerFault[];
  self_protect_incomplete: SelfProtectFault[];
  parts_with_unknown_clues: PartFault[];
}

interface PlacedClue {
  clue: LockClue;
  spot: { location_id: string; sub_location_id: string | null } | null;
}

function placedClues(blueprint: LocksBlueprint | null | undefined): PlacedClue[] {
  const placed: PlacedClue[] = [];
  for (const location of blueprint?.world?.locations ?? []) {
    for (const clue of location.clues ?? []) {
      placed.push({ clue, spot: { location_id: location.id, sub_location_id: null } });
    }
    for (const sub of location.sub_locations ?? []) {
      for (const clue of sub.clues ?? []) {
        placed.push({ clue, spot: { location_id: location.id, sub_location_id: sub.id } });
      }
    }
  }
  for (const character of blueprint?.world?.characters ?? []) {
    for (const clue of character.clues ?? []) placed.push({ clue, spot: null });
  }
  return placed;
}

function pointsAt(clue: LockClue | undefined, locationId: string, subLocationId: string): boolean {
  return clue?.hint_location_id === locationId && clue?.hint_sub_location_id === subLocationId;
}

/** What is wrong with one clue's lock, if anything. */
function lockFault(
  { clue, spot }: PlacedClue,
  byId: ReadonlyMap<string, LockClue>,
): { location?: LocationLockFault; pointer?: PointerFault } {
  const lock = clue.requires;
  if (!lock) return {};
  const kind = lock.kind ?? null;
  if (spot && spot.sub_location_id === null) {
    return { location: { clue_id: clue.id, ...spot, kind, problem: "not_in_a_sub_location" } };
  }
  if (spot && kind !== "pointer") {
    return { location: { clue_id: clue.id, ...spot, kind, problem: "not_a_pointer" } };
  }
  // A character clue's pointer leads to the character, so only a target it names is checked.
  if (kind !== "pointer" || (!spot && !lock.target)) return {};
  const target = lock.target?.location_id && lock.target.sub_location_id
    ? { location_id: lock.target.location_id, sub_location_id: lock.target.sub_location_id }
    : null;
  if (!target) return { pointer: { clue_id: clue.id, target: null, problem: "no_target" } };
  if (spot && (spot.location_id !== target.location_id || spot.sub_location_id !== target.sub_location_id)) {
    return { pointer: { clue_id: clue.id, target, problem: "target_is_not_its_spot" } };
  }
  const pointed = (lock.clue_ids ?? []).some((id) => pointsAt(byId.get(id), target.location_id, target.sub_location_id));
  return pointed ? {} : { pointer: { clue_id: clue.id, target, problem: "no_prerequisite_points_there" } };
}

/** The part clue ids that name no clue; a part with no clue at all names "". */
function unknownPartClues(agenda: LockAgenda, clueIds: ReadonlySet<string>): string[] {
  return (agenda.parts ?? []).flatMap((part) => {
    const ids = part.clue_ids ?? [];
    return ids.length === 0 ? [""] : ids.filter((id) => !id || !clueIds.has(id)).map((id) => id ?? "");
  });
}

/** Self-protect agendas missing a part list, confession or hidden steps, and parts naming no clue. */
function agendaFaults(
  blueprint: LocksBlueprint | null | undefined,
  clueIds: ReadonlySet<string>,
): Pick<LocksAnalysis, "self_protect_incomplete" | "parts_with_unknown_clues"> {
  const incomplete: SelfProtectFault[] = [];
  const unknown: PartFault[] = [];
  for (const character of blueprint?.world?.characters ?? []) {
    for (const [agendaIndex, agenda] of (character.agendas ?? []).entries()) {
      const at = { character_id: character.id, agenda_index: agendaIndex };
      unknown.push(...unknownPartClues(agenda, clueIds).map((clue_id) => ({ ...at, clue_id })));
      if (agenda.type !== "self_protect") continue;
      const missing: SelfProtectFault["missing"] = [];
      if ((agenda.parts ?? []).length === 0) missing.push("parts");
      if (!agenda.confession?.trim()) missing.push("confession");
      // An empty list is a decision (the cover hides a motive, not a step); absent is not.
      if (!Array.isArray(agenda.hides_steps)) missing.push("hides_steps");
      if (missing.length > 0) incomplete.push({ ...at, missing });
    }
  }
  return { self_protect_incomplete: incomplete, parts_with_unknown_clues: unknown };
}

export function analyzeLocks(blueprint: LocksBlueprint | null | undefined): LocksAnalysis {
  const placed = placedClues(blueprint);
  const byId = new Map(placed.map(({ clue }) => [clue.id, clue]));
  const faults = placed.map((entry) => lockFault(entry, byId));
  return {
    location_locks_not_pointers: faults.flatMap((fault) => (fault.location ? [fault.location] : [])),
    pointers_off_target: faults.flatMap((fault) => (fault.pointer ? [fault.pointer] : [])),
    ...agendaFaults(blueprint, new Set(byId.keys())),
  };
}
