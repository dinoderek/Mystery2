/**
 * Shared test fixtures typed against the Zod schemas in @my2/shared.
 *
 * Every constant and factory calls `Schema.parse()` at creation time so that
 * schema drift is caught immediately rather than hiding behind stale mocks.
 *
 * Objects may carry extra fields beyond the schema (e.g. `location_name` on
 * characters) — parse validates required fields, but the full object is
 * returned so tests that rely on those extras continue to work.
 */

import {
  SpeakerSchema,
  NarrationPartSchema,
  NarrationEventSchema,
  GameStateSchema,
  GameStartResponseSchema,
  SessionSummarySchema,
  SessionCatalogResponseSchema,
  BlueprintSummarySchema,
  MoveResponseSchema,
  SearchResponseSchema,
  TalkStartResponseSchema,
  TalkEndResponseSchema,
  AccuseResponseSchema,
  ImageLinkResponseSchema,
  type Speaker,
  type NarrationPart,
  type NarrationEvent,
  type GameState,
  type GameStartResponse,
  type SessionSummary,
  type SessionCatalogResponse,
  type BlueprintSummary,
  type MoveResponse,
  type SearchResponse,
  type TalkStartResponse,
  type TalkEndResponse,
  type AccuseResponse,
  type ImageLinkResponse,
} from "@my2/shared";

// ---------------------------------------------------------------------------
// Internal helper — validate then return the original (unstripped) object
// ---------------------------------------------------------------------------

function validate<T>(schema: { parse: (v: unknown) => unknown }, obj: T): T {
  schema.parse(obj);
  return obj;
}

// ---------------------------------------------------------------------------
// Validated speaker constants
// ---------------------------------------------------------------------------

export const NARRATOR_SPEAKER: Speaker = validate(SpeakerSchema, {
  kind: "narrator" as const,
  key: "narrator",
  label: "Narrator",
});

export const INVESTIGATOR_SPEAKER: Speaker = validate(SpeakerSchema, {
  kind: "investigator" as const,
  key: "you",
  label: "You",
});

export function characterSpeaker(name: string): Speaker {
  return validate(SpeakerSchema, {
    kind: "character" as const,
    key: `character:${name.toLowerCase()}`,
    label: name,
  });
}

// ---------------------------------------------------------------------------
// Location & character constants
// ---------------------------------------------------------------------------

/** Extra fields beyond the schema that the frontend reads. */
type CharacterWithLocationName = {
  id: string;
  first_name: string;
  last_name: string;
  location_id: string;
  location_name: string;
  sex: "male" | "female";
};

export const LOCATIONS = [
  { id: "loc-kitchen", name: "Kitchen" },
  { id: "loc-garden", name: "Garden" },
  { id: "loc-barn", name: "Barn" },
] as const;

