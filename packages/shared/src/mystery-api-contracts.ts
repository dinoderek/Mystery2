import { z } from "zod";
import { SceneManifestSchema } from "./scene-schema.ts";
import { ReadingAgeSchema } from "./reading-age.ts";
export { ageUnchangedNote, READING_AGES, ReadingAgeSchema } from "./reading-age.ts";
export type { PlayableCase } from "./playable-case.ts";
export { ClueGraphCaseSchema, type ClueGraphCase } from "./clue-graph-schema.ts";
export { validateClueGraph } from "./clue-graph-validator.ts";
export { buildClueGraphWorld, clueGraphCaseId, type ClueGraphWorld } from "./clue-graph-case.ts";
export { reachClues, type ReachedClue } from "./clue-graph-reach.ts";
export { cheapestRoute } from "./clue-graph-route.ts";
export { culpritRoutes, measureCase, type CulpritRoute } from "./clue-graph-story.ts";
export {
  CLUE_GRAPH_SIZES,
  SIZE_COUNTS,
  SIZE_TABLE,
  sizeBounds,
  type ClueGraphSize,
  type CountRange,
  type SizeCount,
  type SizeOverrides,
} from "./clue-graph-sizes.ts";
export { clueGraphTrails } from "./clue-graph-trails.ts";
export { ProceduralSceneSchema, SceneRecipeSchema, SceneManifestSchema, type SceneRecipe, type SceneManifest, type SceneObject, type ProceduralScene } from "./scene-schema.ts";

export const BlueprintScenesRequestSchema = z.object({ blueprint_id: z.string().uuid() });
export const BlueprintScenesResponseSchema = SceneManifestSchema;

export const ModeSchema = z.enum(["explore", "talk", "accuse", "ended"]);
export const SpeakerKindSchema = z.enum([
  "investigator",
  "narrator",
  "character",
  "system",
]);
export const SpeakerSchema = z.object({
  kind: SpeakerKindSchema,
  key: z.string().min(1),
  label: z.string().min(1),
});
export const OutcomeSchema = z.enum(["win", "lose"]);
export const CharacterSexSchema = z.enum(["male", "female"]);

export const ErrorResponseSchema = z.object({
  error: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export const GameSessionRequestSchema = z.object({
  game_id: z.string().uuid(),
});

export const GameStartRequestSchema = z.object({
  blueprint_id: z.string().uuid(),
  ai_profile: z.string().trim().min(1).optional(),
});

/** `game-enter` takes the game; `game-get` takes it as the `game_id` query parameter. */
export const GameEnterRequestSchema = GameSessionRequestSchema;
export const GameGetRequestSchema = GameSessionRequestSchema;

/**
 * `blueprints-list` answers with the titles alone, at once; asked for
 * `one_liners` (a JSON `true`, or `"true"` as a query parameter), it also
 * narrates every listed case's line at the profile's age, in one model call.
 */
export const BlueprintsListRequestSchema = z.object({
  one_liners: z.preprocess(
    (value) => (value === "true" ? true : value === "false" ? false : value),
    z.boolean(),
  ).optional(),
});

export const NarrationPartSchema = z.object({
  text: z.string().min(1),
  speaker: SpeakerSchema,
  image_id: z.string().min(1).nullable().optional(),
});

export const NarrationEventSchema = z.object({
  sequence: z.number().int().positive(),
  event_type: z.string().min(1),
  narration_parts: z.array(NarrationPartSchema).min(1),
  payload: z.record(z.string(), z.unknown()).nullable().optional(),
  created_at: z.string().datetime().optional(),
});

export const DiscoveredClueSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
});

export const TurnResponseBaseSchema = z.object({
  narration_parts: z.array(NarrationPartSchema).min(1),
  time_remaining: z.number().int().nonnegative(),
  mode: ModeSchema,
  current_talk_character: z.string().nullable().optional(),
  result: OutcomeSchema.nullable().optional(),
  // Clues for the in-game notebook to merge. Stepping into the starting
  // location reveals none, so game-enter omits it.
  revealed_clues: z.array(DiscoveredClueSchema).optional(),
});

/** Stepping into the starting location: its arrival narration, where the player stands, who is there. */
export const GameEnterResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["explore", "accuse"]),
  current_location: z.string().min(1),
  visible_characters: z.array(
    z.object({
      first_name: z.string().min(1),
      last_name: z.string(),
      sex: CharacterSexSchema,
    }),
  ),
  /** The line saved first when the profile's age changed since the game last recorded one. */
  age_change: NarrationEventSchema.nullable().optional(),
});

