import { describe, expect, it } from "vitest";
import {
  buildNarrationEvent,
  createNarrationPart,
  parseNarrationParts,
  readNarrationEvent,
} from "../../../packages/game-engine/src/narration.ts";
import {
  INVESTIGATOR_SPEAKER,
  NARRATOR_SPEAKER,
  characterSpeaker,
} from "../../testkit/src/fixtures.ts";

/**
 * How stored events become what a resumed game shows. Rows come from a
 * database that older versions of the game wrote, so every field may be
 * missing or the wrong type; the reader has to show what it can and never
 * throw.
 */

function row(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 1,
    event_type: "search",
    narration: "You find a note.",
    narration_parts: null,
    payload: null,
    ...overrides,
  };
}

describe("parseNarrationParts", () => {
  it("keeps stored parts in order, with their speakers and images", () => {
    const ann = characterSpeaker("Ann");

    const parts = parseNarrationParts([
      { text: "Hello", speaker: ann, image_id: "portrait" },
      { text: "Hmm", speaker: NARRATOR_SPEAKER },
    ]);

    expect(parts).toEqual([
      { text: "Hello", speaker: ann, image_id: "portrait" },
      { text: "Hmm", speaker: NARRATOR_SPEAKER },
    ]);
  });

  it("drops entries that are not objects or have blank text, and keeps the rest", () => {
    const parts = parseNarrationParts([
      "stray",
      null,
      { text: "   " },
      { text: 5 },
      { text: "Kept" },
    ]);

    expect(parts.map((part) => part.text)).toEqual(["Kept"]);
  });

  it("gives a part with a bad speaker the fallback speaker, not the narrator", () => {
    const ann = characterSpeaker("Ann");

    const [part] = parseNarrationParts(
      [{ text: "Hi", speaker: { kind: "x" } }],
      {
        speaker: ann,
      },
    );

    expect(part.speaker).toEqual(ann);
  });

  it("falls back to the event's plain narration when no part survives", () => {
    const ann = characterSpeaker("Ann");

    expect(
      parseNarrationParts([{ text: "" }], {
        narration: "Plain text",
        speaker: ann,
        image_id: "img",
      }),
    ).toEqual([{ text: "Plain text", speaker: ann, image_id: "img" }]);
  });

  it("falls back to the narrator when no speaker is given", () => {
    expect(parseNarrationParts(undefined, { narration: "Plain" })).toEqual([
      { text: "Plain", speaker: NARRATOR_SPEAKER },
    ]);
  });

  it("returns nothing when there are no parts and no narration", () => {
    expect(parseNarrationParts(undefined)).toEqual([]);
    expect(parseNarrationParts([], { narration: "  " })).toEqual([]);
    expect(parseNarrationParts("not a list", { narration: null })).toEqual([]);
  });
});

describe("readNarrationEvent over odd rows", () => {
  it("shows an ask answered by a character as that character's words", () => {
    const event = readNarrationEvent(
      row({
        event_type: "ask",
        narration: "I was in the library.",
        payload: { character_name: "Lady Ashworth" },
      }),
    );

    expect(event.narration_parts).toEqual([
      {
        text: "I was in the library.",
        speaker: {
          kind: "character",
          key: "character:lady-ashworth",
          label: "Lady Ashworth",
        },
      },
    ]);
  });

  it("reads the older character field for an ask, and the narrator without either", () => {
    const older = readNarrationEvent(
      row({ event_type: "ask", payload: { character: "Bob" } }),
    );
    const neither = readNarrationEvent(row({ event_type: "ask", payload: {} }));

    expect(older.narration_parts[0].speaker.label).toBe("Bob");
    expect(neither.narration_parts[0].speaker).toEqual(NARRATOR_SPEAKER);
  });

  it("takes an event's image from whichever image field the payload carries", () => {
    const fields = [
      "image_id",
      "location_image_id",
      "character_portrait_image_id",
      "blueprint_image_id",
    ];

    for (const field of fields) {
      const event = readNarrationEvent(
        row({ event_type: "quit", payload: { [field]: `img-${field}` } }),
      );
      expect(event.narration_parts.at(-1)?.image_id).toBe(`img-${field}`);
    }
    expect(
      readNarrationEvent(row({ event_type: "quit", payload: { image_id: 3 } }))
        .narration_parts[0],
    ).not.toHaveProperty("image_id");
  });

  it("shows no line the player typed for a move into the opening location", () => {
    const event = readNarrationEvent(
      row({
        event_type: "move",
        payload: { role: "enter", location_name: "Hall" },
      }),
    );

    expect(event.narration_parts.map((part) => part.speaker.kind)).toEqual([
      "narrator",
    ]);
  });

  it("shows no line for a move or talk whose target was not saved", () => {
    for (const event_type of ["move", "talk"]) {
      const event = readNarrationEvent(row({ event_type, payload: {} }));
      expect(event.narration_parts[0].speaker).toEqual(NARRATOR_SPEAKER);
    }
  });

  it("rebuilds 'search <query>' when the search had one", () => {
    const event = readNarrationEvent(
      row({ payload: { search_query: "the desk" } }),
    );

    expect(event.narration_parts[0]).toEqual(
      createNarrationPart("search the desk", INVESTIGATOR_SPEAKER),
    );
  });

  it("shows an event with no payload, a non-numeric sequence and a bad type", () => {
    const event = readNarrationEvent(
      row({ sequence: "7", event_type: 12, created_at: 5 }),
    );

    expect(event.sequence).toBe(0);
    expect(event.event_type).toBe("event");
    expect(event.payload).toBeNull();
    expect(event.created_at).toBeUndefined();
    expect(event.narration_parts.map((part) => part.text)).toEqual([
      "You find a note.",
    ]);
  });

  it("keeps the payload and creation time of a well-formed row", () => {
    const event = readNarrationEvent(
      row({
        payload: { note: 1 },
        created_at: "2026-03-16T10:00:00.000Z",
      }),
    );

    expect(event.payload).toEqual({ note: 1 });
    expect(event.created_at).toBe("2026-03-16T10:00:00.000Z");
  });

  it("shows nothing for an event with neither text nor parts", () => {
    expect(
      readNarrationEvent(row({ narration: "  ", event_type: "quit" }))
        .narration_parts,
    ).toEqual([]);
  });
});

describe("buildNarrationEvent", () => {
  const parts = [createNarrationPart("One", NARRATOR_SPEAKER)];

  it("stores no payload when there is nothing to put in it", () => {
    const event = buildNarrationEvent(
      {
        session_id: "g",
        event_type: "search",
        actor: "player",
        narration_parts: parts,
      },
      4,
    );

    expect(event).toMatchObject({
      payload: null,
      model: null,
      narration: "One",
    });
  });

  it("keeps the payload, and the model that wrote the narration", () => {
    const event = buildNarrationEvent(
      {
        session_id: "g",
        event_type: "search",
        actor: "player",
        narration_parts: parts,
        payload: { a: 1 },
        model: "m-1",
      },
      4,
    );

    expect(event).toMatchObject({ payload: { a: 1 }, model: "m-1" });
  });
});
