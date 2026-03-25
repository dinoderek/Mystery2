/**
 * Shared test fixtures that mirror production data shapes.
 *
 * These fixtures include ALL fields the server sends (including `id` on
 * locations and characters) so that tests never accidentally mask bugs
 * caused by missing fields.
 */

export const NARRATOR_SPEAKER = {
  kind: "narrator" as const,
  key: "narrator",
  label: "Narrator",
};

export function characterSpeaker(name: string) {
  return {
    kind: "character" as const,
    key: `character:${name.toLowerCase()}`,
    label: name,
  };
}

export const LOCATIONS = [
  { id: "loc-kitchen", name: "Kitchen" },
  { id: "loc-garden", name: "Garden" },
  { id: "loc-barn", name: "Barn" },
] as const;

export const CHARACTERS = [
  {
    id: "char-rosie",
    first_name: "Rosie",
    last_name: "Jones",
    location_id: "loc-kitchen",
    location_name: "Kitchen",
    sex: "female" as const,
  },
  {
    id: "char-mayor",
    first_name: "Mayor",
    last_name: "Fox",
    location_id: "loc-kitchen",
    location_name: "Kitchen",
    sex: "male" as const,
  },
  {
    id: "char-bob",
    first_name: "Bob",
    last_name: "Smith",
    location_id: "loc-garden",
    location_name: "Garden",
    sex: "male" as const,
  },
] as const;

export const BASE_GAME_STATE = {
  locations: LOCATIONS.map((l) => ({ id: l.id, name: l.name })),
  characters: CHARACTERS.map((c) => ({
    id: c.id,
    first_name: c.first_name,
    last_name: c.last_name,
    location_name: c.location_name,
    sex: c.sex,
  })),
  time_remaining: 10,
  location: "Kitchen",
  mode: "explore" as const,
  current_talk_character: null,
};

export function narrationResponse(
  text: string,
  speaker: { kind: string; key: string; label: string },
  imageId?: string,
) {
  return {
    narration_parts: [
      {
        text,
        speaker,
        ...(imageId ? { image_id: imageId } : {}),
      },
    ],
  };
}