// --- game-turn ---
//
// One typed line in, one of five answers out. Only `turn` played anything;
// `age` may have saved the line recording a change of age. The other three
// leave the game as it was.

export const GameTurnRequestSchema = GameSessionRequestSchema.extend({
  /** The line exactly as the player typed it. */
  input: z.string(),
});

export const ClueOriginSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("location"),
    location_id: z.string().min(1),
    location_name: z.string(),
  }),
  z.object({
    kind: z.literal("character"),
    character_id: z.string().min(1),
    character_name: z.string(),
  }),
]);

/**
 * A clue found this turn, as the notebook records it. A clue-graph case adds
 * what the notebook shows of it: its `kind`, and whether a later clue took it
 * back. Neither says whether a statement was true.
 */
export const RevealedClueSchema = DiscoveredClueSchema.extend({
  source: z.enum(["search", "talk"]),
  origin: ClueOriginSchema,
  discovered_at: z.string().datetime().nullable(),
  off_script: z.boolean(),
  kind: z.enum(["evidence", "statement", "tell"]).optional(),
  taken_back: z.boolean().optional(),
});

/**
 * What the player needs next, in words that name who or where only. `new` is
 * set on the turn the lead first appears.
 */
export const NotebookLeadSchema = z.object({
  /** Stable across turns, so the browser can tell one lead from another. */
  key: z.string().min(1),
  text: z.string().min(1),
  new: z.boolean(),
});

/** Where the game stands once a turn is saved. */
export const TurnStateSchema = z.object({
  mode: ModeSchema,
  time_remaining: z.number().int().nonnegative(),
  /** The accusations the game has left, derived from its events. */
  accusations_left: z.number().int().nonnegative(),
  location: z.string().min(1),
  current_talk_character: z.string().nullable(),
});

export const TurnPlayedResponseSchema = z.object({
  kind: z.literal("turn"),
  /** The events as saved, in order; the player's own line is not among their parts. */
  events: z.array(NarrationEventSchema).min(1),
  state: TurnStateSchema,
  revealed_clues: z.array(RevealedClueSchema),
  /** The leads as they stand after this turn. */
  leads: z.array(NotebookLeadSchema),
  /** Every clue in the notebook taken back so far, not only this turn's. */
  taken_back: z.array(z.string().min(1)),
  /** Set when this turn ended the case. */
  result: OutcomeSchema.nullable(),
});

export const RefusalReasonSchema = z.enum(["missing-target", "invalid-target", "unrecognized", "no-way-back"]);

export const TurnRefusedResponseSchema = z.object({
  kind: z.literal("refused"),
  reason: RefusalReasonSchema,
  /** What the player reads. */
  hint: z.string().min(1),
});

export const NotebookSectionSchema = z.enum(["story", "places", "people", "clues"]);

export const TurnViewResponseSchema = z.object({
  kind: z.literal("view"),
  view: z.enum(["help", "notebook", "locations", "characters"]),
  /** The notebook section to open at, if the line named one. */
  section: NotebookSectionSchema.nullable(),
  /** The line the game adds to the transcript when the view opens; null when it adds none. */
  note: z.string().min(1).nullable(),
});

export const TurnQuitResponseSchema = z.object({
  kind: z.literal("quit"),
});

/**
 * `age <n>` was typed: the profile's age is now `reading_age`. `event` is the
 * `age_change` line the game saved, or null when the game already recorded
 * that age and nothing was saved.
 */
export const TurnAgeResponseSchema = z.object({
  kind: z.literal("age"),
  reading_age: ReadingAgeSchema,
  event: NarrationEventSchema.nullable(),
});

export const GameTurnResponseSchema = z.discriminatedUnion("kind", [
  TurnPlayedResponseSchema,
  TurnRefusedResponseSchema,
  TurnViewResponseSchema,
  TurnQuitResponseSchema,
  TurnAgeResponseSchema,
]);

// --- lines that cost no turn ---
//
// A refused line, and `help`, are saved as one event of this type: the line as
// typed, and the answer the player read as its one narration part. Saving one
// spends no turn and changes nothing in the session, so a resumed game shows
// what the live game showed. Readers that follow what the game master did skip
// it.

export const NO_TURN_EVENT_TYPE = "no_turn_line";

