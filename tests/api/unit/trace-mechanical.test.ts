import { describe, expect, it } from "vitest";

import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import {
  makeBlueprint,
  makeEvents,
  makeMultiStepEvents,
  makeRawTrace,
  type TraceEventRow,
} from "./trace-fixtures";

type Violation = { reason?: string; sequence?: number; clue_id?: string };
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

describe("the check list", () => {
  it("is clue_accounting and spoiler_leak, and nothing that reads a V2 `requires` lock", () => {
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace(), context: { enforce_requires: true } });
    expect(checks.map((check) => check.id)).toEqual(["clue_accounting", "spoiler_leak"]);
  });

  it("refuses a trace whose blueprint is not a clue graph, by name", () => {
    const v2 = { ...makeBlueprint(), clue_graph: undefined };
    expect(() => runTraceMechanicalChecks({ rawTrace: makeRawTrace({ blueprint: { ...v2, id: "the-missing-heartwood" } }) })).toThrow(
      /blueprint the-missing-heartwood is not a clue-graph case/,
    );
  });
});

describe("clue_accounting", () => {
  it("passes a rule-abiding trace", () => {
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace() });
    expect(checkById(checks, "clue_accounting").status).toBe("pass");
  });

  it("does not false-fail a second search in the same place (the cumulative list is not a re-reveal)", () => {
    // Only revealed_clue_id is the per-turn find; the second search's cumulative
    // list still holds the first search's clue.
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events: makeMultiStepEvents() }) });
    expect(checkById(checks, "clue_accounting").status).toBe("pass");
  });

  it("flags a search revealing a clue from another place", () => {
    const events = makeEvents();
    // The living-room search reports the kitchen's jar.
    events[6].payload.revealed_clue_id = "clue_jar";
    const acc = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.[0]).toMatchObject({ sequence: 7, reason: "clue_not_available", clue_id: "clue_jar" });
  });

  it("flags a clue the case does not hold", () => {
    const events = makeEvents();
    events[3].payload.revealed_clue_ids = ["clue_nowhere"];
    const acc = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.[0]).toMatchObject({ sequence: 4, reason: "unknown_clue", clue_id: "clue_nowhere" });
  });

  it("flags a re-revealed clue", () => {
    const events = makeEvents();
    // The living-room search reports the already-held kitchen crumbs.
    events[6].payload.revealed_clue_id = "clue_crumbs";
    const acc = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.some((v) => v.reason === "clue_revealed_again")).toBe(true);
  });

  it("flags an event that cannot be folded", () => {
    const events = makeEvents();
    // A search in the kitchen of a spot the case does not have.
    events[1].payload.clue_graph = { type: "search", spot: "the moon" };
    const acc = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "clue_accounting");
    expect(acc.status).toBe("fail");
    expect(acc.details?.violations?.[0]).toMatchObject({ sequence: 2 });
  });
});

describe("spoiler_leak", () => {
  const truth = () => (makeBlueprint() as unknown as { ground_truth: { what_happened: string } }).ground_truth.what_happened;

  it("passes when no pre-accusation narration copies ground truth", () => {
    const checks = runTraceMechanicalChecks({ rawTrace: makeRawTrace() });
    expect(checkById(checks, "spoiler_leak").status).toBe("pass");
  });

  it("flags a pre-accusation narration that copies a long ground-truth run", () => {
    const events = makeEvents();
    // The move's narration copies the ground truth verbatim.
    events[5].narration = `As you walk you realize: ${truth()}`;
    const leak = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "spoiler_leak");
    expect(leak.status).toBe("fail");
    expect(leak.details?.violations?.[0]).toMatchObject({ sequence: 6 });
  });

  it("flags a failed accusation's reply that copies ground truth: only the closing scene may tell it", () => {
    const failed: TraceEventRow = {
      ...makeMultiStepEvents()[3],
      narration: `Not yet, but think: ${truth()}`,
    };
    const resolved: TraceEventRow = { ...makeEvents()[8], narration: truth() };
    const events = [...makeEvents().slice(0, 8), { ...failed, sequence: 9 }, { ...resolved, sequence: 10 }];
    const leak = checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "spoiler_leak");
    expect(leak.status).toBe("fail");
    // The failed accusation is flagged; the closing scene, which copies the same truth, is not.
    expect(leak.details?.violations?.map((violation) => violation.sequence)).toEqual([9]);
  });

  it("does not flag the closing scene that legitimately reveals the truth", () => {
    const events = makeEvents();
    events[8].narration = truth();
    expect(checkById(runTraceMechanicalChecks({ rawTrace: makeRawTrace({ events }) }), "spoiler_leak").status).toBe("pass");
  });
});
