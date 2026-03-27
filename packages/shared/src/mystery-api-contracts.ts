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
  ai_profile: z.string().min(1).optional(),
});

export const GameMoveRequestSchema = GameSessionRequestSchema.extend({
  destination: z.string().min(1),
});

export const GameSearchRequestSchema = GameSessionRequestSchema.extend({
  search_query: z.string().min(1).nullable().optional(),
});

export const GameTalkRequestSchema = GameSessionRequestSchema.extend({
  character_id: z.string().min(1),
});

export const GameAskRequestSchema = GameSessionRequestSchema.extend({
  player_input: z.string().min(1),
});

export const GameAccuseRequestSchema = GameSessionRequestSchema.extend({
  player_reasoning: z.string().min(1).optional(),
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

export const TurnResponseBaseSchema = z.object({
  narration_parts: z.array(NarrationPartSchema).min(1),
  time_remaining: z.number().int().nonnegative(),
  mode: ModeSchema,
  current_talk_character: z.string().nullable().optional(),
  follow_up_prompt: z.string().nullable().optional(),
  result: OutcomeSchema.nullable().optional(),
});

export const TalkStartResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["talk", "accuse"]),
  current_talk_character: z.string().nullable(),
});

export const TalkAskResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["talk", "accuse"]),
  current_talk_character: z.string().nullable(),
});

export const TalkEndResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.literal("explore"),
  current_talk_character: z.null(),
});

export const SearchResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["explore", "accuse"]),
});

export const MoveResponseSchema = TurnResponseBaseSchema.extend({
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

export const AccuseResponseSchema = TurnResponseBaseSchema.extend({
  mode: z.enum(["accuse", "ended"]),
  follow_up_prompt: z.string().nullable().optional(),
  result: OutcomeSchema.nullable().optional(),
});

export const LocationSummarySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
});

export const CharacterSummarySchema = z.object({
  id: z.string().min(1),
  first_name: z.string(),
  last_name: z.string(),
  location_id: z.string(),
  sex: CharacterSexSchema,
});

export const GameStateSchema = z.object({
  locations: z.array(LocationSummarySchema),
  characters: z.array(CharacterSummarySchema),
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

export const GameGetResponseSchema = SessionTranscriptResponseSchema;

export const BlueprintSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  one_liner: z.string(),
  target_age: z.number().int().positive(),
  blueprint_image_id: z.string().nullable().optional(),
});

export const ImageLinkRequestSchema = z.object({
  blueprint_id: z.string().uuid(),
  image_id: z.string().min(1),
});

export const ImageLinkResponseSchema = z.object({
  image_id: z.string().min(1),
  signed_url: z.string().url(),
  expires_at: z.string().datetime(),
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

export type SpeakerKind = z.infer<typeof SpeakerKindSchema>;
export type Speaker = z.infer<typeof SpeakerSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type GameStartRequest = z.infer<typeof GameStartRequestSchema>;
export type GameSessionRequest = z.infer<typeof GameSessionRequestSchema>;
export type GameMoveRequest = z.infer<typeof GameMoveRequestSchema>;
export type GameSearchRequest = z.infer<typeof GameSearchRequestSchema>;
export type GameTalkRequest = z.infer<typeof GameTalkRequestSchema>;
export type GameSearchRequest = z.infer<typeof GameSearchRequestSchema>;
export type GameAskRequest = z.infer<typeof GameAskRequestSchema>;
export type GameAccuseRequest = z.infer<typeof GameAccuseRequestSchema>;
export type NarrationPart = z.infer<typeof NarrationPartSchema>;
export type NarrationEvent = z.infer<typeof NarrationEventSchema>;
export type TalkStartResponse = z.infer<typeof TalkStartResponseSchema>;
export type TalkAskResponse = z.infer<typeof TalkAskResponseSchema>;
export type TalkEndResponse = z.infer<typeof TalkEndResponseSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type MoveResponse = z.infer<typeof MoveResponseSchema>;
export type AccuseResponse = z.infer<typeof AccuseResponseSchema>;
export type GameState = z.infer<typeof GameStateSchema>;
export type SessionTranscriptResponse = z.infer<typeof SessionTranscriptResponseSchema>;
export type GameStartResponse = z.infer<typeof GameStartResponseSchema>;
export type GameGetResponse = z.infer<typeof GameGetResponseSchema>;
export type BlueprintSummary = z.infer<typeof BlueprintSummarySchema>;
export type SessionSummary = z.infer<typeof SessionSummarySchema>;
export type SessionCounts = z.infer<typeof SessionCountsSchema>;
export type SessionCatalogResponse = z.infer<typeof SessionCatalogResponseSchema>;
export type ImageLinkRequest = z.infer<typeof ImageLinkRequestSchema>;
export type ImageLinkResponse = z.infer<typeof ImageLinkResponseSchema>;
