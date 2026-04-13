import { describe, expect, it } from "vitest";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  narrationTextFromParts,
  readNarrationEvent,
} from "../../../supabase/functions/_shared/narration.ts";
import {
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  characterSpeaker as fixtureCharacterSpeaker,
} from "../../testkit/src/fixtures.ts";

describe("narration event helpers", () => {
  it("preserves ordered narration parts when reading persisted events", () => {
    const event = readNarrationEvent({
      sequence: 3,
      event_type: "forced_endgame",
      narration: "First line\n\nSecond line",
      narration_parts: [
        createNarrationPart("First line", NARRATOR_SPEAKER),
        createNarrationPart("Second line", NARRATOR_SPEAKER),
      ],
      payload: {
        diagnostics: {
          session_id: "game-1",
          sequence: 3,
        },
      },
      created_at: "2026-03-16T10:00:00.000Z",
    });

    expect(event.sequence).toBe(3);
    expect(event.narration_parts.map((part) => part.text)).toEqual([
      "First line",
      "Second line",
    ]);
    expect(narrationTextFromParts(event.narration_parts)).toBe("First line\n\nSecond line");
  });

  it("prepends player input as investigator narration part for ask events", () => {
    const aliceSpeaker = fixtureCharacterSpeaker("Alice");
    const event = readNarrationEvent({
      sequence: 5,
      event_type: "ask",
      narration: "Alice responds thoughtfully.",
      narration_parts: [
        createNarrationPart("Alice responds thoughtfully.", aliceSpeaker),
      ],
      payload: {
        player_input: "Where were you when the cookies disappeared?",
        character_name: "Alice",
        speaker: aliceSpeaker,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe(
      "Where were you when the cookies disappeared?",
    );
    expect(event.narration_parts[1].speaker).toEqual(aliceSpeaker);
    expect(event.narration_parts[1].text).toBe("Alice responds thoughtfully.");
  });

  it("prepends player reasoning as investigator narration part for accuse_round events", () => {
    const event = readNarrationEvent({
      sequence: 7,
      event_type: "accuse_round",
      narration: "The judge considers your argument.",
      narration_parts: [
        createNarrationPart("The judge considers your argument.", NARRATOR_SPEAKER),
      ],
      payload: {
        player_reasoning: "I accuse Alice based on motive and opportunity.",
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe(
      "I accuse Alice based on motive and opportunity.",
    );
    expect(event.narration_parts[1].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("prepends player reasoning as investigator narration part for accuse_resolved events", () => {
    const event = readNarrationEvent({
      sequence: 8,
      event_type: "accuse_resolved",
      narration: "Your accusation is correct!",
      narration_parts: [
        createNarrationPart("Your accusation is correct!", NARRATOR_SPEAKER),
      ],
      payload: {
        player_reasoning: "Alice had crumbs on her coat.",
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe("Alice had crumbs on her coat.");
  });

  it("synthesizes 'move to <location>' as investigator input for move events", () => {
    const event = readNarrationEvent({
      sequence: 2,
      event_type: "move",
      narration: "You enter the kitchen.",
      narration_parts: [
        createNarrationPart("You enter the kitchen.", NARRATOR_SPEAKER),
      ],
      payload: {
        destination: "loc_kitchen",
        location_name: "Kitchen",
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe("move to Kitchen");
    expect(event.narration_parts[1].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("synthesizes 'talk to <character>' as investigator input for talk events", () => {
    const event = readNarrationEvent({
      sequence: 3,
      event_type: "talk",
      narration: "Alice greets you warmly.",
      narration_parts: [
        createNarrationPart("Alice greets you warmly.", NARRATOR_SPEAKER),
      ],
      payload: {
        character_name: "Alice",
        character_id: "char-alice",
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe("talk to Alice");
    expect(event.narration_parts[1].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("synthesizes 'search' as investigator input for search events", () => {
    const event = readNarrationEvent({
      sequence: 4,
      event_type: "search",
      narration: "You search the room carefully.",
      narration_parts: [
        createNarrationPart("You search the room carefully.", NARRATOR_SPEAKER),
      ],
      payload: {
        location_name: "Kitchen",
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(2);
    expect(event.narration_parts[0].speaker).toEqual(INVESTIGATOR_SPEAKER);
    expect(event.narration_parts[0].text).toBe("search");
    expect(event.narration_parts[1].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("does not prepend player input for event types without player actions", () => {
    const event = readNarrationEvent({
      sequence: 1,
      event_type: "start",
      narration: "The mystery begins.",
      narration_parts: [
        createNarrationPart("The mystery begins.", NARRATOR_SPEAKER),
      ],
      payload: {
        speaker: NARRATOR_SPEAKER,
      },
    });

    expect(event.narration_parts.length).toBe(1);
    expect(event.narration_parts[0].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("normalizes narration diagnostics for persisted event metadata", () => {
    expect(createNarrationDiagnostics({
      action: "move",
      event_category: "move",
      mode: "explore",
      resulting_mode: "accuse",
      time_before: 1,
      time_after: 0,
      time_consumed: true,
      forced_endgame: true,
      trigger: "player",
      related_sequence: 8,
    })).toEqual({
      action: "move",
      event_category: "move",
      mode: "explore",
      resulting_mode: "accuse",
      time_before: 1,
      time_after: 0,
      time_consumed: true,
      forced_endgame: true,
      trigger: "player",
      related_sequence: 8,
    });
  });
});
