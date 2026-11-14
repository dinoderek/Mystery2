// The turn's arithmetic and the action a line plays, from fixed inputs.

import { describe, expect, it } from "vitest";

import type { GameSessionRow } from "../../../packages/game-engine/src/context.ts";
import { BadRequestError } from "../../../packages/game-engine/src/errors.ts";
import { spendTurn, turnEffect } from "../../../packages/game-engine/src/turn/effect.ts";
import { planAction } from "../../../packages/game-engine/src/turn/plan.ts";
import type { ActionOutcome } from "../../../packages/game-engine/src/turn/types.ts";
import { NARRATOR_SPEAKER } from "../../testkit/src/fixtures.ts";

const NOW = "2026-11-14T10:00:00.000Z";

function session(overrides: Partial<GameSessionRow> = {}): GameSessionRow {
  return {
    id: "g1",
    player_id: "p1",
    blueprint_id: "bp",
    ai_profile_id: "default",
    mode: "explore",
    current_location_id: "loc-kitchen",
    current_talk_character_id: null,
    time_remaining: 5,
    discovered_clues: [],
    outcome: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function outcome(overrides: Partial<ActionOutcome> = {}): ActionOutcome {
  return {
    event: {
      event_type: "move",
      actor: "system",
      payload: { location_id: "loc-hall", location_name: "Hall" },
      narration_parts: [{ text: "You arrive.", speaker: NARRATOR_SPEAKER }],
      model: "mock/model",
      action: "move",
      mode: "explore",
    },
    costs_turn: true,
    resulting_mode: "explore",
    patch: { current_location_id: "loc-hall", current_talk_character_id: null },
    revealed_clues: [],
    result: null,
    endgame: { scene_summary: "Out of time in the hall.", location_id: "loc-hall", payload: { location_id: "loc-hall" } },
    ...overrides,
  };
}

const FORCED = { narration_parts: [{ text: "Time is up.", speaker: NARRATOR_SPEAKER }], model: "mock/model" };

function effectOf(game: GameSessionRow, played: ActionOutcome, forced = false) {
  return turnEffect({
    game_id: "g1",
    session: game,
    outcome: played,
    cost: spendTurn(game.time_remaining, played.costs_turn),
    forced: forced ? FORCED : null,
    input: "go to the hall",
    expected_sequence: 7,
    now: NOW,
  });
}

describe("spendTurn", () => {
  it("spends one turn and never goes below zero", () => {
    expect(spendTurn(5, true)).toEqual({ time_before: 5, time_after: 4, time_consumed: true, forced_endgame: false });
    expect(spendTurn(0, true)).toMatchObject({ time_after: 0, forced_endgame: true });
  });

  it("forces the accusation only when this action spent the last turn", () => {
    expect(spendTurn(1, true).forced_endgame).toBe(true);
    expect(spendTurn(1, false)).toEqual({ time_before: 1, time_after: 1, time_consumed: false, forced_endgame: false });
  });
});

describe("turnEffect", () => {
  it("saves the action's change with the turn spent, and its event with the typed line", () => {
    const effect = effectOf(session(), outcome());

    expect(effect.patch).toEqual({
      current_location_id: "loc-hall",
      current_talk_character_id: null,
      mode: "explore",
      time_remaining: 4,
      updated_at: NOW,
    });
    expect(effect.events).toHaveLength(1);
    const [move] = effect.events;
    expect(move.sequence).toBe(7);
    expect(move.event).toMatchObject({ event_type: "move", narration: "You arrive.", model: "mock/model" });
    expect(move.event.payload).toMatchObject({
      location_name: "Hall",
      input: "go to the hall",
      diagnostics: { sequence: 7, time_before: 5, time_after: 4, time_consumed: true, forced_endgame: false },
    });
    expect(effect.state).toEqual({ mode: "explore", time_remaining: 4, location: "loc-hall", current_talk_character: null });
  });

  it("keeps the turns and the conversation when the action costs nothing", () => {
    const talking = session({ mode: "talk", current_talk_character_id: "char-alice" });
    const ask = outcome({
      event: { ...outcome().event, event_type: "ask", action: "ask", mode: "talk" },
      costs_turn: false,
      resulting_mode: "talk",
      patch: { discovered_clues: ["clue-1"] },
      endgame: null,
    });

    const effect = effectOf(talking, ask);

    expect(effect.patch).toMatchObject({ discovered_clues: ["clue-1"], mode: "talk", time_remaining: 5 });
    expect(effect.state).toEqual({
      mode: "talk",
      time_remaining: 5,
      location: "loc-kitchen",
      current_talk_character: "char-alice",
    });
  });

  it("moves into the accusation when the last turn is spent, after the action's own event", () => {
    const talk = outcome({
      event: { ...outcome().event, event_type: "talk", action: "talk" },
      resulting_mode: "talk",
      patch: { current_talk_character_id: "char-alice" },
      endgame: { scene_summary: "Out of time.", payload: { character_id: "char-alice" } },
    });

    const effect = effectOf(session({ time_remaining: 1 }), talk, true);

    expect(effect.patch).toMatchObject({ mode: "accuse", time_remaining: 0, current_talk_character_id: null });
    expect(effect.events.map((planned) => [planned.sequence, planned.event.event_type])).toEqual([
      [7, "talk"],
      [8, "forced_endgame"],
    ]);
    const forced = effect.events[1].event.payload;
    expect(forced).toMatchObject({
      character_id: "char-alice",
      trigger: "timeout",
      diagnostics: { related_sequence: 7, forced_endgame: true },
    });
    // The player typed only the action's line.
    expect(forced).not.toHaveProperty("input");
    expect(effect.state.current_talk_character).toBeNull();
  });

  it("ends the case with the accusation's result", () => {
    const resolved = outcome({
      event: { ...outcome().event, event_type: "accuse_resolved", action: "accuse_reasoning", mode: "accuse" },
      costs_turn: false,
      resulting_mode: "ended",
      patch: { outcome: "win", current_talk_character_id: null },
      result: "win",
      endgame: null,
    });

    const effect = effectOf(session({ mode: "accuse" }), resolved);

    expect(effect.patch).toMatchObject({ mode: "ended", outcome: "win", time_remaining: 5 });
    expect(effect.events[0].event.payload).toMatchObject({ diagnostics: { mode: "accuse", resulting_mode: "ended" } });
  });

  it("refuses to force the accusation without its narration", () => {
    expect(() => effectOf(session({ time_remaining: 1 }), outcome())).toThrow(/needs its narration/);
  });
});

describe("planAction", () => {
  it("plays each explore action as itself", () => {
    const explore = session();
    expect(planAction({ type: "move", destination: "loc-hall" }, explore)).toEqual({ kind: "move", destination: "loc-hall" });
    expect(planAction({ type: "search", query: null }, explore)).toEqual({ kind: "search", query: null });
    expect(planAction({ type: "talk", character_id: "char-alice" }, explore)).toEqual({ kind: "talk", character_id: "char-alice" });
  });

  it("starts the accusation, or plays its first round when the line carries the reasoning", () => {
    expect(planAction({ type: "accuse", reasoning: null }, session())).toEqual({ kind: "accuse_start" });
    expect(planAction({ type: "accuse", reasoning: "Bob did it" }, session())).toEqual({
      kind: "accuse_round",
      reasoning: "Bob did it",
    });
  });

  it("says a line to the person being talked to, or to the accusation", () => {
    const talking = session({ mode: "talk", current_talk_character_id: "char-alice" });
    expect(planAction({ type: "ask", question: "Where were you?" }, talking)).toEqual({
      kind: "ask",
      question: "Where were you?",
      character_id: "char-alice",
    });
    expect(planAction({ type: "end_talk" }, talking)).toEqual({ kind: "end_talk", character_id: "char-alice" });
    expect(planAction({ type: "ask", question: "It was Bob" }, session({ mode: "accuse" }))).toEqual({
      kind: "accuse_round",
      reasoning: "It was Bob",
    });
  });

  it("refuses an action the mode does not allow, or a conversation that is not happening", () => {
    expect(() => planAction({ type: "move", destination: "loc-hall" }, session({ mode: "talk" }))).toThrow(BadRequestError);
    expect(() => planAction({ type: "search", query: null }, session({ mode: "ended" }))).toThrow(BadRequestError);
    expect(() => planAction({ type: "end_talk" }, session({ mode: "talk" }))).toThrow("No active conversation to end");
  });
});
