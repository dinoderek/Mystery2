// The change of age: which age a game last recorded, and the one line saved
// when the profile's age differs. The endpoints that save it are
// `tests/api/integration/age-command.test.ts`.

import { describe, expect, it } from "vitest";

import { AgeChangePayloadSchema, AGE_CHANGE_EVENT_TYPE, NO_TURN_EVENT_TYPE } from "@my2/shared";
import { playedEvents as evaluationPlayedEvents } from "../../../evaluation/lib/game-events.ts";
import { ageChange, ageChangeLine, lastRecordedAge } from "../../../packages/game-engine/src/turn/age-change.ts";
import { playedEvents } from "../../../packages/game-engine/src/turn/no-turn.ts";

const narrated = (age: number) => ({ event_type: "search", payload: { reading_age: age } });
const changed = (to: number) => ({ event_type: AGE_CHANGE_EVENT_TYPE, payload: { from: 6, to } });
const engineLine = { event_type: NO_TURN_EVENT_TYPE, payload: { input: "help", answered: "help" } };

describe("lastRecordedAge", () => {
  it("is the newest narrated event's age", () => {
    expect(lastRecordedAge([narrated(8), narrated(9), engineLine])).toBe(9);
  });

  it("counts a change saved since the last narration, so it is recorded once", () => {
    expect(lastRecordedAge([narrated(8), changed(10), engineLine])).toBe(10);
  });

  it("is null for a game that recorded none", () => {
    expect(lastRecordedAge([])).toBeNull();
    expect(lastRecordedAge([{ event_type: "start", payload: null }, engineLine])).toBeNull();
  });
});

describe("ageChange", () => {
  it("is one engine-written line with the age it moved from and to", () => {
    const event = ageChange(8, 9);

    expect(event).toMatchObject({
      event_type: AGE_CHANGE_EVENT_TYPE,
      actor: "system",
      model: null,
      narration: ageChangeLine(9),
      narration_parts: [{ text: "From now on, the story is written for age 9.", speaker: { kind: "system" } }],
    });
    expect(AgeChangePayloadSchema.parse(event?.payload)).toEqual({ from: 8, to: 9 });
  });

  it("is the same line whatever the age moved from", () => {
    expect(ageChange(6, 9)?.narration).toBe(ageChange(11, 9)?.narration);
  });

  it("is nothing when the age is the one recorded, or none is", () => {
    expect(ageChange(8, 8)).toBeNull();
    expect(ageChange(null, 8)).toBeNull();
  });
});

describe("the events the game master took part in", () => {
  const events = [narrated(8), engineLine, changed(9), narrated(9)];

  it("leave out the lines the engine wrote, in the engine and in evaluation", () => {
    expect(playedEvents(events)).toEqual([narrated(8), narrated(9)]);
    expect(evaluationPlayedEvents(events)).toEqual([narrated(8), narrated(9)]);
  });
});
