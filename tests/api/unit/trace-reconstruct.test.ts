import { describe, expect, it } from "vitest";

import { reconstructTrace, revealedClueIdsForEvent } from "../../../evaluation/trace/lib/reconstruct.ts";
import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import { makeBlueprint, makeEvents, makeMultiStepEvents, makeRawTrace, type TraceEventRow } from "./trace-fixtures";

function moveEvent(seq: number, locationId: string): TraceEventRow {
  return { id: `m${seq}`, sequence: seq, event_type: "move", actor: "narrator", payload: { location_id: locationId }, narration: `At ${locationId}.`, narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z" };
}

type Turn = {
  sequence: number;
  role_name: string | null;
  character_id: string | null;
  player_input: string | null;
  context_error: string | null;
  recorded_use: { used_clue_ids: string[]; used_quote: string | null; new_commitments: string[] } | null;
  pre_state: { mode: string; current_location_id: string | null };
  reconstructed_context: {
    mode?: string;
    search_context?: { location_id?: string; next_clue?: { id?: string } | null } | null;
    talk_context?: { active_character?: { id?: string; state?: { commitments: string[] } } } | null;
    move_context?: { has_visited_before?: boolean } | null;
    accusation_judge_context?: unknown | null;
  } | null;
};

function turnBySeq(turns: Turn[], seq: number): Turn {
  const found = turns.find((t) => t.sequence === seq);
  if (!found) throw new Error(`no turn ${seq}`);
  return found;
}

describe("revealedClueIdsForEvent", () => {
  it("reads the per-turn find by event type", () => {
    // search: the singular this-turn find, NOT the cumulative revealed_clue_ids.
    expect(
      revealedClueIdsForEvent({
        event_type: "search",
        payload: { revealed_clue_id: "c2", revealed_clue_ids: ["c1", "c2"] },
        clues_revealed: [],
      }),
    ).toEqual(["c2"]);
    // search with no find this turn (cumulative list still present) → nothing.
    expect(
      revealedClueIdsForEvent({
        event_type: "search",
        payload: { revealed_clue_id: null, revealed_clue_ids: ["c1"] },
        clues_revealed: [],
      }),
    ).toEqual([]);
    // ask: the plural array is the per-turn reveal.
    expect(
      revealedClueIdsForEvent({
        event_type: "ask",
        payload: { revealed_clue_ids: ["a", "b"] },
        clues_revealed: [],
      }),
    ).toEqual(["a", "b"]);
    // legacy/other events: fall back to the column.
    expect(
      revealedClueIdsForEvent({ event_type: "start", payload: null, clues_revealed: ["c"] }),
    ).toEqual(["c"]);
  });
});

describe("reconstructTrace", () => {
  const { turns, final_state, issues } = reconstructTrace(makeRawTrace());

  it("emits one turn per event in sequence order with mapped roles", () => {
    expect(turns.map((t: { sequence: number }) => t.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(turnBySeq(turns, 1).role_name).toBeNull(); // start has no AI role
    expect(turnBySeq(turns, 2).role_name).toBe("search");
    expect(turnBySeq(turns, 3).role_name).toBe("talk_start");
    expect(turnBySeq(turns, 4).role_name).toBe("talk_conversation");
    expect(turnBySeq(turns, 6).role_name).toBe("move");
    expect(turnBySeq(turns, 9).role_name).toBe("accusation_judge");
  });

  it("folds session state (location, talk character, mode) across the trace", () => {
    // Pre-state of the garden search reflects the earlier move.
    expect(turnBySeq(turns, 7).pre_state.current_location_id).toBe("loc_garden");
    // While talking, the ask turn is scoped to the active character.
    expect(turnBySeq(turns, 4).character_id).toBe("char_mara");
    expect(final_state.mode).toBe("ended");
  });

  it("reconstructs the search context with the real builder", () => {
    const search = turnBySeq(turns, 2);
    expect(search.context_error).toBeNull();
    expect(search.reconstructed_context?.search_context?.location_id).toBe("loc_hall");
    // First bare search in the hall: next_clue is the first location clue.
    expect(search.reconstructed_context?.search_context?.next_clue?.id).toBe("clue_hall_1");
  });

  it("reconstructs talk context scoped to the active character", () => {
    const talk = turnBySeq(turns, 3);
    expect(talk.context_error).toBeNull();
    expect(talk.reconstructed_context?.talk_context?.active_character?.id).toBe("char_mara");
  });

  it("reads what an ask turn recorded about the character, and rebuilds the talk state from it", () => {
    // The fixture's ask predates recorded use, so nothing is read from it.
    expect(turnBySeq(turns, 4).recorded_use).toBeNull();
    expect(turnBySeq(turns, 2).recorded_use).toBeNull();

    const events = makeRawTrace().events.map((event: { sequence: number; payload?: Record<string, unknown> | null }) =>
      event.sequence === 4
        ? { ...event, payload: { ...event.payload, used_clue_ids: [], used_quote: null, new_commitments: ["saw only a shadow"] } }
        : event
    );
    const replayed = reconstructTrace(makeRawTrace({ events })).turns;
    expect(turnBySeq(replayed, 4).recorded_use).toEqual({
      used_clue_ids: [],
      used_quote: null,
      new_commitments: ["saw only a shadow"],
    });
    // Saying goodbye to Mara, her rebuilt state holds the commitment.
    expect(turnBySeq(replayed, 5).reconstructed_context?.talk_context?.active_character?.state?.commitments).toEqual([
      "saw only a shadow",
    ]);
  });

  it("keeps full-blueprint ground truth only in the accusation judge context", () => {
    expect(turnBySeq(turns, 9).reconstructed_context?.accusation_judge_context).not.toBeNull();
    // Non-judge roles must never carry the judge-only context (spoiler safety,
    // enforced by the real builder's assertRoleContextSafety).
    expect(turnBySeq(turns, 2).reconstructed_context?.accusation_judge_context).toBeNull();
    expect(issues).toHaveLength(0);
  });
});

describe("reconstructTrace — accusation fidelity", () => {
  const { turns } = reconstructTrace(makeRawTrace({ events: makeMultiStepEvents() }));

  it("reads accusation player reasoning from player_reasoning (not player_input)", () => {
    expect(turnBySeq(turns, 4).player_input).toBe("I think it was Mara.");
    expect(turnBySeq(turns, 5).player_input).toBe("No — it was Dorn, his glove was by the case.");
  });

  type JudgeCtx = { accusation_judge_context?: { last_accusation?: boolean } | null };
  const lastOf = (found: typeof turns, sequence: number) =>
    (turnBySeq(found, sequence).reconstructed_context as JudgeCtx)?.accusation_judge_context?.last_accusation;

  it("tells the judge whether an accusation is the last, like the runtime: from the failures before it", () => {
    expect(lastOf(turns, 4)).toBe(false);
    expect(lastOf(turns, 5)).toBe(false); // one failure before it: two left
    const [start, ...rest] = makeMultiStepEvents().slice(2);
    const failed = rest[0];
    const third = reconstructTrace(
      makeRawTrace({ events: [start, failed, { ...failed, id: "m5", sequence: 5 }, { ...rest[1], id: "m6", sequence: 6 }] }),
    ).turns;
    expect(lastOf(third, 6)).toBe(true);
    // A game recorded with rounds counts each as a failed accusation.
    const legacy = { ...failed, event_type: "accuse_round" };
    const rounds = reconstructTrace(
      makeRawTrace({ events: [start, legacy, { ...legacy, id: "m5", sequence: 5 }, { ...rest[1], id: "m6", sequence: 6 }] }),
    ).turns;
    expect(lastOf(rounds, 6)).toBe(true);
  });

  it("folds a failed accusation back to exploring", () => {
    expect(turnBySeq(turns, 5).pre_state).toMatchObject({ mode: "explore" });
  });
});

describe("reconstructTrace — context mode & revisit fidelity", () => {
  it("forces accusation contexts into accuse mode even when entered from explore", () => {
    // forced_endgame and immediate-accusation both build context in accuse mode
    // at runtime, even though the pre-state is still explore.
    const events: TraceEventRow[] = [
      moveEvent(1, "loc_hall"),
      { id: "fe", sequence: 2, event_type: "forced_endgame", actor: "narrator", payload: {}, narration: "Time is up — name the culprit.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:01:00Z" },
    ];
    const forced = turnBySeq(reconstructTrace(makeRawTrace({ events })).turns, 2);
    expect(forced.pre_state.mode).toBe("explore");
    expect(forced.reconstructed_context?.mode).toBe("accuse");
  });

  it("computes has_visited_before from prior location history, not a visited set", () => {
    const events: TraceEventRow[] = [moveEvent(1, "loc_garden"), moveEvent(2, "loc_garden")];
    const { turns } = reconstructTrace(makeRawTrace({ events }));
    expect(turnBySeq(turns, 1).reconstructed_context?.move_context?.has_visited_before).toBe(false);
    expect(turnBySeq(turns, 2).reconstructed_context?.move_context?.has_visited_before).toBe(true);
  });
});

describe("events that store the line as typed", () => {
  // The player's own words beside what the turn did, under `input`.
  const TYPED: Record<string, string> = {
    search: "search",
    talk: "talk to Mara",
    ask: "Did you see anything?",
    end_talk: "bye",
    move: "go to the garden",
    accuse_start: "accuse",
    accuse_resolved: "Dorn did it.",
  };

  function withTypedLines(): TraceEventRow[] {
    return makeEvents().map((event) =>
      TYPED[event.event_type] ? { ...event, payload: { ...event.payload, input: TYPED[event.event_type] } } : event,
    );
  }

  it("reconstruct and check the same as events without it", () => {
    const plain = makeRawTrace();
    const typed = makeRawTrace({ events: withTypedLines() });

    expect(reconstructTrace(typed)).toEqual(reconstructTrace(plain));
    expect(runTraceMechanicalChecks({ rawTrace: typed })).toEqual(runTraceMechanicalChecks({ rawTrace: plain }));
  });
});

describe("reconstructTrace, for a spot whose pointer was found elsewhere", () => {
  // The garden's shed is locked behind the hall footprint, found in the hall.
  function pointedBlueprint() {
    const bp = makeBlueprint();
    return {
      ...bp,
      world: {
        ...bp.world,
        locations: bp.world.locations.map((loc) =>
          loc.id === "loc_garden"
            ? {
                ...loc,
                sub_locations: [
                  {
                    id: "sl_shed",
                    name: "the potting shed",
                    hint: "A shed door.",
                    clues: [
                      {
                        id: "clue_shed_1",
                        text: "A trowel with fresh mud.",
                        requires: {
                          kind: "pointer" as const,
                          clue_ids: ["clue_hall_1"],
                          rationale: "The footprint leads to the shed.",
                          target: { location_id: "loc_garden", sub_location_id: "sl_shed" },
                        },
                      },
                    ],
                  },
                ],
              }
            : loc,
        ),
      },
    };
  }
  const search = (seq: number, location: string, payload: Record<string, unknown>): TraceEventRow => ({
    id: `s${seq}`, sequence: seq, event_type: "search", actor: "system",
    payload: { location_id: location, ...payload },
    narration: "You look around.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:00:00Z",
  });
  const spotsAt = (events: TraceEventRow[]) => {
    const { turns } = reconstructTrace(makeRawTrace({ blueprint: pointedBlueprint(), events }));
    const context = turnBySeq(turns, events.at(-1)!.sequence).reconstructed_context as {
      search_context?: { sub_locations?: Array<{ id: string }> };
    } | null;
    return context?.search_context?.sub_locations?.map((spot) => spot.id);
  };

  it("shows the spot once the session holds its pointer, as the game did", () => {
    expect(
      spotsAt([
        search(1, "loc_hall", { revealed_clue_id: "clue_hall_1", revealed_clue_ids: ["clue_hall_1"] }),
        moveEvent(2, "loc_garden"),
        search(3, "loc_garden", { revealed_clue_id: null, revealed_clue_ids: [] }),
      ]),
    ).toEqual(["sl_shed"]);
  });

  it("hides it before then", () => {
    expect(
      spotsAt([moveEvent(1, "loc_garden"), search(2, "loc_garden", { revealed_clue_id: null, revealed_clue_ids: [] })]),
    ).toEqual([]);
  });
});