export const CHARACTERS: readonly CharacterWithLocationName[] = [
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

// Validate each character satisfies the schema (location_name is extra, harmless)
CHARACTERS.forEach((c) => {
  const { id, first_name, last_name, location_id, sex } = c;
  GameStateSchema.shape.characters.element.parse({ id, first_name, last_name, location_id, sex });
});

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------

export const BASE_GAME_STATE = createGameState();

export function createGameState(
  overrides?: Record<string, unknown>,
): GameState & { characters: CharacterWithLocationName[] } {
  const state = {
    locations: LOCATIONS.map((l) => ({ id: l.id, name: l.name })),
    characters: CHARACTERS.map((c) => ({
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
      location_id: c.location_id,
      location_name: c.location_name,
      sex: c.sex,
    })),
    time_remaining: 10,
    location: "Kitchen",
    mode: "explore" as const,
    current_talk_character: null,
    ...overrides,
  };
  // Validate the schema-required fields are present
  GameStateSchema.parse(state);
  return state as GameState & { characters: CharacterWithLocationName[] };
}

// ---------------------------------------------------------------------------
// Narration helpers
// ---------------------------------------------------------------------------

export function narrationResponse(
  text: string,
  speaker: Speaker,
  imageId?: string,
): { narration_parts: NarrationPart[] } {
  const part: NarrationPart = {
    text,
    speaker,
    ...(imageId ? { image_id: imageId } : {}),
  };
  validate(NarrationPartSchema, part);
  return { narration_parts: [part] };
}

export function createNarrationEvent(
  overrides?: Partial<NarrationEvent>,
): NarrationEvent {
  const event: NarrationEvent = {
    sequence: 1,
    event_type: "start",
    narration_parts: [{ text: "You enter the kitchen.", speaker: NARRATOR_SPEAKER }],
    ...overrides,
  };
  return validate(NarrationEventSchema, event);
}

// ---------------------------------------------------------------------------
// Game start response
// ---------------------------------------------------------------------------

export function createGameStartResponse(
  overrides?: Record<string, unknown>,
): GameStartResponse {
  const response = {
    game_id: "00000000-0000-0000-0000-000000000001",
    state: BASE_GAME_STATE,
    narration_events: [
      createNarrationEvent({ sequence: 1, event_type: "start" }),
    ],
    ...overrides,
  };
  GameStartResponseSchema.parse(response);
  return response as GameStartResponse;
}

// ---------------------------------------------------------------------------
// Session summary & catalog
// ---------------------------------------------------------------------------

export function createSessionSummary(
  overrides?: Partial<SessionSummary>,
): SessionSummary {
  const summary: SessionSummary = {
    game_id: "00000000-0000-0000-0000-000000000001",
    blueprint_id: "00000000-0000-0000-0000-000000000002",
    mystery_title: "The Stolen Cake",
    mystery_available: true,
    can_open: true,
    mode: "explore",
    time_remaining: 8,
    outcome: null,
    last_played_at: "2026-03-10T12:00:00.000Z",
    created_at: "2026-03-09T12:00:00.000Z",
    ...overrides,
  };
  return validate(SessionSummarySchema, summary);
}

export function createSessionCatalog(
  overrides?: Partial<SessionCatalogResponse>,
): SessionCatalogResponse {
  const catalog: SessionCatalogResponse = {
    in_progress: [],
    completed: [],
    counts: { in_progress: 0, completed: 0 },
    ...overrides,
  };
  return validate(SessionCatalogResponseSchema, catalog);
}

export const EMPTY_CATALOG: SessionCatalogResponse = createSessionCatalog();

// ---------------------------------------------------------------------------
// Blueprint summary
// ---------------------------------------------------------------------------

export function createBlueprintSummary(
  overrides?: Partial<BlueprintSummary>,
): BlueprintSummary {
  const blueprint: BlueprintSummary = {
    id: "00000000-0000-0000-0000-000000000002",
    title: "The Stolen Cake",
    one_liner: "Find the cake",
    target_age: 6,
    ...overrides,
  };
  return validate(BlueprintSummarySchema, blueprint);
}

export const MOCK_BLUEPRINT: BlueprintSummary = createBlueprintSummary();

// ---------------------------------------------------------------------------
// Turn responses
// ---------------------------------------------------------------------------

export function createMoveResponse(
  overrides?: Partial<MoveResponse>,
): MoveResponse {
  const response: MoveResponse = {
    narration_parts: [{ text: "You move to a new location.", speaker: NARRATOR_SPEAKER }],
    time_remaining: 9,
    mode: "explore",
    current_location: "Garden",
    visible_characters: [],
    ...overrides,
  };
  return validate(MoveResponseSchema, response);
}

export function createSearchResponse(
  overrides?: Record<string, unknown>,
): SearchResponse {
  const response = {
    narration_parts: [{ text: "You search the area.", speaker: NARRATOR_SPEAKER }],
    time_remaining: 9,
    mode: "explore" as const,
    ...overrides,
  };
  SearchResponseSchema.parse(response);
  return response as SearchResponse;
}

export function createTalkStartResponse(
  overrides?: Partial<TalkStartResponse>,
): TalkStartResponse {
  const response: TalkStartResponse = {
    narration_parts: [{ text: "You approach the character.", speaker: NARRATOR_SPEAKER }],
    time_remaining: 9,
    mode: "talk",
    current_talk_character: "Rosie Jones",
    ...overrides,
  };
  return validate(TalkStartResponseSchema, response);
}

export function createTalkEndResponse(
  overrides?: Partial<TalkEndResponse>,
): TalkEndResponse {
  const response: TalkEndResponse = {
    narration_parts: [{ text: "You end the conversation.", speaker: NARRATOR_SPEAKER }],
    time_remaining: 9,
    mode: "explore",
    current_talk_character: null,
    ...overrides,
  };
  return validate(TalkEndResponseSchema, response);
}

export function createAccuseResponse(
  overrides?: Record<string, unknown>,
): AccuseResponse {
  const response = {
    narration_parts: [{ text: "You make your accusation.", speaker: NARRATOR_SPEAKER }],
    time_remaining: 0,
    mode: "ended" as const,
    result: "win" as const,
    ...overrides,
  };
  AccuseResponseSchema.parse(response);
  return response as AccuseResponse;
}

// ---------------------------------------------------------------------------
// Image link
// ---------------------------------------------------------------------------

export function createImageLinkResponse(
  overrides?: Partial<ImageLinkResponse>,
): ImageLinkResponse {
  const response: ImageLinkResponse = {
    image_id: "mock-cover.png",
    signed_url:
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
    expires_at: "2099-01-01T00:00:00.000Z",
    ...overrides,
  };
  return validate(ImageLinkResponseSchema, response);
}

export const MOCK_IMAGE_LINK: ImageLinkResponse = createImageLinkResponse();
