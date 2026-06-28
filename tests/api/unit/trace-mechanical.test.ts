import { describe, expect, it } from "vitest";

import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.mjs";
import {
  makeBlueprint,
  makeEvents,
  makeMultiStepEvents,
  makeRawTrace,
  type TraceEventRow,
} from "./trace-fixtures";

type Violation = { reason?: string; sequence?: number; character_id?: string };
type MechCheck = {
  id: string;
  status: string;
  details: { violations?: Violation[]; min_run?: number } | null;
};

function checkById(checks: MechCheck[], id: string): MechCheck {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no mechanical check "${id}"`);
  return found;
}

describe("clue_accounting", () => {
  it("passes a rule-abiding trace", () => {
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace() });
    expect(checkById(checks, "clue_accounting").status).toBe("pass");
  });

  it("does not false-fail a second search in the same location (cumulative revealed_clue_ids is not a re-reveal)", () => {
    // The real runtime persists revealed_clue_ids as the cumulative location
    // list; only revealed_clue_id is the per-turn find. A correct check reads
    // the per-turn find, so the second search (clue_rug_1) passes even though
    // its cumulative list still contains the earlier clue_hall_1.
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events: makeMultiStepEvents() }) });
    expect(checkById(checks, "clue_accounting").status).toBe("pass");
  });

  it("flags a search revealing a clue from another location", () => {
    const events = makeEvents();
    events[1].payload.revealed_clue_id = "clue_garden_1"; // hall search reveals a garden clue
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) });
    const acc = checkById(checks, "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.[0]).toMatchObject({ sequence: 2, reason: "clue_not_in_location" });
  });

  it("flags an ask revealing a clue that is not the character's", () => {
    const events = makeEvents();
    events[3].payload.revealed_clue_ids = ["clue_dorn_1"]; // Mara reveals Dorn's clue
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) });
    const acc = checkById(checks, "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.[0]).toMatchObject({ sequence: 4, reason: "clue_not_for_character" });
  });

  it("does not flag bare search for skipping a locked location clue", () => {
    // loc_hall has a locked clue at index 0 (gated behind clue_garden_1) and an
    // open clue at index 1. Bare search reveals the open one first — the runtime
    // skips the locked clue, so this must NOT read as out-of-order.
    const bp = makeBlueprint();
    const gated = {
      id: "clue_hall_locked",
      text: "A locked drawer.",
      requires: { clue_ids: ["clue_garden_1"], rationale: "needs the garden lead" },
    };
    const blueprint = {
      ...bp,
      world: {
        ...bp.world,
        locations: bp.world.locations.map((l) =>
          l.id === "loc_hall"
            ? { ...l, clues: [gated, { id: "clue_hall_open", text: "An open ledger." }] }
            : l,
        ),
      },
    };
    const events: TraceEventRow[] = [
      {
        id: "b1", sequence: 1, event_type: "search", actor: "system",
        payload: { location_id: "loc_hall", revealed_clue_id: "clue_hall_open", revealed_clue_ids: ["clue_hall_open"] },
        narration: "An open ledger.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z",
      },
    ];
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ blueprint, events }) });
    expect(checkById(checks, "clue_accounting").status).toBe("pass");
  });

  it("flags a re-revealed clue", () => {
    const events = makeEvents();
    // A second hall search re-reveals the already-found hall clue (same scope).
    events[6].payload = { location_id: "loc_hall", revealed_clue_id: "clue_hall_1" };
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) });
    const acc = checkById(checks, "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(
      Boolean(acc.details?.violations?.some((v) => v.reason === "clue_revealed_again")),
    ).toBe(true);
  });
});

describe("spoiler_leak", () => {
  it("passes when no pre-accusation narration copies ground truth", () => {
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace() });
    expect(checkById(checks, "spoiler_leak").status).toBe("pass");
  });

  it("flags a pre-accusation narration that copies a long ground-truth run", () => {
    const events = makeEvents();
    // Move narration verbatim-copies the ground-truth what_happened sentence.
    events[5].narration = "As you walk you realize: Dorn slipped into the hall and took the medal while everyone was at dinner.";
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) });
    const leak = checkById(checks, "spoiler_leak");
    expect(leak.status).toBe("fail");
    expect(leak.details?.violations?.[0]).toMatchObject({ sequence: 6 });
  });

  it("does not flag the accusation resolution that legitimately reveals the truth", () => {
    // The fixture's seq-9 accuse_resolved narration copies what_happened, but
    // accusation events are exempt.
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace() });
    expect(checkById(checks, "spoiler_leak").status).toBe("pass");
  });
});

describe("clue_requires_violation", () => {
  // Gate Dorn's glove clue behind the hall footprint.
  function gatedBlueprint() {
    const bp = makeBlueprint();
    return {
      ...bp,
      world: {
        ...bp.world,
        characters: bp.world.characters.map((c) =>
          c.id === "char_dorn"
            ? {
                ...c,
                clues: c.clues.map((clue) => ({
                  ...clue,
                  requires: {
                    clue_ids: ["clue_hall_1"],
                    rationale: "Dorn only admits the glove is his once you show the footprint.",
                  },
                })),
              }
            : c,
        ),
      },
    };
  }

  const talkDorn = (seq: number): TraceEventRow => ({
    id: `t${seq}`, sequence: seq, event_type: "talk", actor: "system",
    payload: { character_id: "char_dorn", location_id: "loc_garden" },
    narration: "Dorn glares.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z",
  });
  const askDorn = (seq: number, extra: Record<string, unknown> = {}): TraceEventRow => ({
    id: `a${seq}`, sequence: seq, event_type: "ask", actor: "char_dorn",
    payload: { character_id: "char_dorn", player_input: "Whose glove?", revealed_clue_ids: ["clue_dorn_1"], ...extra },
    narration: "\"Fine, it's mine.\"", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:01:00Z",
  });
  const searchHall = (seq: number): TraceEventRow => ({
    id: `s${seq}`, sequence: seq, event_type: "search", actor: "system",
    payload: { location_id: "loc_hall", revealed_clue_id: "clue_hall_1", revealed_clue_ids: ["clue_hall_1"] },
    narration: "A muddy footprint.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z",
  });

  it("is absent unless enforce_requires is set", () => {
    const checks = runTraceMechanicalChecks({
      rawTrace: makeRawTrace({ blueprint: gatedBlueprint(), events: [talkDorn(1), askDorn(2)] }),
    });
    expect(checks.find((c: { id: string }) => c.id === "clue_requires_violation")).toBeUndefined();
  });

  it("flags a gated clue revealed before its prerequisite", () => {
    const checks = runTraceMechanicalChecks({
      rawTrace: makeRawTrace({ blueprint: gatedBlueprint(), events: [talkDorn(1), askDorn(2)] }),
      context: { enforce_requires: true },
    });
    const check = checkById(checks, "clue_requires_violation");
    expect(check.status).toBe("fail");
    expect(check.details?.violations?.[0]).toMatchObject({ sequence: 2, clue_id: "clue_dorn_1" });
  });

  it("passes when the prerequisite was revealed earlier", () => {
    const checks = runTraceMechanicalChecks({
      rawTrace: makeRawTrace({ blueprint: gatedBlueprint(), events: [searchHall(1), talkDorn(2), askDorn(3)] }),
      context: { enforce_requires: true },
    });
    expect(checkById(checks, "clue_requires_violation").status).toBe("pass");
  });

  it("exempts an off-script brilliance grant", () => {
    const checks = runTraceMechanicalChecks({
      rawTrace: makeRawTrace({
        blueprint: gatedBlueprint(),
        events: [talkDorn(1), askDorn(2, { revealed_off_script: ["clue_dorn_1"] })],
      }),
      context: { enforce_requires: true },
    });
    expect(checkById(checks, "clue_requires_violation").status).toBe("pass");
  });
});