export const NoTurnLinePayloadSchema = z.object({
  /** The line exactly as the player typed it. */
  input: z.string(),
  /** Why nothing was played: the line was refused, or it asked for help. */
  answered: z.enum(["refused", "help"]),
  /** Set when `answered` is `refused`. */
  reason: RefusalReasonSchema.optional(),
});

// --- the change of age ---
//
// When the profile's age differs from the last one the game recorded, the
// engine saves one `age_change` before narrating anything: a fixed line, the
// same for every age, that costs no turn and is no part of what the game
// master did. Earlier events are never rewritten.

export const AGE_CHANGE_EVENT_TYPE = "age_change";

export const AgeChangePayloadSchema = z.object({
  from: ReadingAgeSchema,
  to: ReadingAgeSchema,
});

export const LocationSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  // Player-facing one-liner for the notebook; null when not authored.
  summary: z.string().nullable().optional(),
});

export const CharacterSummarySchema = z.object({
  id: z.string().min(1),
  first_name: z.string(),
  last_name: z.string(),
  location_id: z.string(),
  sex: CharacterSexSchema,
  // Player-facing one-liner for the notebook; null when not authored.
  summary: z.string().nullable().optional(),
});

export const GameStateSchema = z.object({
  // The notebook's Story: the opening narration saved with the game's `start`
  // event, as it was written then. Null when the game has no start event.
  story: z.string().nullable(),
  locations: z.array(LocationSummarySchema),
  characters: z.array(CharacterSummarySchema),
  // The notebook's clues, with where each was found.
  discovered_clues: z.array(RevealedClueSchema).optional(),
  // What to do next.
  leads: z.array(NotebookLeadSchema),
  time_remaining: z.number().int().nonnegative(),
  /** The accusations the game has left, derived from its events. */
  accusations_left: z.number().int().nonnegative(),
  location: z.string(),
  mode: ModeSchema,
  current_talk_character: z.string().nullable(),
});

export const SessionTranscriptResponseSchema = z.object({
  state: GameStateSchema,
  narration_events: z.array(NarrationEventSchema),
  /** The age the game's next narrated line is written at: the profile's, read on this request. */
  reading_age: ReadingAgeSchema,
});

export const GameStartResponseSchema = SessionTranscriptResponseSchema.extend({
  game_id: z.string().uuid(),
});

export const GameGetResponseSchema = SessionTranscriptResponseSchema.extend({
  blueprint_id: z.string().uuid(),
});

export const BlueprintSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  // Narrated at the profile's age when the list is asked for its lines; null
  // otherwise, or when the narration failed. Never the case's own text.
  one_liner: z.string().nullable(),
  blueprint_image_id: z.string().nullable().optional(),
});

export const BlueprintsListResponseSchema = z.object({
  blueprints: z.array(BlueprintSummarySchema),
});

