import { describe, expect, it } from "vitest";

import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.mjs";
import { makeEvents, makeRawTrace } from "./trace-fixtures";

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
