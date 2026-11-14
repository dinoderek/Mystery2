import { z } from "zod";

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
  // Clue(s) revealed by this action, for the in-game notebook to merge. Only
  // search/ask actions populate this; other turns omit it.
  revealed_clues: z.array(DiscoveredClueSchema).optional(),
});

/** Stepping into the starting location: its arrival narration, where the player stands, who is there. */
export const GameEnterResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["explore", "accuse"]),
  current_location: z.string().min(1),
  visible_characters: z.array(
    z.object({
      first_name: z.string().min(1),
      last_name: z.string().min(1),
      sex: CharacterSexSchema,
    }),
  ),
});

// --- game-turn ---
//
// One typed line in, one of four answers out. Only `turn` played anything and
// saved anything; the other three leave the game as it was.

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

/** A clue found this turn, as the notebook records it. */
export const RevealedClueSchema = DiscoveredClueSchema.extend({
  source: z.enum(["search", "talk"]),
  origin: ClueOriginSchema,
  discovered_at: z.string().datetime().nullable(),
  off_script: z.boolean(),
});

/** Where the game stands once a turn is saved. */
export const TurnStateSchema = z.object({
  mode: ModeSchema,
  time_remaining: z.number().int().nonnegative(),
  location: z.string().min(1),
  current_talk_character: z.string().nullable(),
});

export const TurnPlayedResponseSchema = z.object({
  kind: z.literal("turn"),
  /** The events as saved, in order; the player's own line is not among their parts. */
  events: z.array(NarrationEventSchema).min(1),
  state: TurnStateSchema,
  revealed_clues: z.array(RevealedClueSchema),
  /** Set when this turn ended the case. */
  result: OutcomeSchema.nullable(),
});

export const RefusalReasonSchema = z.enum(["missing-target", "invalid-target", "unrecognized"]);

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

export const GameTurnResponseSchema = z.discriminatedUnion("kind", [
  TurnPlayedResponseSchema,
  TurnRefusedResponseSchema,
  TurnViewResponseSchema,
  TurnQuitResponseSchema,
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
  // Notebook reference data. Present from game-start/game-get; nullable when the
  // blueprint has no authored starting knowledge.
  mystery_summary: z.string().nullable().optional(),
  premise: z.string().nullable().optional(),
  locations: z.array(LocationSummarySchema),
  characters: z.array(CharacterSummarySchema),
  // The notebook's clues, with where each was found.
  discovered_clues: z.array(RevealedClueSchema).optional(),
  time_remaining: z.number().int().nonnegative(),
  location: z.string(),
  mode: ModeSchema,
  current_talk_character: z.string().nullable(),
});

export const SessionTranscriptResponseSchema = z.object({
  state: GameStateSchema,
  narration_events: z.array(NarrationEventSchema),
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
  one_liner: z.string(),
  target_age: z.number().int().positive(),
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
  can_open: z.boolean(),
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

// --- AI settings ---
//
// The settings page is reachable before a profile is picked, so these shapes
// cross the boundary unauthenticated. Note what is *not* here: no schema
// carries `api_key`. A stored key leaves the server only as `masked`, and the
// only direction a secret ever travels is inward, on AIKeyUpsertSchema.

export const AISettingsSourceSchema = z.enum(["env", "user"]);
export const AIModeSchema = z.enum(["mock", "openrouter"]);
/**
 * Every provider the runtime can use. Wider than AIModeSchema, which is what
 * the settings page can choose: `claude-cli` is only ever selected through the
 * process environment, so it appears in the override and the effective mode.
 */
export const AIProviderSchema = z.enum(["mock", "openrouter", "claude-cli"]);

export const AIKeySummarySchema = z.object({
  label: z.string().min(1),
  source: AISettingsSourceSchema,
  /** Last four characters, for telling two keys apart. Never the whole secret. */
  masked: z.string(),
});

export const AIModelSummarySchema = z.object({
  label: z.string().min(1),
  model_id: z.string().min(1),
  source: AISettingsSourceSchema,
});

/**
 * An AI configuration forced by the process environment.
 *
 * Provider and model only: the override's key comes from the process
 * environment and has no label, so there is nothing to mask and nothing worth
 * showing. Present means the stored choice below is not currently in effect.
 */
export const AIOverrideSchema = z.object({
  provider: AIProviderSchema,
  model: z.string().min(1),
  source: z.string().min(1),
});

export const AISettingsStateSchema = z.object({
  /** What the runtime will actually do, once override and dangling selections are applied. */
  effective_mode: AIProviderSchema,
  /** What was last chosen on this page. */
  stored_mode: AIModeSchema,
  selected_key_label: z.string().nullable(),
  selected_model_label: z.string().nullable(),
  /** A selection naming a label the last environment reseed removed. */
  missing_key_label: z.string().nullable(),
  missing_model_label: z.string().nullable(),
  keys: z.array(AIKeySummarySchema),
  models: z.array(AIModelSummarySchema),
  override: AIOverrideSchema.nullable(),
});

export const AISettingsUpdateSchema = z
  .object({
    mode: AIModeSchema.optional(),
    key_label: z.string().min(1).nullable().optional(),
    model_label: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => Object.values(value).some((entry) => entry !== undefined),
    { message: "Nothing to update" },
  );

export const AIKeyUpsertSchema = z.object({
  label: z.string().min(1).max(60),
  api_key: z.string().min(1),
});

export const AIModelUpsertSchema = z.object({
  label: z.string().min(1).max(60),
  model_id: z.string().min(1),
});

export type AISettingsSource = z.infer<typeof AISettingsSourceSchema>;
export type AIMode = z.infer<typeof AIModeSchema>;
export type AIProvider = z.infer<typeof AIProviderSchema>;
export type AIKeySummary = z.infer<typeof AIKeySummarySchema>;
export type AIModelSummary = z.infer<typeof AIModelSummarySchema>;
export type AIOverride = z.infer<typeof AIOverrideSchema>;
export type AISettingsState = z.infer<typeof AISettingsStateSchema>;
export type AISettingsUpdate = z.infer<typeof AISettingsUpdateSchema>;
export type AIKeyUpsert = z.infer<typeof AIKeyUpsertSchema>;
export type AIModelUpsert = z.infer<typeof AIModelUpsertSchema>;

export type SpeakerKind = z.infer<typeof SpeakerKindSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GameStartRequest = z.infer<typeof GameStartRequestSchema>;
export type GameSessionRequest = z.infer<typeof GameSessionRequestSchema>;
export type GameEnterRequest = z.infer<typeof GameEnterRequestSchema>;
export type GameGetRequest = z.infer<typeof GameGetRequestSchema>;
export type NarrationPart = z.infer<typeof NarrationPartSchema>;
export type NarrationEvent = z.infer<typeof NarrationEventSchema>;
export type GameTurnRequest = z.infer<typeof GameTurnRequestSchema>;
export type ClueOrigin = z.infer<typeof ClueOriginSchema>;
export type RevealedClue = z.infer<typeof RevealedClueSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type TurnPlayedResponse = z.infer<typeof TurnPlayedResponseSchema>;
export type NoTurnLinePayload = z.infer<typeof NoTurnLinePayloadSchema>;
export type TurnRefusedResponse = z.infer<typeof TurnRefusedResponseSchema>;
export type TurnViewResponse = z.infer<typeof TurnViewResponseSchema>;
export type TurnQuitResponse = z.infer<typeof TurnQuitResponseSchema>;
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
