import { describe, expect, it } from "vitest";

import {
  actionForEvent,
  buildCase,
  historyPayload,
  sampleEvenly,
} from "../../../evaluation/runtime/cases-from-trace.mjs";

// These helpers turn a collected game-master trace into deterministic
// single-event runtime-eval cases. They run without a database or LLM, so we
// assert their pure output shape directly against small hand-built fixtures.

describe("sampleEvenly", () => {
  it("returns every item unchanged when there are at most `max`", () => {
    expect(sampleEvenly([1, 2, 3], 5)).toEqual([1, 2, 3]);
    // Boundary: exactly `max` items are all kept.
    expect(sampleEvenly([1, 2, 3], 3)).toEqual([1, 2, 3]);
  });

  it("picks evenly-spaced items that always include the first and last", () => {
    expect(sampleEvenly([0, 1, 2, 3, 4], 3)).toEqual([0, 2, 4]);
    expect(sampleEvenly([0, 1, 2, 3, 4, 5, 6, 7, 8], 3)).toEqual([0, 4, 8]);
  });

  it("de-duplicates when even spacing lands on the same item twice", () => {
    // Every sampled slot resolves to "a" or "b"; the result keeps one of each.
    expect(sampleEvenly(["a", "a", "b", "a", "a"], 3)).toEqual(["a", "b"]);
  });

  it("yields a single undefined slot when max is 1 over a larger array", () => {
    // With max === 1 the even-spacing divisor is zero, so the lone index is NaN
    // and reads past the array — documenting the current CLI behavior, which
    // never requests max === 1 in practice (the default cap is 3).
    const result = sampleEvenly([0, 1, 2, 3], 1);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeUndefined();
  });
});

describe("actionForEvent", () => {
  it("maps an ask event to an ask action carrying the player input", () => {
    expect(
      actionForEvent({ event_type: "ask", payload: { player_input: "who did it?" } }),
    ).toEqual({ type: "ask", player_input: "who did it?" });
  });

  it("defaults ask player_input to an empty string when the payload omits it", () => {
    expect(actionForEvent({ event_type: "ask", payload: {} })).toEqual({
      type: "ask",
      player_input: "",
    });
  });

  it("maps talk/move/search events to their action shapes", () => {
    expect(actionForEvent({ event_type: "talk", payload: { character_id: "c1" } })).toEqual({
      type: "talk",
      character_id: "c1",
    });
    expect(actionForEvent({ event_type: "move", payload: { destination: "l2" } })).toEqual({
      type: "move",
      destination: "l2",
    });
    expect(actionForEvent({ event_type: "search", payload: {} })).toEqual({ type: "search" });
  });

  it("tolerates an event with no payload at all", () => {
    expect(actionForEvent({ event_type: "search" })).toEqual({ type: "search" });
  });

  it("returns null for unsupported event types", () => {
    expect(actionForEvent({ event_type: "end_talk", payload: {} })).toBeNull();
    expect(actionForEvent({ event_type: "clue_revealed", payload: {} })).toBeNull();
  });
});

describe("historyPayload", () => {
  it("keeps only the whitelisted history fields and drops everything else", () => {
    const kept = historyPayload({
      player_input: "hi",
      character_id: "c1",
      character_name: "Ann",
      location_id: "l1",
      location_name: "Hall",
      destination: "l2",
      revealed_clue_ids: ["x"],
      revealed_clue_id: "y",
      diagnostics: { mode: "talk" }, // not on the whitelist
      other_field: "drop me",
    });
    expect(kept).toEqual({
      player_input: "hi",
      character_id: "c1",
      character_name: "Ann",
      location_id: "l1",
      location_name: "Hall",
      destination: "l2",
      revealed_clue_ids: ["x"],
      revealed_clue_id: "y",
    });
    expect(kept).not.toHaveProperty("diagnostics");
    expect(kept).not.toHaveProperty("other_field");
  });

  it("returns an empty object for an empty or nullish payload", () => {
    expect(historyPayload({})).toEqual({});
    expect(historyPayload(null)).toEqual({});
    expect(historyPayload(undefined)).toEqual({});
  });
});

describe("buildCase", () => {
  const blueprintPath = "evaluation/runtime/cases/from-traces/blueprints/bp.json";

  it("assembles a full case from a target event and its prior history", () => {
    const target = {
      sequence: 7,
      event_type: "ask",
      actor: "player",
      narration: "N",
      payload: {
        player_input: "who did it?",
        character_id: "c1",
        location_id: "l1",
        diagnostics: { mode: "talk", time_before: 42 },
      },
    };
    const prior = [
      {
        sequence: 1,
        event_type: "talk",
        actor: "player",
        narration: "t",
        payload: { character_id: "c1", stray_field: "drop me" },
      },
    ];

    const built = buildCase(target, prior, blueprintPath, ["flesch"]);

    expect(built).toEqual({
      id: "s7-ask",
      blueprint: { path: blueprintPath },
      given: {
        mode: "talk",
        location_id: "l1",
        talk_character_id: "c1",
        time_remaining: 42,
        history: [
          {
            sequence: 1,
            event_type: "talk",
            actor: "player",
            narration: "t",
            // The stray field is stripped by the history-payload whitelist.
            payload: { character_id: "c1" },
          },
        ],
      },
      action: { type: "ask", player_input: "who did it?" },
      judges: ["flesch"],
      judgeConfig: { flesch: { tolerance: 2 } },
    });
  });

  it("falls back to explore mode and a zero clock when diagnostics are absent", () => {
    const target = {
      sequence: 3,
      event_type: "search",
      payload: { location_id: "l9" },
    };

    const { given, id } = buildCase(target, [], blueprintPath, ["flesch"]);

    expect(id).toBe("s3-search");
    expect(given.mode).toBe("explore");
    expect(given.time_remaining).toBe(0);
    expect(given.history).toEqual([]);
    // No character on a search event -> no talk_character_id key at all.
    expect(given).not.toHaveProperty("talk_character_id");
  });

  it("prefers the payload's own time_remaining when diagnostics has none", () => {
    const target = {
      sequence: 4,
      event_type: "talk",
      payload: { location_id: "l1", character_id: "c2", time_remaining: 99 },
    };
    const { given } = buildCase(target, [], blueprintPath, ["flesch"]);
    expect(given.time_remaining).toBe(99);
    expect(given.talk_character_id).toBe("c2");
  });
});