export const SessionSummarySchema = z.object({
  game_id: z.string().uuid(),
  blueprint_id: z.string().uuid(),
  mystery_title: z.string().min(1),
  mystery_available: z.boolean(),
  mode: ModeSchema,
  time_remaining: z.number().int().nonnegative(),
  outcome: OutcomeSchema.nullable().optional(),
  last_played_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

export const SessionCountsSchema = z.object({
  in_progress: z.number().int().nonnegative(),
  completed: z.number().int().nonnegative(),
});

export const SessionCatalogResponseSchema = z.object({
  in_progress: z.array(SessionSummarySchema),
  completed: z.array(SessionSummarySchema),
  counts: SessionCountsSchema,
});

// --- Profile settings ---

/**
 * What the playing profile has set. Its `reading_age` is the age every game of
 * the profile is written at, read on each request. A profile always has one;
 * an older local database may hold a profile without, which the engine refuses
 * to play with (`READING_AGE_REQUIRED`) until one is chosen.
 */
export const ProfileSettingsSchema = z.object({
  reading_age: ReadingAgeSchema,
});

/** Setting the profile's reading age: the whole settings state. */
export const ProfileSettingsUpdateSchema = ProfileSettingsSchema;

/** The `details.code` of a 400 for a profile that has no reading age yet. */
export const READING_AGE_REQUIRED = "READING_AGE_REQUIRED";

/**
 * Signing in. A name no profile has yet creates one, and then needs its
 * `reading_age`; a known name signs in with the name alone.
 */
export const PlayerSignInSchema = z.object({
  name: z.string().trim().min(1, "Missing profile name").max(60, "Profile name is too long"),
  reading_age: ReadingAgeSchema.optional(),
});

// --- AI settings ---
//
// The settings page is reachable before a profile is picked, so these shapes
// cross the boundary unauthenticated. No schema here carries a key: the page
// chooses among the AIs in `ai.json` and has no use for one.

/** How an AI narrates. `mock` is built in; the others are `ai.json` entries. */
export const AIBackendSchema = z.enum(["mock", "openrouter", "claude-cli"]);

/** An AI, as the page names it: no key, and nothing that would reveal one. */
export const AISummarySchema = z.object({
  name: z.string().min(1),
  backend: AIBackendSchema,
  model: z.string().min(1),
});

/** An AI the page can list, and why it cannot narrate, when it cannot. */
export const AIChoiceSchema = AISummarySchema.extend({
  /** Null when the AI has what it needs; otherwise what is missing, naming it. */
  problem: z.string().min(1).nullable(),
});

export const AISettingsStateSchema = z.object({
  /** Mock first, then the file's AIs in the file's order. */
  ais: z.array(AIChoiceSchema),
  /** The name chosen on the page, or null when nothing has been chosen. */
  chosen: z.string().min(1).nullable(),
  /** The AI `ai.json` names as its default, which narrates while nothing is chosen, or null. */
  configured_default: z.string().min(1).nullable(),
  /**
   * The AI the server was started with (`./dev run --ai <name>`). Present
   * means it narrates instead of the choice above.
   */
  override: AISummarySchema.nullable(),
  /** The AI that narrates a game started now. Null exactly when `narrator_error` is set. */
  narrator: AISummarySchema.nullable(),
  /** Why nothing can narrate: the choice or the default names an AI that is missing or broken. */
  narrator_error: z.string().min(1).nullable(),
});

export const AISettingsUpdateSchema = z.object({
  /** `mock`, or the name of an AI in `ai.json`. */
  name: z.string().trim().min(1),
});

export type AIBackend = z.infer<typeof AIBackendSchema>;
export type AISummary = z.infer<typeof AISummarySchema>;
export type AIChoice = z.infer<typeof AIChoiceSchema>;
export type AISettingsState = z.infer<typeof AISettingsStateSchema>;
export type AISettingsUpdate = z.infer<typeof AISettingsUpdateSchema>;

export type SpeakerKind = z.infer<typeof SpeakerKindSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GameStartRequest = z.infer<typeof GameStartRequestSchema>;
export type GameSessionRequest = z.infer<typeof GameSessionRequestSchema>;
export type GameEnterRequest = z.infer<typeof GameEnterRequestSchema>;
export type GameGetRequest = z.infer<typeof GameGetRequestSchema>;
export type BlueprintsListRequest = z.infer<typeof BlueprintsListRequestSchema>;
export type NarrationPart = z.infer<typeof NarrationPartSchema>;
export type NarrationEvent = z.infer<typeof NarrationEventSchema>;
export type GameTurnRequest = z.infer<typeof GameTurnRequestSchema>;
export type ClueOrigin = z.infer<typeof ClueOriginSchema>;
export type RevealedClue = z.infer<typeof RevealedClueSchema>;
export type NotebookLead = z.infer<typeof NotebookLeadSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type TurnPlayedResponse = z.infer<typeof TurnPlayedResponseSchema>;
export type NoTurnLinePayload = z.infer<typeof NoTurnLinePayloadSchema>;
export type TurnRefusedResponse = z.infer<typeof TurnRefusedResponseSchema>;
export type TurnViewResponse = z.infer<typeof TurnViewResponseSchema>;
export type TurnQuitResponse = z.infer<typeof TurnQuitResponseSchema>;
export type TurnAgeResponse = z.infer<typeof TurnAgeResponseSchema>;
export type AgeChangePayload = z.infer<typeof AgeChangePayloadSchema>;
export type GameTurnResponse = z.infer<typeof GameTurnResponseSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type SessionTranscriptResponse = z.infer<typeof SessionTranscriptResponseSchema>;
export type GameStartResponse = z.infer<typeof GameStartResponseSchema>;
export type GameGetResponse = z.infer<typeof GameGetResponseSchema>;
export type GameEnterResponse = z.infer<typeof GameEnterResponseSchema>;
export type BlueprintsListResponse = z.infer<typeof BlueprintsListResponseSchema>;
export type BlueprintSummary = z.infer<typeof BlueprintSummarySchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionCounts = z.infer<typeof SessionCountsSchema>;
export type SessionCatalogResponse = z.infer<typeof SessionCatalogResponseSchema>;
export type ProfileSettings = z.infer<typeof ProfileSettingsSchema>;
