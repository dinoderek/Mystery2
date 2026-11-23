import { describe, expect, it } from "vitest";

import { reconstructTrace, revealedClueIdsForEvent } from "../../../evaluation/trace/lib/reconstruct.ts";
import { runTraceMechanicalChecks } from "../../../evaluation/trace/lib/mechanical.ts";
import { makeBlueprint, makeEvents, makeMultiStepEvents, makeRawTrace, playedRows, type TraceEventRow } from "./trace-fixtures";

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
    graph_search_context?: { location_name?: string; visible_spots?: string[] } | null;
    graph_talk_context?: { character?: { id?: string } } | null;
    graph_accusation_context?: { reply?: { kind?: string } } | null;
    move_context?: { has_visited_before?: boolean } | null;
  } | null;
};

function turnBySeq(turns: readonly unknown[], seq: number): Turn {
  const found = (turns as Turn[]).find((t) => t.sequence === seq);
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
    // A closing scene names its own role.
    expect(turnBySeq(turns, 9).role_name).toBe("graph_ending");
    expect(issues).toHaveLength(0);
  });

  it("folds session state (location, talk character, mode) across the trace", () => {
    // Pre-state of the living-room search reflects the earlier move.
    expect(turnBySeq(turns, 7).pre_state.current_location_id).toBe("loc-living-room");
    // While talking, the ask turn is scoped to the active character.
    expect(turnBySeq(turns, 4).character_id).toBe("char-alice");
    expect(turnBySeq(turns, 4).pre_state.mode).toBe("talk");
    expect(final_state.mode).toBe("ended");
  });

  it("reconstructs the search context with the clue-graph builder", () => {
    const search = turnBySeq(turns, 2);
    expect(search.context_error).toBeNull();
    expect(search.reconstructed_context?.graph_search_context?.location_name).toBe("Kitchen");
  });

  it("reconstructs talk context scoped to the active character, for the greeting and for a line", () => {
    for (const sequence of [3, 4]) {
      const talk = turnBySeq(turns, sequence);
      expect(talk.context_error).toBeNull();
      expect(talk.reconstructed_context?.graph_talk_context?.character?.id).toBe("char-alice");
    }
    expect(turnBySeq(turns, 4).reconstructed_context?.mode).toBe("talk");
  });

  it("reads what an ask turn recorded about the character", () => {
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
  });

  it("builds the verdict context only for an accusation turn, and never for another role", () => {
    expect(turnBySeq(turns, 9).reconstructed_context?.graph_accusation_context).toBeTruthy();
    // Spoiler safety, enforced by the real builder's assertRoleContextSafety.
    expect(turnBySeq(turns, 2).reconstructed_context?.graph_accusation_context).toBeUndefined();
    expect(turnBySeq(turns, 3).reconstructed_context?.graph_accusation_context).toBeUndefined();
  });

  it("refuses a trace whose blueprint is not a clue graph, by name", () => {
    const v2 = { ...makeBlueprint(), clue_graph: undefined };
    expect(() => reconstructTrace(makeRawTrace({ blueprint: { ...v2, id: "the-missing-heartwood" } }))).toThrow(
      /blueprint the-missing-heartwood is not a clue-graph case/,
    );
  });
});

describe("reconstructTrace — accusation fidelity", () => {
  const { turns } = reconstructTrace(makeRawTrace({ events: makeMultiStepEvents() }));

  it("reads accusation player reasoning from player_reasoning (not player_input)", () => {
    expect(turnBySeq(turns, 5).player_input).toBe("I think it was Bob.");
    expect(turnBySeq(turns, 6).player_input).toBe("No, it was Alice. Her fingerprints are on the jar.");
  });

  it("words a failed accusation from the engine's saved decision", () => {
    const failed = turnBySeq(turns, 5);
    expect(failed.role_name).toBe("graph_accusation_round");
    expect(failed.context_error).toBeNull();
    expect(failed.reconstructed_context?.graph_accusation_context?.reply?.kind).toBe("missing");
  });

  it("rebuilds no context for an accusation saved before the engine decided it, and reports no error", () => {
    const events = makeMultiStepEvents().map((event) =>
      event.sequence === 5 ? { ...event, payload: { ...event.payload, clue_graph_accusation: undefined } } : event,
    );
    const failed = turnBySeq(reconstructTrace(makeRawTrace({ events })).turns, 5);
    expect(failed.reconstructed_context).toBeNull();
    expect(failed.context_error).toBeNull();
  });

  it("folds a failed accusation back to exploring", () => {
    expect(turnBySeq(turns, 5).pre_state).toMatchObject({ mode: "accuse" });
    expect(turnBySeq(turns, 6).pre_state).toMatchObject({ mode: "explore" });
  });
});

describe("reconstructTrace — context mode & revisit fidelity", () => {
  it("forces accusation contexts into accuse mode even when entered from explore", () => {
    // forced_endgame and immediate-accusation both build context in accuse mode
    // at runtime, even though the pre-state is still explore.
    const events: TraceEventRow[] = [
      moveEvent(1, "loc-living-room"),
      { id: "fe", sequence: 2, event_type: "forced_endgame", actor: "narrator", payload: {}, narration: "Time is up — name the culprit.", narration_parts: [], clues_revealed: [], created_at: "2026-06-01T10:01:00Z" },
    ];
    const forced = turnBySeq(reconstructTrace(makeRawTrace({ events })).turns, 2);
    expect(forced.pre_state.mode).toBe("explore");
    expect(forced.reconstructed_context?.mode).toBe("accuse");
  });

  it("computes has_visited_before from prior location history, not a visited set", () => {
    const events: TraceEventRow[] = [moveEvent(1, "loc-living-room"), moveEvent(2, "loc-living-room")];
    const { turns } = reconstructTrace(makeRawTrace({ events }));
    expect(turnBySeq(turns, 1).reconstructed_context?.move_context?.has_visited_before).toBe(false);
    expect(turnBySeq(turns, 2).reconstructed_context?.move_context?.has_visited_before).toBe(true);
  });
});

describe("events that store the line as typed", () => {
  // The player's own words beside what the turn did, under `input`.
  const TYPED: Record<string, string> = {
    search: "search",
    talk: "talk to Alice",
    ask: "Where were you at noon?",
    end_talk: "bye",
    move: "go to the living room",
    accuse_start: "accuse",
    accuse_resolved: "Alice did it.",
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

describe("reconstructTrace, for a spot revealed by a clue found elsewhere", () => {
  // The laundry basket shows once Bob has said what he saw, in the living room.
  const spotsAfter = (steps: Parameters<typeof playedRows>[0]) => {
    const events = playedRows([...steps, { move: "loc-kitchen" }, { search: null }]);
    const { turns } = reconstructTrace(makeRawTrace({ events }));
    return turns.at(-1)?.reconstructed_context?.graph_search_context?.visible_spots;
  };

  it("shows the spot once the session holds its clue, as the game did", () => {
    expect(
      spotsAfter([
        { move: "loc-living-room" },
        { talk: "char-bob", narration: "Bob waves." },
        { say: "Did you see Alice?", reply: "Yes, the apron.", asked: ["bob_saw_apron"] },
      ]),
    ).toContain("the laundry basket");
  });

  it("hides it before then", () => {
    expect(spotsAfter([{ move: "loc-living-room" }, { talk: "char-bob", narration: "Bob waves." }])).toEqual([
      "the pantry shelf",
      "under the kitchen sink",
    ]);
  });
});
