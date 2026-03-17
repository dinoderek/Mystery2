import { describe, expect, it } from "vitest";
import {
  createNarrationDiagnostics,
  createNarrationPart,
  narrationTextFromParts,
  readNarrationEvent,
} from "../../../supabase/functions/_shared/narration.ts";
import { NARRATOR_SPEAKER } from "../../../supabase/functions/_shared/speaker.ts";

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
